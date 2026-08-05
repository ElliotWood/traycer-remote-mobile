import { createPublicKey, type KeyObject } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";

/**
 * Standalone Bot Framework Connector JWT validator — deliberately NOT built on
 * `@microsoft/agents-hosting`'s `authorizeJWT`. Audited first (see handoff):
 * that middleware hardcodes the JWKS URL for the `api.botframework.com`
 * issuer with no override seam, and never passes `issuer` to `jwt.verify()`
 * at all — a token from any issuer that resolves to a JWKS containing a
 * matching `kid`, with a matching `aud`, currently passes it. This module is
 * the sole inbound-auth gate for the bot: `CloudAdapter.process()` performs
 * no JWT validation of its own (see `../http-server.ts`), so nothing else
 * stands between the public tunnel and the activity handler.
 *
 * Spec: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */

export type AuthFailureReason =
  | "missing_authorization_header"
  | "malformed_authorization_header"
  | "malformed_token"
  | "disallowed_algorithm"
  | "unknown_signing_key"
  | "invalid_token"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "expired"
  | "not_yet_valid"
  | "service_url_mismatch"
  | "metadata_fetch_failed"
  | "jwks_fetch_failed";

export class BotFrameworkAuthError extends Error {
  readonly reason: AuthFailureReason;
  constructor(reason: AuthFailureReason, message: string) {
    super(message);
    this.name = "BotFrameworkAuthError";
    this.reason = reason;
  }
}

export interface BotFrameworkAuthConfig {
  /** Bot Connector API's fixed issuer for both v3.1 and v3.2 tokens. */
  readonly issuer: string;
  /** OpenID Connect discovery document; resolves to the JWKS URI at request time. */
  readonly openIdMetadataUrl: string;
  /** The bot's own Azure App ID — deliberately absent from {@link DEFAULT_AUTH_CONFIG}; see {@link loadBotFrameworkAuthConfigFromEnv}. */
  readonly audience: string;
  /** `jwt.verify`'s `clockTolerance`, in seconds. */
  readonly clockSkewSeconds: number;
  /** How long a fetched OpenID metadata doc / JWKS keyset is trusted before a mandatory re-fetch. Bounds key-rotation staleness. */
  readonly jwksCacheMaxAgeMs: number;
  /** Bounds each metadata/JWKS network call; a hang must not hang the validator. */
  readonly fetchTimeoutMs: number;
}

/**
 * Real Microsoft endpoints and the spec's clock-skew / cache-refresh figures,
 * frozen so tests can assert against the values actually shipped rather than
 * literals retyped in a test file. `audience` is intentionally omitted — it's
 * the bot's own App ID, and OSS rules forbid a hardcoded default for it.
 *
 * No Bot Framework Emulator issuers are included by design (not "later" —
 * omitted). Trusting them would widen the accepted-issuer set beyond the
 * Connector API on an endpoint that, once tunneled, is reachable by anyone.
 */
export const DEFAULT_AUTH_CONFIG: Omit<BotFrameworkAuthConfig, "audience"> =
  Object.freeze({
    issuer: "https://api.botframework.com",
    openIdMetadataUrl:
      "https://login.botframework.com/v1/.well-known/openidconfiguration",
    clockSkewSeconds: 300,
    jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
    fetchTimeoutMs: 5000,
  });

/**
 * Builds the real shipped config from the environment. No default/bypass
 * value for `audience` exists anywhere in this module — an unset
 * `MicrosoftAppId` is a startup failure, not a silently-anonymous bot.
 */
export function loadBotFrameworkAuthConfigFromEnv(
  env: NodeJS.ProcessEnv,
): BotFrameworkAuthConfig {
  const audience = env.MicrosoftAppId;
  if (!audience || audience.trim().length === 0) {
    throw new Error(
      "MicrosoftAppId is required (the bot's Azure App ID, used as the inbound JWT audience) — refusing to start without it.",
    );
  }
  return { ...DEFAULT_AUTH_CONFIG, audience };
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** Module-level, keyed by URL so distinct configs (e.g. tests pointing at a local JWKS) never collide. Holds fetched keys only — never a verification verdict. */
const metadataCache = new Map<string, CacheEntry<{ jwksUri: string }>>();
const jwksCache = new Map<
  string,
  CacheEntry<readonly Record<string, unknown>[]>
>();

/** Test-only: clears both caches so fixtures don't leak between test files/cases. */
export function resetBotFrameworkJwtCachesForTests(): void {
  metadataCache.clear();
  jwksCache.clear();
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(
      `unexpected HTTP status ${response.status} fetching ${url}`,
    );
  }
  return await response.json();
}

