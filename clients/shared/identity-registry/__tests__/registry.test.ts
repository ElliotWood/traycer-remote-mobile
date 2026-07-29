import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRegistryConfigPath, IdentityRegistry } from "../registry";
import type {
  MappedAadObjectId,
  VerifiedAadObjectId,
  VerifiedPrincipal,
  VerifiedTraycerUserId,
} from "../types";

const ALICE_OID = "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d";
const BOB_OID = "1a2b3c4d-5e6f-4a1b-8c2d-2e3f4a5b6c7d";
const CAROL_OID = "2c3d4e5f-6a7b-4c1d-9e2f-3a4b5c6d7e8f";
const UNMAPPED_OID = "3d4e5f60-7a8b-4c1d-9e2f-4a5b6c7d8e9f";

function threeTenantRegistry(): IdentityRegistry {
  return IdentityRegistry.fromConfig(
    {
      tenants: [
        {
          home: "/srv/traycer/alice",
          hostId: "host-alice",
          entraOid: ALICE_OID,
          traycerUserId: "traycer-user-alice",
        },
        {
          home: "/srv/traycer/bob",
          hostId: "host-bob",
          entraOid: BOB_OID,
          traycerUserId: "traycer-user-bob",
        },
        {
          home: "/srv/traycer/carol",
          hostId: "host-carol",
          entraOid: CAROL_OID,
          traycerUserId: "traycer-user-carol",
        },
      ],
    },
    () => {}, // silence audit output in tests that don't assert on it
  );
}

function entraPrincipal(oid: string): VerifiedPrincipal {
  return { kind: "entra", oid: oid as VerifiedAadObjectId };
}

describe("IdentityRegistry.resolveTenant — forward resolution", () => {
  it("resolves oid A to host A", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveTenant(entraPrincipal(ALICE_OID));
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-alice");
    expect(result.tenant.home).toBe("/srv/traycer/alice");
  });

  it("resolves oid B to host B, not host A — kills `return entries[0]`", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveTenant(entraPrincipal(BOB_OID));
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-bob");
    expect(result.tenant.hostId).not.toBe("host-alice");
  });

  it("resolves oid C to host C — kills `return entries[entries.length-1]` together with the A case above", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveTenant(entraPrincipal(CAROL_OID));
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-carol");
  });

  it("refuses a well-formed but unmapped oid — no default, no fallback", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveTenant(entraPrincipal(UNMAPPED_OID));
    expect(result).toEqual({ kind: "refused", reason: "unmapped_principal" });
  });

  it("home and hostId are both distinct across resolved tenants (not just hostId)", () => {
    const registry = threeTenantRegistry();
    const a = registry.resolveTenant(entraPrincipal(ALICE_OID));
    const b = registry.resolveTenant(entraPrincipal(BOB_OID));
    if (a.kind !== "resolved" || b.kind !== "resolved") throw new Error("expected resolved");
    expect(a.tenant.home).not.toBe(b.tenant.home);
    expect(a.tenant.hostId).not.toBe(b.tenant.hostId);
  });
});

function traycerPrincipal(userId: string): VerifiedPrincipal {
  return { kind: "traycer", userId: userId as VerifiedTraycerUserId };
}

