/**
 * Identity-registry types: verified principals, tenant mappings, and
 * resolution results. This is the security control of the Azure epic — all
 * host processes run under one OS user, so this module (and `registry.ts`,
 * which owns the resolution logic) is the only thing standing between an
 * inbound request and another person's credentials, agents, and Claude
 * quota. Read `registry.ts`'s module doc before changing anything here.
 */

/** Vouched for by a real, signature-verified AAD v2.0 ID token — see `aad-id-token.ts`. */
export type VerifiedAadObjectId = string & {
  readonly __brand: "VerifiedAadObjectId";
};

/**
 * No verifier in this package mints this today — `kind: "traycer"` is a
 * defined-but-unminted principal kind (see `registry.ts`'s handling of it).
 * The type exists so the registry's data model and `VerifiedPrincipal`
 * union are ready for a future verifier without a breaking change; nothing
 * in this delivery constructs a value of this type outside test-only code.
 */
export type VerifiedTraycerUserId = string & {
  readonly __brand: "VerifiedTraycerUserId";
};

/**
 * An alias read out of the registry's config, NOT vouched for by a token.
 * Deliberately a DIFFERENT brand than `VerifiedAadObjectId`/
 * `VerifiedTraycerUserId` — not merely a different name, a type TypeScript
 * will not let you substitute for the verified brand without an explicit
 * cast. `resolveIdentity` (the reverse, host->tenant lookup) returns values
 * of these "Mapped" types precisely so a config-sourced value can never be
 * handed to `resolveTenant` as if a token had vouched for it. See
 * `registry.ts`'s tests for the `@ts-expect-error` that proves this holds.
 */
export type MappedAadObjectId = string & {
  readonly __brand: "MappedAadObjectId";
};
export type MappedTraycerUserId = string & {
  readonly __brand: "MappedTraycerUserId";
};

/**
 * A principal vouched for by a validated token/claim — never constructed
 * from an inbound request field directly. The ONLY legitimate mint point
 * for `kind: "entra"` is `validateAadIdToken` (`aad-id-token.ts`); no
 * mint point for `kind: "traycer"` ships in this delivery (see
 * `registry.ts` for why an unminted kind must still refuse rather than
 * resolve).
 *
 * SEAM OBLIGATION, read before writing a caller: both brands are erased at
 * runtime. TypeScript enforces the mint-point discipline only at the type
 * boundary — `{ kind: "entra", oid: "<any string>" as VerifiedAadObjectId }`
 * is trivially hand-constructible, and `resolveTenant` given such a cast
 * value WILL resolve it if the string happens to be a canonical GUID that
 * matches a configured tenant (see `registry.ts`'s
 * "resolveTenant(BOBS_REAL_GUID as VerifiedAadObjectId)" test — this is a
 * documented, accepted limitation of the brand, not a gap nobody noticed).
 * The only thing that makes this safe is discipline: a `VerifiedPrincipal`
 * must always be the direct return value of `validateAadIdToken`, never a
 * cast, anywhere in this codebase or in a consumer (Teams bot, gateway).
 */
export type VerifiedPrincipal =
  | { readonly kind: "entra"; readonly oid: VerifiedAadObjectId }
  | { readonly kind: "traycer"; readonly userId: VerifiedTraycerUserId };

/**
 * One tenant: their `HOME`, their host's stable id, and the alias(es) that
 * resolve to them. Deliberately keyed by TENANT, not by principal — a
 * principal-keyed table (one row per alias) would let the same human be
 * onboarded twice under different aliases pointing at two different
 * `home`s with nothing in config validation able to catch it, since no key
 * would collide. See `registry.ts`'s module doc for the onboarding hazard
 * this still leaves for A3.
 */
export interface TenantMapping {
  readonly home: string;
  readonly hostId: string;
  readonly entraOid: MappedAadObjectId | null;
  readonly traycerUserId: MappedTraycerUserId | null;
}

export type RefusalReason =
  | "unmapped_principal"
  | "unmapped_host_id"
  | "malformed_principal"
  | "principal_kind_unsupported";

export type TenantResolution =
  | { readonly kind: "resolved"; readonly tenant: TenantMapping }
  | { readonly kind: "refused"; readonly reason: RefusalReason };

/** Reverse (host -> tenant) resolution. Never returns a `VerifiedPrincipal` — see `MappedAadObjectId`'s doc. */
export type IdentityResolution =
  | { readonly kind: "resolved"; readonly tenant: TenantMapping }
  | { readonly kind: "refused"; readonly reason: RefusalReason };
