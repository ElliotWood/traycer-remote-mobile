import {
  createCredentialsMutationStore,
  type CredentialsMutationStore,
  type MutationResult,
} from "@traycer/protocol/config/credentials-mutation";
import { cliCredentialsPath } from "@traycer/protocol/config/paths";
import { refreshOnceAbortable } from "./auth-validation";
import type { BearerLease, OpenFrameBearerSource } from "./bearer-source";
import type {
  AuthRevalidator,
  AuthorityBoundAuthRevalidator,
  RevalidateOutcome,
} from "./bearer-revalidator";

/**
 * WHY THIS FILE EXISTS (T0b): a headless Node client that is not
 * `clients/traycer-cli` - today, `clients/remote-bridge`; `remote-agent`
 * next - needs the exact same locked, single-use-refresh-token-safe bearer
 * rotation the CLI has always had, so it can run genuinely unattended past
 * the bearer's ~4h TTL. That capability lived ONLY in
 * `clients/traycer-cli/src/store/credentials-store.ts`, a CLI-private
 * module (no `exports` for library consumption). A headless client
 * depending on `clients/traycer-cli` would be the wrong direction - the CLI
 * depends on `clients/shared`, never the reverse, and its published-package
 * build bundles `shared` in on exactly that assumption.
 *
 * The underlying lock/WAL primitive (`createCredentialsMutationStore`,
 * single-spend-per-refresh-token guarantee, `${credentials}.lock`) was
 * ALREADY shared - it lives in `@traycer/protocol/config/credentials-mutation`
 * and is the same code Desktop's `FileTokenStore` and the CLI both call. What
 * was missing was the thin, non-CLI-specific wiring around it:
 * `createStoreBackedRevalidator` and `withCommitRetry` below are moved
 * VERBATIM from `credentials-store.ts` (only import paths changed) - neither
 * ever referenced CLI config, which the CLI's own existing unit tests
 * already proved by exercising them against a fully mocked
 * `CredentialsMutationStore`. `createCliCredentialsStore` itself (which DOES
 * read CLI-specific `config.environment` / dev-desktop-slot
 * `effectiveAuthnBaseUrl` overrides) was deliberately left in place in the
 * CLI, unmodified - `createHostCredentialsStore` below is its sibling for a
 * plain, always-production headless process: same lock file, same WAL, same
 * paths (`cliCredentialsPath("production")`), no dev-desktop-slot
 * indirection because a headless bridge has no dev-desktop run to be one of.
 *
 * WHY THIS MATTERS BEYOND THE CODE: the product reason this file exists at
 * all is that an always-on channel bot's entire value proposition is ambient
 * access WITHOUT a machine needing Desktop open. If refresh only ever came
 * from a co-resident Desktop/CLI process, that requirement would quietly
 * remove the reason to build the bot - fine in a demo, silently dead hours
 * later on exactly the unattended deployment the bot exists to serve. This
 * store is what makes the bridge a genuinely long-running process instead of
 * one with a ~4h ceiling.
 *
 * `clients/traycer-cli/src/store/credentials-store.ts` re-exports
 * `createStoreBackedRevalidator` / `withCommitRetry` from here so every
 * existing CLI import (`monitor.ts`, `host-rpc.ts`, the CLI's own test file)
 * resolves unchanged - this was a move, not a fork.
 */

// Mirrors `createCliCredentialsStore`'s constants exactly (duplicated, not
// shared, per the narrow-lift-and-shift constraint - these are the CLI's
// own tuned values, not a joint contract that needs unifying here).
const LOCK_WAIT_MS = 12_000;
const LOCK_POLL_INTERVAL_MS = 50;
const CONTINUATION_RETRY_MS = 1_000;
const COMMIT_RETRY_ATTEMPTS = 3;

/**
 * Builds a `CredentialsMutationStore` over the shared, environment-agnostic
 * production credentials file (`~/.traycer/cli/credentials`) - the same file
 * `traycer login` writes and the Desktop reads. No dev-desktop-slot override
 * (unlike `createCliCredentialsStore`): a headless bridge process always
 * targets production, and the refresh call uses the file's OWN stored
 * `authnBaseUrl` verbatim (`refreshOnceAbortable` takes it as a plain
 * argument - no environment indirection needed).
 */
