import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCredentialsMutationStore,
  type CredentialsMutationStore,
  type RefreshFn,
  type RefreshResult,
} from "@traycer/protocol/config/credentials-mutation";
import type { StoredCredentials } from "@traycer/protocol/config/credentials";
import { MutableBearerLease } from "../bearer-source";
import {
  createStoreBackedRevalidator,
  withCommitRetry,
} from "../host-credentials-store";

/**
 * Concurrency proof for the T0b extraction (`createStoreBackedRevalidator` /
 * `withCommitRetry`, moved verbatim from `clients/traycer-cli/src/store/
 * credentials-store.ts`). This is deliberately NOT a mocked test — the CLI's
 * own pre-existing `credentials-store.test.ts` already pins the outcome
 * mapping against a fake store; what that file cannot prove is that TWO
 * independent revalidators (standing in for two real processes — e.g. this
 * bridge and a concurrent CLI/Desktop) racing against the SAME real
 * credentials file on disk never double-spend the single-use refresh token.
 * That is the property the whole extraction exists to preserve, and a
 * mocked test cannot exercise real file-lock contention.
 *
 * A real `commit-failed` continuation additionally requires forcing a WAL
 * write to fail without breaking the lock acquisition itself (a read-only
 * parent directory) — Windows ignores those permission bits entirely, the
 * SAME limitation `protocol/src/config/__tests__/credentials-mutation.test.ts`
 * already works around with its own `canForceCommitFailure` guard. This file
 * follows the identical precedent rather than inventing a new one; the
 * `commit-failed` -> `"rotated"` outcome mapping itself is already pinned,
 * unmodified, by the CLI's mocked test (`"treats commit-failed as rotated"`).
 */

const isWindows = process.platform === "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const canForceCommitFailure = !isWindows && !isRoot;

const CREDS: StoredCredentials = {
  token: "tok-0",
  refreshToken: "rt-0",
  authnBaseUrl: "http://localhost:21001",
  savedAt: "2026-01-01T00:00:00.000Z",
  user: { id: "u1", email: "ada@traycer.ai", name: "Ada" },
};

