import { describe, expect, it } from "vitest";
import { loadRegistryConfig } from "../registry-config";

const ALICE_OID = "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d";
const BOB_OID = "1a2b3c4d-5e6f-4a1b-8c2d-2e3f4a5b6c7d";
const CAROL_OID = "2c3d4e5f-6a7b-4c1d-9e2f-3a4b5c6d7e8f";

function validEntry(overrides: Record<string, unknown>) {
  return {
    home: "/srv/traycer/alice",
    hostId: "host-alice",
    entraOid: ALICE_OID,
    ...overrides,
  };
}

describe("loadRegistryConfig", () => {
  it("loads a well-formed three-tenant registry", () => {
    const result = loadRegistryConfig({
      tenants: [
        { home: "/srv/traycer/alice", hostId: "host-alice", entraOid: ALICE_OID },
        { home: "/srv/traycer/bob", hostId: "host-bob", entraOid: BOB_OID },
        {
          home: "/srv/traycer/carol",
          hostId: "host-carol",
          entraOid: CAROL_OID,
          traycerUserId: "traycer-user-carol",
        },
      ],
    });
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") return;
    expect(result.tenants).toHaveLength(3);
    expect(result.tenants[2].traycerUserId).toBe("traycer-user-carol");
  });

  it("refuses an empty registry", () => {
    const result = loadRegistryConfig({ tenants: [] });
    expect(result.kind).toBe("refused");
  });

  it("refuses a malformed shape", () => {
    expect(loadRegistryConfig({}).kind).toBe("refused");
    expect(loadRegistryConfig(null).kind).toBe("refused");
    expect(loadRegistryConfig("not an object").kind).toBe("refused");
    expect(loadRegistryConfig({ tenants: "not an array" }).kind).toBe(
      "refused",
    );
  });

  it("refuses an entry with neither alias", () => {
    const result = loadRegistryConfig({
      tenants: [{ home: "/srv/traycer/alice", hostId: "host-alice" }],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses a duplicate entraOid across two tenants", () => {
    const result = loadRegistryConfig({
      tenants: [
        validEntry({}),
        validEntry({ home: "/srv/traycer/bob", hostId: "host-bob" }),
      ],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses a duplicate hostId across two tenants", () => {
    const result = loadRegistryConfig({
      tenants: [
        validEntry({}),
        validEntry({
          home: "/srv/traycer/bob",
          entraOid: BOB_OID,
          hostId: "host-alice",
        }),
      ],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses a duplicate home across two tenants (exact match)", () => {
    const result = loadRegistryConfig({
      tenants: [
        validEntry({}),
        validEntry({ hostId: "host-bob", entraOid: BOB_OID }),
      ],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses a duplicate home that differs only by case — the NTFS/APFS single-directory hazard", () => {
    const result = loadRegistryConfig({
      tenants: [
        validEntry({ home: "/srv/traycer/alice" }),
        validEntry({
          home: "/srv/traycer/ALICE",
          hostId: "host-bob",
          entraOid: BOB_OID,
        }),
      ],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses a duplicate traycerUserId across two tenants", () => {
    const result = loadRegistryConfig({
      tenants: [
        validEntry({ traycerUserId: "traycer-user-shared" }),
        validEntry({
          home: "/srv/traycer/bob",
          hostId: "host-bob",
          entraOid: BOB_OID,
          traycerUserId: "traycer-user-shared",
        }),
      ],
    });
    expect(result.kind).toBe("refused");
  });

  it("allows one tenant to legitimately carry both aliases", () => {
    const result = loadRegistryConfig({
      tenants: [validEntry({ traycerUserId: "traycer-user-alice" })],
    });
    expect(result.kind).toBe("loaded");
  });

  it("refuses a non-canonical (uppercase) entraOid at load — not merely as an unreachable duplicate case", () => {
    const result = loadRegistryConfig({
      tenants: [validEntry({ entraOid: ALICE_OID.toUpperCase() })],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses an entraOid missing hyphens", () => {
    const result = loadRegistryConfig({
      tenants: [validEntry({ entraOid: ALICE_OID.replace(/-/g, "") })],
    });
    expect(result.kind).toBe("refused");
  });

  for (const field of ["home", "hostId", "entraOid", "traycerUserId"] as const) {
    it(`refuses leading/trailing whitespace on ${field}, without trimming`, () => {
      const base = validEntry({ traycerUserId: "traycer-user-alice" });
      const padded = { ...base, [field]: ` ${(base as Record<string, string>)[field]} ` };
      const result = loadRegistryConfig({ tenants: [padded] });
      expect(result.kind).toBe("refused");
    });
  }

  it("refuses a hostId outside A4's branch-name-safe character class", () => {
    for (const bad of ["Host-Alice", "host_alice", "host alice", "-host", "host/alice"]) {
      const result = loadRegistryConfig({ tenants: [validEntry({ hostId: bad })] });
      expect(result.kind).toBe("refused");
    }
  });

  it("refuses a hostId over 64 characters", () => {
    const result = loadRegistryConfig({
      tenants: [validEntry({ hostId: `host-${"a".repeat(64)}` })],
    });
    expect(result.kind).toBe("refused");
  });

  it("refuses an empty-string home", () => {
    const result = loadRegistryConfig({ tenants: [validEntry({ home: "" })] });
    expect(result.kind).toBe("refused");
  });

  it("mutation probe: a resolver returning the first entry unconditionally would still be caught by uniqueness, but loadRegistryConfig itself must not silently keep only the first duplicate", () => {
    // Sanity check that duplicate detection isn't order-blind in a way that
    // would let "first wins" silently pass as a valid load.
    const result = loadRegistryConfig({
      tenants: [
        validEntry({}),
        validEntry({ home: "/srv/traycer/bob", hostId: "host-bob" }), // duplicate entraOid
      ],
    });
    expect(result.kind).toBe("refused");
  });
});