export function createHostCredentialsStore(): CredentialsMutationStore {
  const credentialsPath = cliCredentialsPath("production");
  return createCredentialsMutationStore({
    paths: {
      credentialsPath,
      metaPath: `${credentialsPath}.meta.json`,
      lockPath: `${credentialsPath}.lock`,
    },
    // Neither "cli" nor "desktop": a headless bridge process (`remote-bridge`,
    // `remote-agent` next) has no closer fit in this narrow union, so it omits
    // the field like any other unclassified client - see `refreshOnceAbortable`.
    refresh: (args) => refreshOnceAbortable({ ...args, clientKind: null }),
    lockWaitMs: LOCK_WAIT_MS,
    lockPollIntervalMs: LOCK_POLL_INTERVAL_MS,
    continuationRetryMs: CONTINUATION_RETRY_MS,
  });
}

/**
 * The store-backed bearer revalidator, backed by the locked `rotate`
 * mutation. Every refresh runs inside the shared credentials file lock, so
 * this process's refresh and a concurrent Desktop/CLI refresh can never
 * double-spend the single-use refresh token.
 *
 * Moved verbatim from `clients/traycer-cli/src/store/credentials-store.ts`
 * (see this file's top docblock) - no logic changed, only relocated.
 */
export function createStoreBackedRevalidator(args: {
  readonly store: CredentialsMutationStore;
  readonly lease: BearerLease;
}): AuthRevalidator &
  AuthorityBoundAuthRevalidator & {
    revalidateCurrentContext(): Promise<RevalidateOutcome>;
  } {
  const { store, lease } = args;
  const revalidateCurrentContext = async (): Promise<RevalidateOutcome> => {
    // Boundary contract: NEVER throws - every failure, including a released
    // lease or a store I/O fault, maps to an outcome so callers decide
    // recovery without a try/catch and without risking an unhandled
    // rejection.
    try {
      const current = lease.getBearerToken();
      const result = await withCommitRetry(() =>
        store.rotate({
          expectedUserId: lease.identity.userId,
          expectedToken: current,
          // `null` -> rotate spends the file's own refresh token (this
          // caller never overrides it; that override is migration-only).
          refreshTokenOverride: null,
          signal: null,
        }),
      );
      switch (result.outcome) {
        case "applied":
        case "superseded":
        case "commit-failed":
          // applied     -> refreshed + committed;
          // superseded  -> a sibling / Desktop already rotated - adopt it,
          //               spend nothing;
          // commit-failed -> the refresh was spent but the local commit
          //               failed; the minted pair is server-issued and live
          //               in the store's in-memory overlay (withCommitRetry
          //               already re-drove the landing), so the host
          //               accepts it.
          // Rotate the lease to whichever token we settled on.
          if (result.credentials !== null) {
            lease.rotate(result.credentials.token);
          }
          return "rotated";
        case "refresh-network":
        case "lock-busy":
          // Transient, bearer untouched: a refresh transport blip, or a lock
          // held past the wait budget by a concurrent Desktop/CLI mutation.
          // Neither is a dead credential - stay in reconnect backoff and
          // retry.
          return "network-error";
        case "deleted":
        case "tombstoned":
        case "user-mismatch":
        case "refresh-rejected":
          // Terminal for this lease: the file is gone (concurrent logout), a
          // sign-out stands, the file switched to a different account (never
          // adopt cross-user), or the refresh token is dead.
          return "rejected";
      }
    } catch {
      return "network-error";
    }
  };
  return {
    revalidateCurrentContext,
    // The unary auth-aware messenger is authority-bound: it revalidates the
    // exact bearer that produced the rejected open frame. Refresh only when
    // that bearer is still THIS lease; a `superseded` bearer means a newer
    // context already replaced it, so spend nothing.
    async revalidateExpectedBearer(
      expected: OpenFrameBearerSource,
    ): Promise<RevalidateOutcome | "superseded"> {
      if (expected !== lease) {
        return "superseded";
      }
      return revalidateCurrentContext();
    },
  };
}

/**
 * Run a store op, and if it returns `commit-failed` (the refresh was spent
 * but the local commit failed, arming an in-memory continuation), re-drive
 * it a bounded number of times before returning - a short-lived process's
 * background commit-failed retry timer might never fire otherwise.
 *
 * Re-invoking the op re-runs the store's first-gate, which drives the
 * pending continuation under the lock: for a `rotate` a landed continuation
 * surfaces as `superseded` (the file now holds the minted pair).
 *
 * Moved verbatim from `clients/traycer-cli/src/store/credentials-store.ts`.
 */
export async function withCommitRetry(
  op: () => Promise<MutationResult>,
): Promise<MutationResult> {
  let result = await op();
  for (
    let attempt = 0;
    attempt < COMMIT_RETRY_ATTEMPTS && result.outcome === "commit-failed";
    attempt += 1
  ) {
    await delay(CONTINUATION_RETRY_MS);
    result = await op();
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