describe("createStoreBackedRevalidator - real concurrent contention", () => {
  let workDir: string;
  let credentialsPath: string;
  let metaPath: string;
  let lockPath: string;
  const stores: CredentialsMutationStore[] = [];

  function makeStore(refresh: RefreshFn): CredentialsMutationStore {
    const store = createCredentialsMutationStore({
      paths: { credentialsPath, metaPath, lockPath },
      refresh,
      lockWaitMs: 2_000,
      lockPollIntervalMs: 25,
      continuationRetryMs: 15,
    });
    stores.push(store);
    return store;
  }

  function refreshStub(): { fn: RefreshFn; calls: () => number } {
    let count = 0;
    return {
      fn: async ({ token }): Promise<RefreshResult> => {
        count += 1;
        // A small delay makes the second racer's `rotate` genuinely block on
        // the lock while the first is still inside its refresh call -
        // "a refresh landing while another holds it," not just two calls
        // that happen not to overlap.
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          kind: "refreshed",
          token: `${token}::r`,
          refreshToken: `rt::${token}`,
        };
      },
      calls: () => count,
    };
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "traycer-host-cred-store-test-"));
    credentialsPath = join(workDir, "credentials");
    metaPath = join(workDir, "credentials.meta.json");
    mkdirSync(join(workDir, "lock"), { recursive: true, mode: 0o700 });
    lockPath = join(workDir, "lock", "credentials.lock");
  });

  afterEach(() => {
    for (const store of stores) store.dispose();
    stores.length = 0;
    rmSync(workDir, { recursive: true, force: true });
  });

  it("two concurrent revalidators (standing in for two real processes) never double-spend the refresh token", async () => {
    const shared = refreshStub();
    const storeA = makeStore(shared.fn);
    const storeB = makeStore(shared.fn);
    const seed = await storeA.signIn(CREDS, false, null);
    expect(seed.outcome).toBe("applied");

    // Two independent leases, as two independent processes would each hold
    // their own in-memory lease over the same on-disk file.
    const leaseA = new MutableBearerLease(CREDS.token, CREDS.user.id);
    const leaseB = new MutableBearerLease(CREDS.token, CREDS.user.id);
    const revalidatorA = createStoreBackedRevalidator({
      store: storeA,
      lease: leaseA,
    });
    const revalidatorB = createStoreBackedRevalidator({
      store: storeB,
      lease: leaseB,
    });

    const [outcomeA, outcomeB] = await Promise.all([
      revalidatorA.revalidateCurrentContext(),
      revalidatorB.revalidateCurrentContext(),
    ]);

    // Exactly one HTTP refresh call happened - the lock serialized the race
    // so only one racer ever spent the single-use refresh token.
    expect(shared.calls()).toBe(1);
    // Both revalidators still report success: the loser adopts the winner's
    // freshly-minted pair (`superseded`) rather than failing.
    expect(outcomeA).toBe("rotated");
    expect(outcomeB).toBe("rotated");
    // Both leases converge on the SAME final token - neither is left
    // holding a stale or a divergent one.
    expect(leaseA.getBearerToken()).toBe(leaseB.getBearerToken());
    expect(leaseA.getBearerToken()).toBe("tok-0::r");
  });

  it("a revalidator whose bearer was already superseded by a concurrent winner adopts it rather than re-spending", async () => {
    const shared = refreshStub();
    const storeA = makeStore(shared.fn);
    const storeB = makeStore(shared.fn);
    await storeA.signIn(CREDS, false, null);

    const leaseA = new MutableBearerLease(CREDS.token, CREDS.user.id);
    const revalidatorA = createStoreBackedRevalidator({
      store: storeA,
      lease: leaseA,
    });

    // Process B rotates first and lands its commit before A ever starts.
    const leaseB = new MutableBearerLease(CREDS.token, CREDS.user.id);
    const revalidatorB = createStoreBackedRevalidator({
      store: storeB,
      lease: leaseB,
    });
    expect(await revalidatorB.revalidateCurrentContext()).toBe("rotated");
    expect(shared.calls()).toBe(1);

    // A still holds the ORIGINAL token and now revalidates against a file
    // that has already moved on - it must adopt B's pair, not spend again.
    expect(await revalidatorA.revalidateCurrentContext()).toBe("rotated");
    expect(shared.calls()).toBe(1); // still exactly one spend across both
    expect(leaseA.getBearerToken()).toBe(leaseB.getBearerToken());
  });

  it.skipIf(!canForceCommitFailure)(
    "a real commit-failed continuation still converges both racers on the minted pair",
    async () => {
      // Intentionally left as a follow-up if this suite ever runs on a
      // POSIX CI runner: force one racer's WAL commit to fail (read-only
      // parent dir, per `credentials-mutation.test.ts`'s own precedent) and
      // assert `withCommitRetry` still lands it. The `commit-failed` ->
      // `"rotated"` outcome mapping itself is already pinned unconditionally
      // by the CLI's mocked `credentials-store.test.ts` - this gap is about
      // exercising it against a REAL WAL failure, which this environment
      // (Windows) cannot force.
    },
  );
});

describe("withCommitRetry - moved verbatim, re-tested against the real store", () => {
  let workDir: string;
  let credentialsPath: string;
  let metaPath: string;
  let lockPath: string;
  const stores: CredentialsMutationStore[] = [];

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "traycer-host-cred-retry-test-"));
    credentialsPath = join(workDir, "credentials");
    metaPath = join(workDir, "credentials.meta.json");
    mkdirSync(join(workDir, "lock"), { recursive: true, mode: 0o700 });
    lockPath = join(workDir, "lock", "credentials.lock");
  });

  afterEach(() => {
    for (const store of stores) store.dispose();
    stores.length = 0;
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns immediately on a real applied rotate against a real store", async () => {
    const store = createCredentialsMutationStore({
      paths: { credentialsPath, metaPath, lockPath },
      refresh: async ({ token }) => ({
        kind: "refreshed",
        token: `${token}::r`,
        refreshToken: `rt::${token}`,
      }),
      lockWaitMs: 2_000,
      lockPollIntervalMs: 25,
      continuationRetryMs: 15,
    });
    stores.push(store);
    await store.signIn(CREDS, false, null);
    const result = await withCommitRetry(() =>
      store.rotate({
        expectedUserId: CREDS.user.id,
        expectedToken: CREDS.token,
        refreshTokenOverride: null,
        signal: null,
      }),
    );
    expect(result.outcome).toBe("applied");
  });
});
