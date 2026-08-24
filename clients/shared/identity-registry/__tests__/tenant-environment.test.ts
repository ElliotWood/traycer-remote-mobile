import { describe, expect, it } from "vitest";
import {
  buildTenantEnvironment,
  DEFAULT_INHERITED_ENV_ALLOWLIST,
} from "../tenant-environment";
import type { MappedAadObjectId, TenantMapping } from "../types";

function tenant(home: string, hostId: string): TenantMapping {
  return {
    home,
    hostId,
    entraOid: "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d" as MappedAadObjectId,
    traycerUserId: null,
  };
}

describe("buildTenantEnvironment — isolation", () => {
  it("two tenants get non-overlapping HOME/USERPROFILE", () => {
    const parentEnv = { PATH: "/usr/bin" };
    const alice = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    const bob = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/bob", "host-bob"),
      parentEnv,
    });
    expect(alice.HOME).toBe("/srv/traycer/alice");
    expect(bob.HOME).toBe("/srv/traycer/bob");
    expect(alice.HOME).not.toBe(bob.HOME);
    expect(alice.USERPROFILE).toBe(alice.HOME);
    expect(bob.USERPROFILE).toBe(bob.HOME);
  });

  it("the tenant's HOME/USERPROFILE always win over a parentEnv that itself sets HOME/USERPROFILE — platform-independent regression guard", () => {
    // `os.homedir()` consults DIFFERENT variables per platform (USERPROFILE
    // on Windows, HOME on Linux/macOS) — a real-process spawn test alone
    // only exercises whichever one the CI/dev machine's OS actually reads,
    // and would miss a regression in the other. This is a pure logic
    // assertion instead: neither variable may ever leak from parentEnv
    // regardless of which platform runs the suite.
    const parentEnv = {
      HOME: "/parent/process/home",
      USERPROFILE: "C:\\parent\\process\\home",
      PATH: "/usr/bin",
    };
    const env = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    expect(env.HOME).toBe("/srv/traycer/alice");
    expect(env.USERPROFILE).toBe("/srv/traycer/alice");
  });

  it("never mutates the parent's own process.env", () => {
    const beforeHome = process.env.HOME;
    const beforeUserProfile = process.env.USERPROFILE;
    buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv: process.env,
    });
    expect(process.env.HOME).toBe(beforeHome);
    expect(process.env.USERPROFILE).toBe(beforeUserProfile);
  });

  it("never mutates the parentEnv object passed in", () => {
    const parentEnv = { PATH: "/usr/bin" };
    const snapshot = { ...parentEnv };
    buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    expect(parentEnv).toEqual(snapshot);
  });
});

describe("buildTenantEnvironment — allowlist, not a process.env spread", () => {
  it("a parent-set sentinel variable not on the allowlist is ABSENT from the child env", () => {
    const parentEnv = {
      PATH: "/usr/bin",
      SUPER_SECRET_ADMIN_TOKEN: "do-not-leak-this",
    };
    const env = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    expect(env.SUPER_SECRET_ADMIN_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("MUTATION PROBE: this test is what a `{ ...process.env, HOME }` implementation would fail. If it ever passes with the sentinel present, the allowlist has been replaced by a spread — the exact defect that leaks one tenant's parent environment into every tenant child.", () => {
    const parentEnv = { PATH: "/usr/bin", ANOTHER_SECRET: "leak-me-not" };
    const env = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    expect(Object.keys(env).sort()).toEqual(
      ["HOME", "PATH", "USERPROFILE"].sort(),
    );
  });

  it("uses the REAL shipped default allowlist, not an injected one, when `allowlist` is omitted", () => {
    const parentEnv: Record<string, string> = {};
    for (const key of DEFAULT_INHERITED_ENV_ALLOWLIST) {
      parentEnv[key] = `value-for-${key}`;
    }
    parentEnv.NOT_ON_THE_ALLOWLIST = "should-not-appear";
    const env = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv,
    });
    for (const key of DEFAULT_INHERITED_ENV_ALLOWLIST) {
      expect(env[key]).toBe(`value-for-${key}`);
    }
    expect(env.NOT_ON_THE_ALLOWLIST).toBeUndefined();
  });

  it("extra per-spawn values are applied but cannot override HOME/USERPROFILE", () => {
    const env = buildTenantEnvironment({
      tenant: tenant("/srv/traycer/alice", "host-alice"),
      parentEnv: {},
      extra: { TRAYCER_EPIC_ID: "epic-1", HOME: "/attacker/controlled" },
    });
    expect(env.TRAYCER_EPIC_ID).toBe("epic-1");
    expect(env.HOME).toBe("/srv/traycer/alice");
  });
});
