import { createPublicKey, type KeyObject } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { isCanonicalGuid } from "./guid";
import type { VerifiedAadObjectId } from "./types";

/**
 * Standalone AAD v2.0 ID-token validator — the sole mint point for
 * `VerifiedAadObjectId` in this codebase. Mirrors `clients/teams-bot/src/
 * auth/bot-framework-jwt.ts`'s fail-closed shape deliberately: algorithm
 * allowlist enforced from OUR config before any network call (never read
 * from the token's own header), issuer/audience checked against config
 * (never defaulted), JWKS fetched with a hard cache TTL and no
 * stale-key fallback on fetch failure, a single exported validation
 * function, no bypass flag.
 *
 * SEAM OBLIGATION — read this before calling `validateAadIdToken` or
 * writing a new caller (T1b, this means you): the ONLY safe way to obtain a
 * `VerifiedPrincipal` is the direct return value of this function. A cast
 * (`"..." as VerifiedAadObjectId`) anywhere else is a security bypass, not
 * a workaround — see `registry.ts`'s module doc and its
 * "resolveTenant(BOBS_REAL_GUID as VerifiedAadObjectId)" test for what that
 * bypass actually does once it reaches the registry.
 *
 * NOT interchangeable with `bot-framework-jwt.ts`'s validator: that module
 * authenticates the Bot Framework CONNECTOR SERVICE calling the bot's
 * endpoint (issuer `https://api.botframework.com`) — it says nothing about
 * which human sent a message. This module validates an AAD-issued ID token
 * for an actual end user (issuer `https://login.microsoftonline.com/
 * {tenantId}/v2.0`). Feeding this validator a Connector token must fail
 * with `issuer_mismatch` — see this file's test suite for the explicit
 * proof, against a real signed Connector-shaped token.
 */

export type AadIdTokenFailureReason =
  | "missing_token"
  | "malformed_token"
  | "disallowed_algorithm"
  | "unknown_signing_key"
  | "invalid_token"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "expired"
  | "not_yet_valid"
  | "missing_oid_claim"
  | "malformed_oid_claim"
  | "metadata_fetch_failed"
  | "jwks_fetch_failed";

export class AadIdTokenError extends Error {
  readonly reason: AadIdTokenFailureReason;
  constructor(reason: AadIdTokenFailureReason, message: string) {
    super(message);
    this.name = "AadIdTokenError";
    this.reason = reason;
  }
}

export interface AadIdTokenConfig {
  /** `https://login.microsoftonline.com/{tenantId}/v2.0` — tenant-specific, never a single hardcoded default. */
  readonly issuer: string;
  /** OpenID Connect discovery document; resolves to the JWKS URI at request time. */
  readonly openIdMetadataUrl: string;
  /** The consuming app's Entra application (client) id. Deliberately absent from any frozen default — see {@link loadAadIdTokenConfigFromEnv}. */
  readonly audience: string;
  readonly clockSkewSeconds: number;
  readonly jwksCacheMaxAgeMs: number;
  readonly fetchTimeoutMs: number;
}

/**
 * The parts of the config that CAN be frozen shipped defaults — issuer and
 * audience cannot, because they're tenant/app-specific, not a single fixed
 * Microsoft endpoint the way Bot Framework's Connector API issuer is.
 */
export const DEFAULT_AAD_ID_TOKEN_TIMING: Pick<
  AadIdTokenConfig,
  "clockSkewSeconds" | "jwksCacheMaxAgeMs" | "fetchTimeoutMs"
> = Object.freeze({
  clockSkewSeconds: 300,
  jwksCacheMaxAgeMs: 24 * 60 * 60 * 1000,
  fetchTimeoutMs: 5000,
});

/**
 * Builds the real shipped config from the environment. No default/bypass
 * value for `ENTRA_TENANT_ID` or `ENTRA_AUDIENCE` exists anywhere in this
 * module — either being unset is a startup failure, not a silently-open
 * validator. No tenant id is hardcoded (OSS: this repo ships no real
 * tenant, only the mechanism to configure one).
 */
export function loadAadIdTokenConfigFromEnv(
  env: NodeJS.ProcessEnv,
): AadIdTokenConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  if (!tenantId) {
    throw new Error(
      "ENTRA_TENANT_ID is required (the Entra tenant issuing user ID tokens) — refusing to start without it.",
    );
  }
  const audience = env.ENTRA_AUDIENCE?.trim();
  if (!audience) {
    throw new Error(
      "ENTRA_AUDIENCE is required (this app's Entra application/client id) — refusing to start without it.",
    );
  }
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  return {
    issuer,
    openIdMetadataUrl: `${issuer}/.well-known/openid-configuration`,
    audience,
    ...DEFAULT_AAD_ID_TOKEN_TIMING,
  };
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** Module-level, keyed by URL so distinct configs (tests pointing at a local JWKS) never collide. Holds fetched keys only — never a verification verdict. */
const metadataCache = new Map<string, CacheEntry<{ jwksUri: string }>>();
const jwksCache = new Map<string, CacheEntry<readonly Record<string, unknown>[]>>();

