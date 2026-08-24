import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { buildTenantEnvironment } from "../tenant-environment";
import type { MappedAadObjectId, TenantMapping } from "../types";

/**
 * The one test in this delivery that is NOT mocked: it proves the isolation
 * property `buildTenantEnvironment` (and therefore `TenantConnectionManager`)
 * exists for, using the real, unmodified `@traycer/protocol/config/credentials`
 * resolution code — the same code the actual Traycer host and CLI use to
 * pin an owner. A mocked `spawnFn` (used everywhere else in this delivery)
 * proves the MANAGER's bookkeeping is correct; it cannot prove the
 * isolation itself, because the mock never touches `os.homedir()`.
 *
 * Uses `mkdtempSync` for both tenant homes deliberately — never hand-named
 * anything resembling `alice`/`Alice`. A case-only difference would pass on
 * this Windows dev machine (and macOS default) without ever exercising real
 * isolation, since NTFS/APFS resolve case-variant paths to the SAME
 * directory — see `registry-config.ts`'s `home` case-insensitivity rule for
 * the full hazard. `mkdtempSync`'s random suffixes guarantee these two
 * temp directories are unrelated strings, not case variants of one another.
 *
 * The probe is spawned with `bun`, not `node` — the repo's own convention
 * ("run vitest under Node, not bun") is about the TEST RUNNER, where bun's
 * ESM resolution has broken zod v4 before; this is a spawned CHILD process
 * running a standalone script that touches no zod at all. `protocol/src/
 * config/credentials.ts` imports its sibling `./credentials-fs` WITHOUT an
 * extension — normal for this codebase's bundler-mediated builds, but not
 * resolvable by Node's native ESM loader run directly against `.ts` sources
 * (confirmed: `node --experimental-strip-types` throws `ERR_MODULE_NOT_FOUND`
 * on that exact import). Bun resolves it the same way this repo's real
 * build tooling does, without this test touching a file it must leave
 * unmodified.
 *
 * BUN RESOLUTION — this repo's CI (`.github/workflows/test.yml`) installs
 * bun via `oven-sh/setup-bun`, which puts it on `PATH`, not necessarily at
 * `~/.bun/bin/` (that's bun's own installer's convention, used for local
 * dev where it may NOT be on `PATH` — the exact situation this repo's own
 * `mobile-client-toolchain` notes hit). Checking only the hardcoded homedir
 * path would make this test SILENTLY SKIP in CI if the two locations ever
 * diverge — a green summary line that means "the isolation proof never
 * ran," indistinguishable from "it ran and passed." This repo has already
 * paid for that exact failure shape once (see `test.yml`'s own comment on
 * why the macOS packaging job exists — the ubuntu matrix's `darwin`-gated
 * tests silently skip and needed a whole second job to get real coverage).
 * So: resolve `bun` from `PATH` first (CI's actual mechanism), fall back to
 * the homedir convention for local dev, and if `CI` is set and NEITHER
 * resolves, THROW rather than skip — absence of bun in CI is a broken
 * environment, not "this environment can't run the proof."
 */
function resolveBunPath(): string | null {
  const exeName = process.platform === "win32" ? "bun.exe" : "bun";
  const pathDirs = (process.env.PATH ?? "").split(
    process.platform === "win32" ? ";" : ":",
  );
  for (const dir of pathDirs) {
    if (dir.length === 0) continue;
    const candidate = join(dir, exeName);
    if (existsSync(candidate)) return candidate;
  }
  const homedirCandidate = join(homedir(), ".bun", "bin", exeName);
  return existsSync(homedirCandidate) ? homedirCandidate : null;
}

const BUN_PATH = resolveBunPath();

if (BUN_PATH === null && process.env.CI !== undefined) {
  throw new Error(
    "REAL SPAWN isolation test requires bun, and none was found on PATH or at ~/.bun/bin/ — " +
      "this is a broken CI environment, not one that legitimately can't run the proof. " +
      "The one test that proves tenant isolation must not silently disappear from a green CI run.",
  );
}

const PROBE_SCRIPT = join(
  __dirname,
  "fixtures",
  "print-credentials-user-id.ts",
);

function provisionTenantHome(userId: string): string {
  const home = mkdtempSync(join(tmpdir(), "a2-real-spawn-"));
  const credentialsDir = join(home, ".traycer", "cli");
  mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(
    join(credentialsDir, "credentials"),
    JSON.stringify({
      token: "fake-token-not-a-real-credential",
      refreshToken: "fake-refresh-token-not-a-real-credential",
      authnBaseUrl: "http://127.0.0.1:1",
      savedAt: new Date(0).toISOString(),
      user: { id: userId, email: "", name: userId },
    }),
    "utf8",
  );
  return home;
}

function tenantFor(home: string, hostId: string): TenantMapping {
  return {
    home,
    hostId,
    entraOid: "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d" as MappedAadObjectId,
    traycerUserId: null,
  };
}

const describeOrSkip = BUN_PATH !== null ? describe : describe.skip;

describeOrSkip(
  "REAL SPAWN: two different HOMEs resolve two different user.ids",
  () => {
    it("proves isolation via the real credentials-resolution code, not the manager's mocked spawnFn", () => {
      // Safe: this whole `describe` block only runs when `describeOrSkip ===
      // describe`, which only happens when `BUN_PATH !== null` (see above).
      const bunPath = BUN_PATH!;
      const aliceHome = provisionTenantHome("real-user-id-alice-9f2c");
      const bobHome = provisionTenantHome("real-user-id-bob-7d4e");
      try {
        const aliceEnv = buildTenantEnvironment({
          tenant: tenantFor(aliceHome, "host-alice"),
          parentEnv: process.env,
        });
        const bobEnv = buildTenantEnvironment({
          tenant: tenantFor(bobHome, "host-bob"),
          parentEnv: process.env,
        });

        const aliceResult = spawnSync(bunPath, [PROBE_SCRIPT], {
          env: aliceEnv,
          encoding: "utf8",
        });
        const bobResult = spawnSync(bunPath, [PROBE_SCRIPT], {
          env: bobEnv,
          encoding: "utf8",
        });

        expect(aliceResult.status).toBe(0);
        expect(bobResult.status).toBe(0);
        expect(aliceResult.stdout.trim()).toBe("real-user-id-alice-9f2c");
        expect(bobResult.stdout.trim()).toBe("real-user-id-bob-7d4e");
        expect(aliceResult.stdout.trim()).not.toBe(bobResult.stdout.trim());

        // The regression this test exists to catch: a broken environment
        // construction (e.g. HOME pointed at the wrong tenant, or the parent's
        // own HOME leaking through) reads the WRONG user.id with zero error —
        // exactly the failure the bridge pair reproduced live. Also assert
        // neither child accidentally resolved a nonexistent-file default.
        expect(aliceResult.stdout.trim()).not.toBe("NONE");
        expect(bobResult.stdout.trim()).not.toBe("NONE");
      } finally {
        rmSync(aliceHome, { recursive: true, force: true });
        rmSync(bobHome, { recursive: true, force: true });
      }
    }, 30_000);
  },
);
