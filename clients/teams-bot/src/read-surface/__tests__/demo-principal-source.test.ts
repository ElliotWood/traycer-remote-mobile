import { describe, expect, it } from "vitest";
import {
  createDemoPrincipalSource,
  DEMO_IDENTITY_ENV_FLAG,
  DEMO_IDENTITY_OID_ENV,
} from "../demo-principal-source";

const VALID_OID = "aaaaaaaa-1111-1111-1111-111111111111";

/**
 * These test the FENCE, not the feature. The feature is one line; the fence
 * is the reason the user approved it, so it's what needs proving.
 */
describe("read-surface/demo-principal-source — the fence", () => {
  it("is inactive with no env at all — merely existing in the tree changes nothing", () => {
    expect(createDemoPrincipalSource({}).kind).toBe("inactive");
  });

  it("is inactive unless the flag is exactly '1' — no truthy-ish values activate it", () => {
    for (const value of ["0", "true", "yes", "TRUE", "", " ", "on"]) {
      const result = createDemoPrincipalSource({
        [DEMO_IDENTITY_ENV_FLAG]: value,
        [DEMO_IDENTITY_OID_ENV]: VALID_OID,
      });
      expect(result.kind, `flag value ${JSON.stringify(value)}`).toBe(
        "inactive",
      );
    }
  });

  it("is inactive when only the oid is set — an oid alone never activates it", () => {
    expect(
      createDemoPrincipalSource({ [DEMO_IDENTITY_OID_ENV]: VALID_OID }).kind,
    ).toBe("inactive");
  });

  it("MISCONFIGURED, not inactive, when the flag is on but the oid is missing — the caller must treat this as fatal", () => {
    const result = createDemoPrincipalSource({
      [DEMO_IDENTITY_ENV_FLAG]: "1",
    });
    expect(result.kind).toBe("misconfigured");
    if (result.kind !== "misconfigured") return;
    expect(result.reason).toContain(DEMO_IDENTITY_OID_ENV);
  });

  it("refuses a non-canonical GUID rather than normalising it", () => {
    for (const bad of [
      VALID_OID.toUpperCase(),
      ` ${VALID_OID}`,
      "not-a-guid",
      "aaaaaaaa1111111111111111111111111111",
    ]) {
      const result = createDemoPrincipalSource({
        [DEMO_IDENTITY_ENV_FLAG]: "1",
        [DEMO_IDENTITY_OID_ENV]: bad,
      });
      expect(result.kind, `oid ${JSON.stringify(bad)}`).toBe("misconfigured");
    }
  });

  it("when properly configured, resolves exactly the configured principal", async () => {
    const result = createDemoPrincipalSource({
      [DEMO_IDENTITY_ENV_FLAG]: "1",
      [DEMO_IDENTITY_OID_ENV]: VALID_OID,
    });
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;

    const resolution = await result.resolve();
    expect(resolution).toEqual({
      kind: "resolved",
      principal: { kind: "entra", oid: VALID_OID },
    });
  });

  it("reads the identity ONLY from env — the resolver takes no arguments, so no activity field can reach it", async () => {
    const result = createDemoPrincipalSource({
      [DEMO_IDENTITY_ENV_FLAG]: "1",
      [DEMO_IDENTITY_OID_ENV]: VALID_OID,
    });
    if (result.kind !== "active") throw new Error("expected active");
    // Structural guarantee, not a convention: `ResolvePrincipal` is
    // `() => Promise<...>`. There is no parameter through which
    // `activity.from.aadObjectId` could be passed in.
    expect(result.resolve.length).toBe(0);
  });
});
