import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import {
  BotFrameworkAuthError,
  DEFAULT_AUTH_CONFIG,
  type BotFrameworkAuthConfig,
  loadBotFrameworkAuthConfigFromEnv,
  resetBotFrameworkJwtCachesForTests,
  validateBotFrameworkActivityRequest,
} from "../bot-framework-jwt";
import { startTestJwksServer, type TestJwksServer } from "./test-jwks-server";

const AUDIENCE = "11111111-2222-3333-4444-555555555555";
const SERVICE_URL = "https://smba.trafficmanager.net/amer/";

describe("DEFAULT_AUTH_CONFIG (shipped values, asserted directly — not retyped literals)", () => {
  it("issuer is the Connector API's fixed issuer, both v3.1 and v3.2", () => {
    expect(DEFAULT_AUTH_CONFIG.issuer).toBe("https://api.botframework.com");
  });

  it("clock skew is exactly 5 minutes, the spec's stated tolerance", () => {
    expect(DEFAULT_AUTH_CONFIG.clockSkewSeconds).toBe(300);
  });

  it("JWKS cache TTL is finite and at most 24h (unbounded caching breaks key rotation)", () => {
    expect(DEFAULT_AUTH_CONFIG.jwksCacheMaxAgeMs).toBeGreaterThan(0);
    expect(DEFAULT_AUTH_CONFIG.jwksCacheMaxAgeMs).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  it("every metadata/JWKS fetch has a bounded, finite timeout", () => {
    expect(DEFAULT_AUTH_CONFIG.fetchTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_AUTH_CONFIG.fetchTimeoutMs).toBeLessThan(30_000);
  });

  it("has no `audience` field baked in — the bot's App ID is never a hardcoded default", () => {
    expect("audience" in DEFAULT_AUTH_CONFIG).toBe(false);
  });
});

describe("validateBotFrameworkActivityRequest", () => {
  let jwks: TestJwksServer;
  let config: BotFrameworkAuthConfig;

  beforeAll(async () => {
    jwks = await startTestJwksServer();
  });

  afterAll(async () => {
    await jwks.close();
  });

  afterEach(() => {
    resetBotFrameworkJwtCachesForTests();
  });

  beforeAll(() => {
    // Signature-source is local; policy (issuer/audience/skew/cache TTL) is
    // read straight from the shipped defaults — never retyped as literals.
    config = {
      ...DEFAULT_AUTH_CONFIG,
      openIdMetadataUrl: jwks!.openIdMetadataUrl,
      audience: AUDIENCE,
    };
  });

  function sign(
    claims: Record<string, unknown>,
    opts: { alg: jwt.Algorithm | undefined; kid: string | undefined },
  ): string {
    return jwt.sign(claims, jwks.privateKeyPem, {
      algorithm: opts.alg ?? "RS256",
      keyid: opts.kid ?? jwks.kid,
    });
  }

  function validClaims(
    overrides: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: DEFAULT_AUTH_CONFIG.issuer,
      aud: AUDIENCE,
      serviceurl: SERVICE_URL,
      iat: now,
      exp: now + 600,
      ...overrides,
    };
  }

  it("accepts a validly-signed token with matching issuer/audience/serviceUrl (positive case)", async () => {
    const token = sign(validClaims({}), { alg: undefined, kid: undefined });
    const payload = await validateBotFrameworkActivityRequest({
      authorizationHeader: `Bearer ${token}`,
      activityServiceUrl: SERVICE_URL,
      config,
      now: Date.now,
    });
    expect(payload.aud).toBe(AUDIENCE);
  });

  it("case 1: rejects a missing Authorization header, without ever reaching the network", async () => {
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: undefined,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "missing_authorization_header",
    );
  });

  it("case 2: rejects a malformed token (bare 'Bearer ', non-JWT garbage)", async () => {
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: "Bearer ",
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "malformed_authorization_header",
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: "Bearer not-a-jwt-at-all",
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "malformed_token",
    );
  });

  it("case 3: rejects alg:none", async () => {
    const token = jwt.sign(validClaims({}), "", { algorithm: "none" });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "disallowed_algorithm",
    );
  });

  it("case 9 (regression guard): rejects the RSA-public-key-replayed-as-HS256-secret forgery", async () => {
    // The attack that would forge a token if the validator ever branched on
    // the token's own `alg`: HMAC-sign with the RSA public key as the
    // "shared secret" — a key any caller can fetch from our own JWKS.
    const token = jwt.sign(validClaims({}), jwks.publicKeyPem, {
      algorithm: "HS256",
      keyid: jwks.kid,
    });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "disallowed_algorithm",
    );
  });

  it("case 4: rejects a validly-signed token with the wrong issuer", async () => {
    const token = sign(validClaims({ iss: "https://attacker.example.com" }), {
      alg: undefined,
      kid: undefined,
    });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "issuer_mismatch",
    );
  });

  it("case 5: rejects a validly-signed token with the wrong audience", async () => {
    const token = sign(
      validClaims({ aud: "99999999-0000-0000-0000-000000000000" }),
      { alg: undefined, kid: undefined },
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "audience_mismatch",
    );
  });

  it("case 6: rejects an expired token (past the configured clock skew)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(
      validClaims({
        iat: now - 4000,
        exp: now - (DEFAULT_AUTH_CONFIG.clockSkewSeconds + 60),
      }),
      { alg: undefined, kid: undefined },
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "expired",
    );
  });

  it("honors the shipped clock-skew default: a token just inside skew is accepted, just outside is rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    const insideSkew = sign(
      validClaims({ exp: now - (DEFAULT_AUTH_CONFIG.clockSkewSeconds - 30) }),
      { alg: undefined, kid: undefined },
    );
    const payload = await validateBotFrameworkActivityRequest({
      authorizationHeader: `Bearer ${insideSkew}`,
      activityServiceUrl: SERVICE_URL,
      config,
      now: Date.now,
    });
    expect(payload.aud).toBe(AUDIENCE);

    const outsideSkew = sign(
      validClaims({ exp: now - (DEFAULT_AUTH_CONFIG.clockSkewSeconds + 30) }),
      { alg: undefined, kid: undefined },
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${outsideSkew}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "expired",
    );
  });

  it("rejects a not-yet-valid token (nbf in the future)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign(validClaims({ nbf: now + 3600 }), {
      alg: undefined,
      kid: undefined,
    });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "not_yet_valid",
    );
  });

  it("case 7: rejects a token signed by an unknown kid", async () => {
    const token = sign(validClaims({}), {
      alg: undefined,
      kid: "some-other-key-not-in-jwks",
    });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "unknown_signing_key",
    );
  });

  it("case 8: fails closed when the OpenID metadata endpoint is unreachable", async () => {
    // Port 1 on loopback: nothing listens there, so this is a genuine
    // connection failure, not a mocked one.
    const unreachableConfig: BotFrameworkAuthConfig = {
      ...config,
      openIdMetadataUrl: "http://127.0.0.1:1/openidconfiguration",
    };
    const token = sign(validClaims({}), { alg: undefined, kid: undefined });
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config: unreachableConfig,
        now: Date.now,
      }),
      "metadata_fetch_failed",
    );
  });

  it("case 8b: fails closed on a metadata fetch that exceeds the configured timeout", async () => {
    const server = await import("node:http").then((http) =>
      http.createServer((_req, res) => {
        // Never respond — forces the timeout path rather than a fast refusal.
        void res;
      }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    try {
      const slowConfig: BotFrameworkAuthConfig = {
        ...config,
        openIdMetadataUrl: `http://127.0.0.1:${port}/openidconfiguration`,
        fetchTimeoutMs: 100,
      };
      const token = sign(validClaims({}), { alg: undefined, kid: undefined });
      await expectRejection(
        validateBotFrameworkActivityRequest({
          authorizationHeader: `Bearer ${token}`,
          activityServiceUrl: SERVICE_URL,
          config: slowConfig,
          now: Date.now,
        }),
        "metadata_fetch_failed",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("required negative case: valid token, mismatched serviceUrl claim ⇒ reject", async () => {
    const token = sign(
      validClaims({ serviceurl: "https://smba.trafficmanager.net/amer/" }),
      { alg: undefined, kid: undefined },
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: "https://attacker-controlled.example.com/",
        config,
        now: Date.now,
      }),
      "service_url_mismatch",
    );
  });

  it("rejects when the serviceUrl claim is entirely absent (stricter than the SDK's lenient default)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        iss: DEFAULT_AUTH_CONFIG.issuer,
        aud: AUDIENCE,
        iat: now,
        exp: now + 600,
      },
      jwks.privateKeyPem,
      { algorithm: "RS256", keyid: jwks.kid },
    );
    await expectRejection(
      validateBotFrameworkActivityRequest({
        authorizationHeader: `Bearer ${token}`,
        activityServiceUrl: SERVICE_URL,
        config,
        now: Date.now,
      }),
      "service_url_mismatch",
    );
  });
});