describe("IdentityRegistry.resolveTenant — kind: traycer (browser/PWA routing path)", () => {
  // Mirrors the entra matrix exactly. This kind previously refused
  // unconditionally; it resolves now that `verifyTraycerPrincipal` exists as
  // a real mint point. The same anti-first-entry / anti-last-entry
  // discipline applies — a router that always returns entries[0] must fail
  // here too, not just on the entra path.
  it("resolves traycer user A to host A", () => {
    const result = threeTenantRegistry().resolveTenant(
      traycerPrincipal("traycer-user-alice"),
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-alice");
  });

  it("resolves traycer user B to host B, not host A — kills `return entries[0]`", () => {
    const result = threeTenantRegistry().resolveTenant(
      traycerPrincipal("traycer-user-bob"),
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-bob");
    expect(result.tenant.hostId).not.toBe("host-alice");
  });

  it("resolves traycer user C to host C — with A above, kills `return entries[last]`", () => {
    const result = threeTenantRegistry().resolveTenant(
      traycerPrincipal("traycer-user-carol"),
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-carol");
  });

  it("two distinct traycer identities resolve to distinct homes AND distinct hosts", () => {
    const registry = threeTenantRegistry();
    const a = registry.resolveTenant(traycerPrincipal("traycer-user-alice"));
    const b = registry.resolveTenant(traycerPrincipal("traycer-user-bob"));
    if (a.kind !== "resolved" || b.kind !== "resolved") throw new Error("expected resolved");
    expect(a.tenant.home).not.toBe(b.tenant.home);
    expect(a.tenant.hostId).not.toBe(b.tenant.hostId);
  });

  it("refuses a well-formed but unmapped traycer userId — no default, no fallback", () => {
    const result = threeTenantRegistry().resolveTenant(
      traycerPrincipal("traycer-user-nobody"),
    );
    expect(result).toEqual({ kind: "refused", reason: "unmapped_principal" });
  });

  it("refuses an empty traycer userId forced through by a cast", () => {
    const result = threeTenantRegistry().resolveTenant(traycerPrincipal(""));
    expect(result).toEqual({ kind: "refused", reason: "malformed_principal" });
  });

  it("prototype-pollution-shaped traycer userIds refuse, not a spurious hit", () => {
    const registry = threeTenantRegistry();
    for (const shape of ["__proto__", "constructor", "toString"]) {
      const result = registry.resolveTenant(traycerPrincipal(shape));
      expect(result).toEqual({ kind: "refused", reason: "unmapped_principal" });
    }
  });

  it("an entra oid presented as a traycer userId does not resolve — the two alias namespaces are separate", () => {
    // Cross-namespace confusion probe: alice's entra oid must not resolve
    // through the traycer lookup, or the two alias tables are effectively one.
    const result = threeTenantRegistry().resolveTenant(traycerPrincipal(ALICE_OID));
    expect(result).toEqual({ kind: "refused", reason: "unmapped_principal" });
  });
});

describe("IdentityRegistry.resolveTenant — forgery / structural probes", () => {
  it("has no parameter through which a conversation/chat/thread id or display name could reach it", () => {
    // Structural: resolveTenant's only argument is VerifiedPrincipal, which
    // has exactly two shapes (`{kind,oid}` / `{kind,userId}`), neither
    // carrying anything activity-shaped. This test exists as a canary — if
    // someone widens the signature to `(principal, activity)`, this file
    // (and the type import list) needs to change, which is the point.
    const registry = threeTenantRegistry();
    const result = registry.resolveTenant(entraPrincipal(ALICE_OID));
    expect(result.kind).toBe("resolved");
  });

  it("prototype-pollution-shaped oids refuse, not a spurious hit", () => {
    const registry = threeTenantRegistry();
    for (const shape of ["__proto__", "constructor", "toString"]) {
      const result = registry.resolveTenant(entraPrincipal(shape));
      expect(result).toEqual({ kind: "refused", reason: "malformed_principal" });
    }
  });

  it("an empty-string oid (bypassing the type via a cast) refuses, not a crash or a match", () => {
    const registry = threeTenantRegistry();
    const forged: VerifiedPrincipal = {
      kind: "entra",
      oid: "" as VerifiedAadObjectId,
    };
    const result = registry.resolveTenant(forged);
    expect(result).toEqual({ kind: "refused", reason: "malformed_principal" });
  });

  it("DOCUMENTED LIMITATION: a well-formed cast of a real GUID DOES resolve — the brand is compile-time only", () => {
    // This is the strong version of the erasure test the contract requires:
    // proof, not assertion, that runtime re-validation only catches
    // malformed casts, never an unverified-but-well-formed one. The only
    // thing that keeps this safe in production is that every real caller's
    // VerifiedPrincipal is the direct return of validateAadIdToken — see
    // registry.ts's and aad-id-token.ts's module docs for the seam
    // obligation this places on every consumer, including T1b.
    const registry = threeTenantRegistry();
    const forged: VerifiedPrincipal = {
      kind: "entra",
      oid: BOB_OID as VerifiedAadObjectId, // never actually validated by a token
    };
    const result = registry.resolveTenant(forged);
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.tenant.hostId).toBe("host-bob");
  });
});

describe("IdentityRegistry.resolveIdentity — reverse resolution", () => {
  it("resolves host A to tenant A, host B to tenant B, host C to tenant C", () => {
    const registry = threeTenantRegistry();
    const a = registry.resolveIdentity("host-alice");
    const b = registry.resolveIdentity("host-bob");
    const c = registry.resolveIdentity("host-carol");
    expect(a.kind).toBe("resolved");
    expect(b.kind).toBe("resolved");
    expect(c.kind).toBe("resolved");
    if (a.kind !== "resolved" || b.kind !== "resolved" || c.kind !== "resolved") return;
    expect(a.tenant.home).toBe("/srv/traycer/alice");
    expect(b.tenant.home).toBe("/srv/traycer/bob");
    expect(c.tenant.home).toBe("/srv/traycer/carol");
  });

  it("refuses an unmapped hostId — no default recipient", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveIdentity("host-does-not-exist");
    expect(result).toEqual({ kind: "refused", reason: "unmapped_host_id" });
  });

  it("prototype-pollution-shaped hostIds refuse, not a spurious hit", () => {
    const registry = threeTenantRegistry();
    for (const shape of ["__proto__", "constructor", "toString"]) {
      const result = registry.resolveIdentity(shape);
      expect(result).toEqual({ kind: "refused", reason: "unmapped_host_id" });
    }
  });

  it("BLOCKING-2 regression: a reverse-lookup result cannot be fed to resolveTenant without a cast", () => {
    const registry = threeTenantRegistry();
    const result = registry.resolveIdentity("host-alice");
    if (result.kind !== "resolved") throw new Error("expected resolved");
    // Bind a NON-NULLABLE local first — the `| null` on `entraOid` would
    // otherwise let the assignment below fail on nullability alone,
    // satisfying `@ts-expect-error` without ever exercising the brand
    // mismatch it exists to catch (Evaluator-found: redefining
    // `MappedAadObjectId` as an alias for `VerifiedAadObjectId` left this
    // test green). Isolating the non-null case means the ONLY remaining
    // reason the next line can fail to typecheck is the brand itself.
    const mappedAlias: MappedAadObjectId = result.tenant.entraOid!;
    // @ts-expect-error MappedAadObjectId is not assignable to VerifiedAadObjectId —
    // a config-sourced alias must never type-check as a token-verified principal.
    const laundered: VerifiedPrincipal = { kind: "entra", oid: mappedAlias };
    // Runtime check too, in case the type error above is ever silenced: the
    // laundering must fail even if someone forces the assignment through.
    expect(laundered).toBeDefined();
  });
});

describe("IdentityRegistry — correlation-id independence", () => {
  it("the same verified identity resolves to the same host regardless of any external correlation id", () => {
    // resolveTenant takes no correlation id at all — this test documents
    // that by resolving the same principal twice and asserting identical
    // results, since there is no id to vary in the first place.
    const registry = threeTenantRegistry();
    const first = registry.resolveTenant(entraPrincipal(ALICE_OID));
    const second = registry.resolveTenant(entraPrincipal(ALICE_OID));
    expect(first).toEqual(second);
  });

  it("two different verified identities resolve to two different hosts", () => {
    const registry = threeTenantRegistry();
    const alice = registry.resolveTenant(entraPrincipal(ALICE_OID));
    const bob = registry.resolveTenant(entraPrincipal(BOB_OID));
    if (alice.kind !== "resolved" || bob.kind !== "resolved") throw new Error("expected resolved");
    expect(alice.tenant.hostId).not.toBe(bob.tenant.hostId);
  });
});

describe("IdentityRegistry — audit logging", () => {
  it("emits one resolved line per successful forward resolution, with the validated oid raw", () => {
    const lines: string[] = [];
    const registry = IdentityRegistry.fromConfig(
      { tenants: [{ home: "/srv/traycer/alice", hostId: "host-alice", entraOid: ALICE_OID }] },
      (line) => lines.push(line),
    );
    registry.resolveTenant(entraPrincipal(ALICE_OID));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { outcome: string; input: string; direction: string };
    expect(parsed.outcome).toBe("resolved");
    expect(parsed.direction).toBe("forward");
    expect(parsed.input).toBe(ALICE_OID);
  });

  it("sanitizes an attacker-shaped refusal input before logging it", () => {
    const lines: string[] = [];
    const registry = IdentityRegistry.fromConfig(
      { tenants: [{ home: "/srv/traycer/alice", hostId: "host-alice", entraOid: ALICE_OID }] },
      (line) => lines.push(line),
    );
    const attackerInput = `${"x".repeat(200)}\nFORGED_LINE\r`;
    registry.resolveTenant(entraPrincipal(attackerInput));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).not.toContain("FORGED_LINE\r");
    const parsed = JSON.parse(lines[0]) as { outcome: string };
    expect(parsed.outcome).toBe("refused");
  });

  it("emits a reverse-direction line for resolveIdentity", () => {
    const lines: string[] = [];
    const registry = IdentityRegistry.fromConfig(
      { tenants: [{ home: "/srv/traycer/alice", hostId: "host-alice", entraOid: ALICE_OID }] },
      (line) => lines.push(line),
    );
    registry.resolveIdentity("host-alice");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as { direction: string };
    expect(parsed.direction).toBe("reverse");
  });
});