async function getJwksUri(
  config: BotFrameworkAuthConfig,
  now: number,
): Promise<string> {
  const cached = metadataCache.get(config.openIdMetadataUrl);
  if (cached && cached.expiresAt > now) {
    return cached.value.jwksUri;
  }

  let doc: unknown;
  try {
    doc = await fetchJson(config.openIdMetadataUrl, config.fetchTimeoutMs);
  } catch (err) {
    throw new BotFrameworkAuthError(
      "metadata_fetch_failed",
      `failed to fetch OpenID metadata from ${config.openIdMetadataUrl}: ${describeError(err)}`,
    );
  }
  const jwksUri =
    typeof doc === "object" &&
    doc !== null &&
    typeof (doc as Record<string, unknown>).jwks_uri === "string"
      ? ((doc as Record<string, unknown>).jwks_uri as string)
      : undefined;
  if (!jwksUri) {
    throw new BotFrameworkAuthError(
      "metadata_fetch_failed",
      "OpenID metadata response is missing jwks_uri",
    );
  }
  metadataCache.set(config.openIdMetadataUrl, {
    value: { jwksUri },
    expiresAt: now + config.jwksCacheMaxAgeMs,
  });
  return jwksUri;
}

async function getSigningKey(
  config: BotFrameworkAuthConfig,
  kid: string,
  now: number,
): Promise<KeyObject> {
  const jwksUri = await getJwksUri(config, now);

  let cached = jwksCache.get(jwksUri);
  if (!cached || cached.expiresAt <= now) {
    let doc: unknown;
    try {
      doc = await fetchJson(jwksUri, config.fetchTimeoutMs);
    } catch (err) {
      throw new BotFrameworkAuthError(
        "jwks_fetch_failed",
        `failed to fetch JWKS from ${jwksUri}: ${describeError(err)}`,
      );
    }
    const keys =
      typeof doc === "object" &&
      doc !== null &&
      Array.isArray((doc as Record<string, unknown>).keys)
        ? ((doc as Record<string, unknown>).keys as Record<string, unknown>[])
        : undefined;
    if (!keys) {
      throw new BotFrameworkAuthError(
        "jwks_fetch_failed",
        "JWKS response is missing a keys array",
      );
    }
    cached = { value: keys, expiresAt: now + config.jwksCacheMaxAgeMs };
    jwksCache.set(jwksUri, cached);
  }

  const jwk = cached.value.find((k) => k.kid === kid);
  if (!jwk) {
    throw new BotFrameworkAuthError(
      "unknown_signing_key",
      `no JWKS entry found for kid "${kid}"`,
    );
  }
  try {
    return createPublicKey({ key: jwk, format: "jwk" } as Parameters<
      typeof createPublicKey
    >[0]);
  } catch (err) {
    throw new BotFrameworkAuthError(
      "unknown_signing_key",
      `JWKS entry for kid "${kid}" is not a usable key: ${describeError(err)}`,
    );
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractBearerToken(
  header: string | undefined,
): { token: string } | { failure: AuthFailureReason } {
  if (header === undefined || header.trim().length === 0) {
    return { failure: "missing_authorization_header" };
  }
  const parts = header.trim().split(/\s+/);
  if (
    parts.length !== 2 ||
    parts[0].toLowerCase() !== "bearer" ||
    parts[1].length === 0
  ) {
    return { failure: "malformed_authorization_header" };
  }
  return { token: parts[1] };
}

/**
 * `serviceUrl` claim binding (Connector API auth requirement 7): the token's
 * `serviceurl` claim must match the Activity's own `serviceUrl`. Skipping
 * this lets an attacker-chosen `serviceUrl` in the activity body be trusted
 * as a proactive-reply callback destination — an SSRF / confused-deputy
 * vector, and exactly the "open relay" this validator exists to prevent.
 *
 * Deliberately stricter than `CloudAdapterOptions.validateServiceUrl`'s
 * documented default (which lets either side be absent, for backward
 * compatibility with pre-existing deployments): this validator has no
 * legacy deployments to be compatible with, so it rejects rather than warns
 * when either side is missing.
 *
 * Compares HOSTNAME only, not the full URL — deliberate, not an
 * oversimplification. The security-relevant fact is "which service does
 * this callback belong to," and Bot Service's own `serviceUrl`s legitimately
 * vary by path/region/query beyond the host. Mirrors
 * `CloudAdapterOptions.validateServiceUrl`'s own comparison for the same
 * reason (`cloudAdapter.ts`'s `validateServiceUrl`). Do not "tighten" this to
 * a full string match without checking real Connector traffic first — that
 * would very plausibly start rejecting legitimate activities, not attacks.
 */
function serviceUrlsMatch(
  claim: unknown,
  activityServiceUrl: string | undefined,
): boolean {
  if (typeof claim !== "string" || claim.length === 0) return false;
  if (typeof activityServiceUrl !== "string" || activityServiceUrl.length === 0)
    return false;
  try {
    return (
      new URL(claim).hostname.toLowerCase() ===
      new URL(activityServiceUrl).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

export interface ValidateBotFrameworkActivityRequestParams {
  readonly authorizationHeader: string | undefined;
  readonly activityServiceUrl: string | undefined;
  readonly config: BotFrameworkAuthConfig;
  /** Injection seam for tests only — production callers pass `Date.now` explicitly. */
  readonly now: () => number;
}

/**
 * The single exported validator. Every inbound activity must pass through
 * this before dispatch; there is no second path and no bypass flag.
 *
 * Rejects (throwing {@link BotFrameworkAuthError}) on: missing/malformed
 * Authorization header, a token that isn't parseable, any algorithm other
 * than RS256 (closes both `alg:none` and RSA-key-replayed-as-HS256-secret —
 * the allowlist is hardcoded here AND passed to `jwt.verify`, never read
 * from the token's own header), an unknown `kid`, wrong issuer, wrong
 * audience, expired, not-yet-valid, a `serviceUrl` claim that doesn't match
 * the activity, or a metadata/JWKS fetch that fails or times out (fail
 * closed — never falls back to stale keys past the cache TTL).
 *
 * CARRIED RISK, downgraded but not closed: this rejects when the token's
 * `serviceurl` claim is absent (see `serviceUrlsMatch`). No live token has
 * been inspected yet (blocked on public ingress + T0c), so this is still not
 * 100% proven — but it is no longer merely assumed either. Two independent
 * primary sources corroborate the claim is reliably present on real
 * Connector tokens:
 *   1. Microsoft's own Connector API auth spec states it as requirement 7,
 *      a MUST, not an optional check.
 *   2. `botbuilder-js`'s real, years-in-production `channelValidation.ts`
 *      reads the exact same claim key (`AuthenticationConstants.ServiceUrlClaim
 *      === 'serviceurl'`) and rejects unconditionally when it's absent — no
 *      fallback path. That code has handled real Connector traffic at scale
 *      for years; if the claim were routinely missing, that codepath would
 *      have caused widespread bot outages long since fixed. (The earlier
 *      "stricter than Microsoft's own SDKs" framing was wrong — it compared
 *      against `CloudAdapterOptions.validateServiceUrl`'s lenient opt-in
 *      default, not against the actual reference claim-matching logic, which
 *      matches this validator's strictness exactly.)
 * **Still verify against the first real inbound activity before fully
 * retiring this note** — corroboration from spec text and a sibling SDK is
 * strong, not proof. Cheapest remaining step: mint a token via the Bot
 * Framework Emulator (needs a registered Bot App ID, i.e. T0c, but NOT
 * public ingress) and inspect it directly, before ever depending on
 * production Connector traffic to find out.
 */
export async function validateBotFrameworkActivityRequest(
  params: ValidateBotFrameworkActivityRequestParams,
): Promise<JwtPayload> {
  const { authorizationHeader, activityServiceUrl, config, now } = params;

  const bearer = extractBearerToken(authorizationHeader);
  if ("failure" in bearer) {
    throw new BotFrameworkAuthError(
      bearer.failure,
      `rejected: ${bearer.failure}`,
    );
  }
  const { token } = bearer;

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object") {
    throw new BotFrameworkAuthError(
      "malformed_token",
      "token is not a well-formed JWT",
    );
  }

  // Algorithm allowlist enforced BEFORE any network call or verify(), from
  // our own config — never from the token's header. This is what closes the
  // "attacker HMAC-signs a token using the RSA public key as the HS256
  // secret" bypass: that attack only works if the verifier ever trusts an
  // algorithm the attacker chose. `algorithms: ["RS256"]` below on the
  // jwt.verify() call is the second, redundant enforcement of the same rule.
  const alg = decoded.header.alg;
  if (alg !== "RS256") {
    throw new BotFrameworkAuthError(
      "disallowed_algorithm",
      `algorithm "${String(alg)}" is not permitted (RS256 only)`,
    );
  }
  const kid = decoded.header.kid;
  if (typeof kid !== "string" || kid.length === 0) {
    throw new BotFrameworkAuthError(
      "unknown_signing_key",
      "token header has no kid",
    );
  }

  const nowMs = now();
  const key = await getSigningKey(config, kid, nowMs);

  let payload: JwtPayload;
  try {
    const verified = jwt.verify(token, key, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: config.clockSkewSeconds,
    });
    if (typeof verified !== "object" || verified === null) {
      throw new BotFrameworkAuthError(
        "invalid_token",
        "token payload is not an object",
      );
    }
    payload = verified;
  } catch (err) {
    if (err instanceof BotFrameworkAuthError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new BotFrameworkAuthError("expired", "token is expired");
    }
    if (err instanceof jwt.NotBeforeError) {
      throw new BotFrameworkAuthError(
        "not_yet_valid",
        "token is not yet valid (nbf)",
      );
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const message = err.message;
      if (message.startsWith("jwt issuer invalid")) {
        throw new BotFrameworkAuthError("issuer_mismatch", message);
      }
      if (message.startsWith("jwt audience invalid")) {
        throw new BotFrameworkAuthError("audience_mismatch", message);
      }
      throw new BotFrameworkAuthError("invalid_token", message);
    }
    throw new BotFrameworkAuthError("invalid_token", describeError(err));
  }

  if (!serviceUrlsMatch(payload.serviceurl, activityServiceUrl)) {
    throw new BotFrameworkAuthError(
      "service_url_mismatch",
      "token's serviceurl claim does not match the activity's serviceUrl",
    );
  }

  return payload;
}