describe("loadBotFrameworkAuthConfigFromEnv (fail fast at boot, no runtime bypass)", () => {
  it("throws when MicrosoftAppId is unset — no anonymous/dev fallback exists", () => {
    expect(() => loadBotFrameworkAuthConfigFromEnv({})).toThrow(
      /MicrosoftAppId/,
    );
  });

  it("throws when MicrosoftAppId is present but empty", () => {
    expect(() =>
      loadBotFrameworkAuthConfigFromEnv({ MicrosoftAppId: "   " }),
    ).toThrow(/MicrosoftAppId/);
  });

  it("is not gated by NODE_ENV in either direction — the same env with/without NODE_ENV=production both throw or both succeed", () => {
    expect(() => loadBotFrameworkAuthConfigFromEnv({})).toThrow();
    expect(() =>
      loadBotFrameworkAuthConfigFromEnv({ NODE_ENV: "development" }),
    ).toThrow();
    expect(() =>
      loadBotFrameworkAuthConfigFromEnv({ NODE_ENV: "production" }),
    ).toThrow();

    const withId = { MicrosoftAppId: AUDIENCE };
    expect(loadBotFrameworkAuthConfigFromEnv(withId).audience).toBe(AUDIENCE);
    expect(
      loadBotFrameworkAuthConfigFromEnv({ ...withId, NODE_ENV: "development" })
        .audience,
    ).toBe(AUDIENCE);
  });

  it("builds real shipped defaults plus the env-supplied audience", () => {
    const result = loadBotFrameworkAuthConfigFromEnv({
      MicrosoftAppId: AUDIENCE,
    });
    expect(result).toEqual({ ...DEFAULT_AUTH_CONFIG, audience: AUDIENCE });
  });
});

async function expectRejection(
  promise: Promise<unknown>,
  reason: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(BotFrameworkAuthError);
    expect((err as BotFrameworkAuthError).reason).toBe(reason);
    return true;
  });
}
