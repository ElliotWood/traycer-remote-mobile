import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCanonicalGuid } from "./guid";
import { loadRegistryConfig } from "./registry-config";
import { defaultAuditSink, emitAuditLine, type AuditSink } from "./audit-log";
import type {
  IdentityResolution,
  RefusalReason,
  TenantMapping,
  TenantResolution,
  VerifiedPrincipal,
} from "./types";

export type { TenantMapping, VerifiedPrincipal } from "./types";

/**
 * The identity registry — the security control of the Azure multi-identity
 * epic. All host processes on the target VM run under one OS user; the
 * filesystem enforces nothing between tenants. This module is what decides
 * which tenant an inbound, token-verified principal reaches. A bug here
 * hands one person another person's credentials, agents, and Claude quota.
 *
 * Four rules this file exists to hold, none of which may be relaxed by a
 * consumer:
 *
 *   1. Server-side, never client-assertable — `resolveTenant`'s only
 *      parameter is a `VerifiedPrincipal`. It has no way to read a
 *      conversation id, chat id, `channelData`, or a display name, because
 *      it does not accept them.
 *   2. Identity comes from a validated token claim. See `aad-id-token.ts`
 *      for the `entra` mint point; `kind: "traycer"` has none in this
 *      delivery (see below).
 *   3. Unmapped fails closed — no default host, no first-configured-tenant
 *      fallback. Every refusal returns a typed reason, never a value.
 *   4. This registry is the ONLY thing that resolves a tenant. No other
 *      component may infer one from a conversation id, chat id, or display
 *      name.
 *
 * TENANT-KEYED, NOT PRINCIPAL-KEYED: a `TenantMapping` is one human, who may
 * carry an `entraOid`, a `traycerUserId`, or both. This is deliberate — a
 * principal-keyed table (one row per alias) would let the same human be
 * onboarded twice under different aliases pointing at two different
 * `home`s, with nothing in `registry-config.ts`'s validation able to catch
 * it (no key would collide). That onboarding hazard is NOT closed by this
 * file — A2 can only guarantee the config *as loaded* never contains the
 * collision; it cannot stop an operator from creating it across two
 * separate onboarding runs. A3 (per-person onboarding) must check whether
 * a human is already registered under a different alias before adding one.
 *
 * `kind: "traycer"` REFUSES rather than resolves. No verifier in this
 * delivery mints a `VerifiedTraycerUserId` (a live per-request call to
 * Traycer's own authn was considered and rejected — it would add an
 * availability dependency and an unresolved cache-vs-revocation question
 * inside this file's blast radius, for a benefit that doesn't materialize:
 * any test of it would be exactly as synthetic as `aad-id-token.ts`'s
 * local-JWKS-server test). Config entries may still carry a `traycerUserId`
 * so a future verifier's rollout is additive, but until one ships, the only
 * way a `traycer` principal ever reaches this file is a forged cast — and a
 * resolvable-but-unmintable kind would be exactly that convenience path.
 *
 * RUNTIME BRAND ERASURE: `VerifiedPrincipal`'s brands are TypeScript-only.
 * `resolveTenant({ kind: "entra", oid: "<any string>" as VerifiedAadObjectId })`
 * WILL resolve if the string is a canonical GUID matching a configured
 * tenant — see the "resolves to Bob" test in this module's test file. The
 * only thing that makes the brand meaningful is that every real caller
 * passes through `validateAadIdToken` and never casts. This file adds
 * defense in depth (re-validating canonical shape at runtime) but that
 * only catches a malformed cast, not an unverified-but-well-formed one.
 */
export function defaultRegistryConfigPath(): string {
  return join(homedir(), ".traycer", "identity-registry.json");
}

export class IdentityRegistry {
  private readonly byEntraOid = new Map<string, TenantMapping>();
  private readonly byTraycerUserId = new Map<string, TenantMapping>();
  private readonly byHostId = new Map<string, TenantMapping>();
  private readonly auditSink: AuditSink;

  private constructor(tenants: readonly TenantMapping[], auditSink: AuditSink) {
    for (const tenant of tenants) {
      if (tenant.entraOid !== null) {
        this.byEntraOid.set(tenant.entraOid, tenant);
      }
      if (tenant.traycerUserId !== null) {
        this.byTraycerUserId.set(tenant.traycerUserId, tenant);
      }
      this.byHostId.set(tenant.hostId, tenant);
    }
    this.auditSink = auditSink;
  }

  static fromConfig(raw: unknown, auditSink: AuditSink): IdentityRegistry {
    const result = loadRegistryConfig(raw);
    if (result.kind === "refused") {
      throw new Error(`identity registry: refusing to load — ${result.reason}`);
    }
    return new IdentityRegistry(result.tenants, auditSink);
  }

  /** Refuses (throws) if `path` is absent, unreadable, or malformed — never falls back to an empty/permissive registry. */
  static fromFile(path: string, auditSink: AuditSink): IdentityRegistry {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(
        `identity registry: refusing to load — could not read/parse "${path}": ${describeError(err)}`,
      );
    }
    return IdentityRegistry.fromConfig(raw, auditSink);
  }

  /**
   * Forward: verified principal -> tenant. The ONLY parameter is the
   * principal — no activity, no claims bag, no options object carrying
   * either, so it structurally cannot reach a conversation id, chat id,
   * `channelData`, or a display name.
   */
  resolveTenant(principal: VerifiedPrincipal): TenantResolution {
    if (principal.kind === "traycer") {
      // No verifier mints this kind in this delivery — see module doc.
      // Resolving it anyway would be exactly the convenience path a forged
      // cast is waiting for.
      this.audit("forward", "refused", "principal_kind_unsupported", principal.userId);
      return { kind: "refused", reason: "principal_kind_unsupported" };
    }

    const oid = principal.oid;
    // Defense in depth against a cast that produced a malformed value; does
    // NOT prove the value was actually vouched for by a token — see module doc.
    if (!isCanonicalGuid(oid)) {
      this.audit("forward", "refused", "malformed_principal", oid);
      return { kind: "refused", reason: "malformed_principal" };
    }
    const tenant = this.byEntraOid.get(oid);
    if (tenant === undefined) {
      this.audit("forward", "refused", "unmapped_principal", oid);
      return { kind: "refused", reason: "unmapped_principal" };
    }
    this.audit("forward", "resolved", null, oid);
    return { kind: "resolved", tenant };
  }

  /**
   * Reverse: host id -> tenant, for host-event -> conversation routing
   * (owned downstream, in the Teams epic — this registry only resolves
   * identity<->tenant, never a conversation itself). Returns the full
   * `TenantMapping`, never a `VerifiedPrincipal` — `tenant.entraOid` is a
   * `MappedAadObjectId`, a DIFFERENT type than `VerifiedAadObjectId`, so a
   * config-sourced alias can never be mistaken by the type system for one a
   * token vouched for. See this module's `@ts-expect-error` test.
   */
  resolveIdentity(hostId: string): IdentityResolution {
    const tenant = this.byHostId.get(hostId);
    if (tenant === undefined) {
      this.audit("reverse", "refused", "unmapped_host_id", hostId);
      return { kind: "refused", reason: "unmapped_host_id" };
    }
    this.audit("reverse", "resolved", null, hostId);
    return { kind: "resolved", tenant };
  }

  private audit(
    direction: "forward" | "reverse",
    outcome: "resolved" | "refused",
    reason: RefusalReason | null,
    input: string,
  ): void {
    emitAuditLine(this.auditSink, {
      direction,
      outcome,
      reason,
      input,
      timestampMs: Date.now(),
    });
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
