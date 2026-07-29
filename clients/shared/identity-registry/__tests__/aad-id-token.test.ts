import { afterEach, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import {
  AadIdTokenError,
  resetAadIdTokenCachesForTests,
  validateAadIdToken,
  type AadIdTokenConfig,
} from "../aad-id-token";
import { startTestJwksServer, type TestJwksServer } from "./test-jwks-server";

const AUDIENCE = "11111111-2222-4333-8444-555555555555"; // synthetic, not a real Entra app id
const ISSUER = "https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0";
const OID = "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d";

let server: TestJwksServer;
let config: AadIdTokenConfig;

beforeEach(async () => {
  resetAadIdTokenCachesForTests();
  server = await startTestJwksServer();
  config = {
    issuer: ISSUER,
    openIdMetadataUrl: server.openIdMetadataUrl,
    audience: AUDIENCE,
    clockSkewSeconds: 300,
    jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
    fetchTimeoutMs: 5000,
  };
});

afterEach(async () => {
  await server.close();
});

function signToken(
  payload: Record<string, unknown>,
  opts: { readonly kid?: string; readonly alg?: jwt.Algorithm },
): string {
  return jwt.sign(payload, server.privateKeyPem, {
    algorithm: opts.alg ?? "RS256",
    keyid: opts.kid ?? server.kid,
    expiresIn: "1h",
  });
}

describe("validateAadIdToken — happy path", () => {
  it("mints a VerifiedAadObjectId from a real, correctly-signed, well-formed token", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: OID }, {});
    const result = await validateAadIdToken({ token, config, now: Date.now });
    expect(result).toBe(OID);
  });
});

describe("validateAadIdToken — the hard-refusal boundary this ticket exists to prove", () => {
  it("refuses a real, correctly-signed Bot Framework Connector-shaped token — issuer_mismatch specifically, not a match on oid", async () => {
    // Same real RSA signature machinery, same kid, and — deliberately — the
    // SAME audience as this validator's config, isolating issuer as the
    // only variable. The issuer is exactly the shape of a genuine Bot
    // Framework Connector API token (iss=https://api.botframework.com). No
    // oid claim, because Connector tokens don't carry one — this proves the
    // validator rejects on issuer before it would ever reach a
    // missing-oid check, and that a matching audience alone is nowhere
    // close to enough to pass.
    const connectorShapedToken = signToken(
      {
        iss: "https://api.botframework.com",
        aud: AUDIENCE,
        serviceurl: "https://smba.trafficmanager.net/amer/",
      },
      {},
    );
    await expect(
      validateAadIdToken({ token: connectorShapedToken, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "issuer_mismatch" });
  });

  it("also refuses the fully realistic Connector-shaped token (real issuer AND real bot audience, both wrong)", async () => {
    const connectorShapedToken = signToken(
      {
        iss: "https://api.botframework.com",
        aud: "11111111-1111-1111-1111-111111111111", // a bot's App ID, not this validator's audience
        serviceurl: "https://smba.trafficmanager.net/amer/",
      },
      {},
    );
    await expect(
      validateAadIdToken({ token: connectorShapedToken, config, now: Date.now }),
    ).rejects.toThrow(AadIdTokenError);
  });
});

describe("validateAadIdToken — algorithm allowlist", () => {
  it("rejects HS256 even when it would verify against the RSA public key as an HMAC secret", async () => {
    const token = jwt.sign(
      { iss: ISSUER, aud: AUDIENCE, oid: OID },
      server.publicKeyPem,
      { algorithm: "HS256", keyid: server.kid, expiresIn: "1h" },
    );
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "disallowed_algorithm" });
  });

  it("rejects alg:none", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const body = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, oid: OID }),
    ).toString("base64url");
    const noneToken = `${header}.${body}.`;
    await expect(
      validateAadIdToken({ token: noneToken, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "disallowed_algorithm" });
  });
});

describe("validateAadIdToken — issuer / audience / time", () => {
  it("rejects a wrong issuer", async () => {
    const token = signToken({ iss: "https://login.microsoftonline.com/wrong-tenant/v2.0", aud: AUDIENCE, oid: OID }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "issuer_mismatch" });
  });

  it("rejects a wrong audience", async () => {
    const token = signToken({ iss: ISSUER, aud: "not-this-app", oid: OID }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "audience_mismatch" });
  });

  it("rejects an expired token", async () => {
    const token = jwt.sign(
      { iss: ISSUER, aud: AUDIENCE, oid: OID },
      server.privateKeyPem,
      { algorithm: "RS256", keyid: server.kid, expiresIn: "-1h" },
    );
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects a not-yet-valid token", async () => {
    const token = jwt.sign(
      { iss: ISSUER, aud: AUDIENCE, oid: OID, nbf: Math.floor(Date.now() / 1000) + 3600 },
      server.privateKeyPem,
      { algorithm: "RS256", keyid: server.kid },
    );
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "not_yet_valid" });
  });

  it("rejects an unknown kid", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: OID }, { kid: "not-a-real-kid" });
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "unknown_signing_key" });
  });
});

describe("validateAadIdToken — oid claim, no normalization", () => {
  it("rejects a missing oid claim", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "missing_oid_claim" });
  });

  it("rejects an uppercase oid — refuses rather than lowercasing it", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: OID.toUpperCase() }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "malformed_oid_claim" });
  });

  it("rejects a non-GUID oid", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: "not-a-guid" }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "malformed_oid_claim" });
  });

  it("rejects a prototype-pollution-shaped oid", async () => {
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: "__proto__" }, {});
    await expect(
      validateAadIdToken({ token, config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "malformed_oid_claim" });
  });
});

describe("validateAadIdToken — malformed input", () => {
  it("rejects an empty token", async () => {
    await expect(
      validateAadIdToken({ token: "", config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "missing_token" });
  });

  it("rejects a token that isn't a well-formed JWT", async () => {
    await expect(
      validateAadIdToken({ token: "not.a.jwt.at.all", config, now: Date.now }),
    ).rejects.toMatchObject({ reason: "malformed_token" });
  });
});

describe("validateAadIdToken — fail-closed on network failure", () => {
  it("throws rather than falling back when the metadata endpoint is unreachable", async () => {
    const badConfig: AadIdTokenConfig = {
      ...config,
      openIdMetadataUrl: "http://127.0.0.1:1/nope", // nothing listens on port 1
      fetchTimeoutMs: 500,
    };
    const token = signToken({ iss: ISSUER, aud: AUDIENCE, oid: OID }, {});
    await expect(
      validateAadIdToken({ token, config: badConfig, now: Date.now }),
    ).rejects.toMatchObject({ reason: "metadata_fetch_failed" });
  });
});

describe("validateAadIdToken — error type", () => {
  it("throws AadIdTokenError instances specifically", async () => {
    try {
      await validateAadIdToken({ token: "", config, now: Date.now });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AadIdTokenError);
    }
  });
});