/** Test-only: clears both caches so fixtures don't leak between test files/cases. */
export function resetAadIdTokenCachesForTests(): void {
  metadataCache.clear();
  jwksCache.clear();
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`unexpected HTTP status ${response.status} fetching ${url}`);
  }
  return await response.json();
}

async function getJwksUri(config: AadIdTokenConfig, now: number): Promise<string> {
  const cached = metadataCache.get(config.openIdMetadataUrl);
  if (cached && cached.expiresAt > now) {
    return cached.value.jwksUri;
  }

  let doc: unknown;
  try {
    doc = await fetchJson(config.openIdMetadataUrl, config.fetchTimeoutMs);
  } catch (err) {
    throw new AadIdTokenError(
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
    throw new AadIdTokenError(
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
  config: AadIdTokenConfig,
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
      throw new AadIdTokenError(
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
      throw new AadIdTokenError("jwks_fetch_failed", "JWKS response is missing a keys array");
    }
    cached = { value: keys, expiresAt: now + config.jwksCacheMaxAgeMs };
    jwksCache.set(jwksUri, cached);
  }

  const jwk = cached.value.find((k) => k.kid === kid);
  if (!jwk) {
    throw new AadIdTokenError("unknown_signing_key", `no JWKS entry found for kid "${kid}"`);
  }
  try {
    return createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]);
  } catch (err) {
    throw new AadIdTokenError(
      "unknown_signing_key",
      `JWKS entry for kid "${kid}" is not a usable key: ${describeError(err)}`,
    );
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ValidateAadIdTokenParams {
  readonly token: string;
  readonly config: AadIdTokenConfig;
  /** Injection seam for tests only — production callers pass `Date.now` explicitly. */
  readonly now: () => number;
}

/**
 * The single exported validator. Rejects (throwing {@link AadIdTokenError})
 * on: an empty token, a token that isn't parseable, any algorithm other
 * than RS256 (the allowlist is hardcoded here AND passed to `jwt.verify`,
 * never read from the token's own header), an unknown `kid`, wrong issuer,
 * wrong audience, expired, not-yet-valid, a missing or non-canonical `oid`
 * claim, or a metadata/JWKS fetch that fails or times out (fail closed —
 * never falls back to stale keys past the cache TTL).
 *
 * NO NORMALIZATION: the `oid` claim is checked against
 * {@link isCanonicalGuid} and rejected if it doesn't already match — never
 * lowercased or trimmed before branding. Transforming it here would
 * reintroduce, at the mint point, exactly the case-collapse hazard
 * `registry-config.ts`'s load-time uniqueness rules exist to reject.
 */
export async function validateAadIdToken(
  params: ValidateAadIdTokenParams,
): Promise<VerifiedAadObjectId> {
  const { token, config, now } = params;

  if (token.trim().length === 0) {
    throw new AadIdTokenError("missing_token", "token is empty");
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object") {
    throw new AadIdTokenError("malformed_token", "token is not a well-formed JWT");
  }

  const alg = decoded.header.alg;
  if (alg !== "RS256") {
    throw new AadIdTokenError(
      "disallowed_algorithm",
      `algorithm "${String(alg)}" is not permitted (RS256 only)`,
    );
  }
  const kid = decoded.header.kid;
  if (typeof kid !== "string" || kid.length === 0) {
    throw new AadIdTokenError("unknown_signing_key", "token header has no kid");
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
      throw new AadIdTokenError("invalid_token", "token payload is not an object");
    }
    payload = verified;
  } catch (err) {
    if (err instanceof AadIdTokenError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AadIdTokenError("expired", "token is expired");
    }
    if (err instanceof jwt.NotBeforeError) {
      throw new AadIdTokenError("not_yet_valid", "token is not yet valid (nbf)");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const message = err.message;
      if (message.startsWith("jwt issuer invalid")) {
        throw new AadIdTokenError("issuer_mismatch", message);
      }
      if (message.startsWith("jwt audience invalid")) {
        throw new AadIdTokenError("audience_mismatch", message);
      }
      throw new AadIdTokenError("invalid_token", message);
    }
    throw new AadIdTokenError("invalid_token", describeError(err));
  }

  const oid = payload.oid;
  if (typeof oid !== "string" || oid.length === 0) {
    throw new AadIdTokenError("missing_oid_claim", "token has no oid claim");
  }
  if (!isCanonicalGuid(oid)) {
    throw new AadIdTokenError(
      "malformed_oid_claim",
      "oid claim is not a canonical lowercase GUID — refusing rather than normalizing it",
    );
  }
  return oid as VerifiedAadObjectId;
}