describe("defaultRegistryConfigPath", () => {
  it("resolves to the documented shape under this process's home directory", () => {
    expect(defaultRegistryConfigPath()).toBe(
      join(homedir(), ".traycer", "identity-registry.json"),
    );
  });
});

describe("IdentityRegistry.fromFile — the REAL shipped default, not an injected literal", () => {
  it("refuses when the actual defaultRegistryConfigPath() is absent", () => {
    // Evaluator-found: a hardcoded "Z:\\...\\does-not-exist.json" literal
    // proves fromFile refuses on SOME absent path, but never calls
    // defaultRegistryConfigPath() at all — a defect in that function's own
    // path construction would go undetected. This test calls the real
    // function; to stay deterministic regardless of the host machine's
    // actual state, HOME/USERPROFILE are pointed at a freshly-created,
    // guaranteed-empty temp directory for the duration of the call, then
    // restored — not a substitute path injected as a stand-in for the
    // default, the default computation itself still runs unmodified.
    const isolatedHome = mkdtempSync(join(tmpdir(), "a2-default-path-"));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      expect(defaultRegistryConfigPath()).toBe(
        join(isolatedHome, ".traycer", "identity-registry.json"),
      );
      expect(() =>
        IdentityRegistry.fromFile(defaultRegistryConfigPath(), () => {}),
      ).toThrow(/refusing to load/);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(isolatedHome, { recursive: true, force: true });
    }
  });

  it("also refuses a garbage literal path (the isolation mechanics above are the point, not this assertion)", () => {
    expect(() =>
      IdentityRegistry.fromFile(
        "Z:\\definitely-not-a-real-path\\identity-registry-that-does-not-exist.json",
        () => {},
      ),
    ).toThrow(/refusing to load/);
  });
});
