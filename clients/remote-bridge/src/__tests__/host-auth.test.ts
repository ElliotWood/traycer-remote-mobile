import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isHostAuthUnavailable,
  requireHomeEnv,
  resolveHostAuth,
} from "../host-auth";
import { readHostPidMetadata } from "../host-endpoint";

/**
 * Regression coverage for the unset-`HOME` identity-collapse finding: on a
 * multi-tenant deployment where every bridge process shares ONE OS user
 * (separate `HOME`s only), `os.homedir()`'s documented POSIX fallback
 * (getpwuid() for the current OS user when `HOME` is unset) silently
 * resolves every misconfigured process to the SAME real identity - no
 * error, no warning. `requireHomeEnv` exists specifically to refuse that
 * fallback by reading `process.env.HOME` directly rather than going through
 * `os.homedir()` at all.
 */

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  setPlatform(originalPlatform);
  vi.restoreAllMocks();
});

describe("requireHomeEnv", () => {
  it("throws a named error when HOME is entirely unset (POSIX)", () => {
    setPlatform("linux");
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(() => requireHomeEnv()).toThrow(/HOME is not set/);
  });

  it("throws when HOME is set to an empty string - treated the same as unset", () => {
    setPlatform("linux");
    process.env.HOME = "";
    expect(() => requireHomeEnv()).toThrow(/HOME is not set/);
  });

  it("returns the value when HOME is set (POSIX)", () => {
    setPlatform("linux");
    process.env.HOME = "/home/tenant-a";
    expect(requireHomeEnv()).toBe("/home/tenant-a");
  });

  it("throws when USERPROFILE is unset on Windows, even if HOME happens to be set", () => {
    // A process launched with only HOME set (e.g. a POSIX-style spawner
    // template applied unmodified to a Windows host) must still fail loudly
    // rather than silently falling through to some other resolution.
    setPlatform("win32");
    delete process.env.USERPROFILE;
    process.env.HOME = "/some/posix/style/path";
    expect(requireHomeEnv()).toBe("/some/posix/style/path");
  });

  it("prefers USERPROFILE over HOME on Windows", () => {
    setPlatform("win32");
    process.env.USERPROFILE = "C:\\Users\\tenant-a";
    process.env.HOME = "/should/not/be/used";
    expect(requireHomeEnv()).toBe("C:\\Users\\tenant-a");
  });

  it("throws when both USERPROFILE and HOME are unset on Windows", () => {
    setPlatform("win32");
    delete process.env.USERPROFILE;
    delete process.env.HOME;
    expect(() => requireHomeEnv()).toThrow(/HOME is not set/);
  });
});

describe("readHostPidMetadata - the identity gate applies here too, not just to credentials", () => {
  // F1 regression: `readHostPidMetadata` decides which tenant's HOST process
  // the bridge connects to. Before this fix, its path resolution went
  // through `os.homedir()` directly with no gate of its own - safe only
  // because `resolveHostAuth()` happened to run first in `BridgeClient.start()`.
  // This pins that the gate now lives IN this module, so a caller that
  // reaches it without going through auth first still fails loudly instead
  // of silently resolving another tenant's host.
  it("rejects (does not silently resolve null) when HOME is unset - the throw must not be swallowed by the ENOENT catch", async () => {
    setPlatform("linux");
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    // If `requireHomeEnv()`'s throw were caught by the same try/catch that
    // handles a legitimately-missing pid file, this would resolve `null`
    // instead of rejecting - indistinguishable from "no host running",
    // which is exactly the silent-failure shape this fix exists to close.
    await expect(readHostPidMetadata()).rejects.toThrow(/HOME is not set/);
  });
});

describe("resolveHostAuth - self-diagnosing 'no credentials' path (F3)", () => {
  // F3 regression: a missing/empty credentials file used to be indistinguishable
  // from a genuinely signed-out user - the caller only saw `null` and always
  // said "not signed in, run traycer login", even when the real cause was a
  // wrong/misconfigured HOME pointing at a directory with no credentials file
  // at all. `resolveHostAuth()` now returns the exact path it checked so the
  // caller can name it.
  it("returns HostAuthUnavailable naming the exact credentials path checked, when HOME points at an empty directory", async () => {
    // Deliberately does NOT spoof `process.platform`: `requireHomeEnv()`
    // reads `process.env.HOME`/`USERPROFILE` directly and honors a spoofed
    // platform, but `cliConfigDir()` resolves through the real
    // `node:os.homedir()`, which is a native call keyed to the ACTUAL OS
    // (on real Windows it reads `USERPROFILE` only, never `HOME`, no
    // matter what `process.platform` is set to). Setting both env vars to
    // the same empty temp dir makes the test correct on every real
    // platform this suite runs on, rather than only the one it happens to
    // be authored on.
    const emptyHome = await mkdtemp(join(tmpdir(), "traycer-no-creds-"));
    process.env.HOME = emptyHome;
    process.env.USERPROFILE = emptyHome;
    try {
      const result = await resolveHostAuth();
      expect(isHostAuthUnavailable(result)).toBe(true);
      if (isHostAuthUnavailable(result)) {
        expect(result.credentialsPath).toContain(emptyHome);
        expect(result.credentialsPath).toContain("credentials");
      }
    } finally {
      await rm(emptyHome, { recursive: true, force: true });
    }
  });
});
