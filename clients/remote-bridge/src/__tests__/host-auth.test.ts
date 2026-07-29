import { afterEach, describe, expect, it, vi } from "vitest";
import { requireHomeEnv } from "../host-auth";

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
