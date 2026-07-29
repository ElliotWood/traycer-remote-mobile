import type { IdentityRegistry } from "@traycer-clients/shared/identity-registry/registry";
import { buildTenantEnvironment } from "@traycer-clients/shared/identity-registry/tenant-environment";
import type { RefusalReason, VerifiedPrincipal } from "@traycer-clients/shared/identity-registry/types";
import {
  getChatStatus,
  listAgents,
  listEpics,
  type BridgeCliConfig,
  type BridgeCliFailureReason,
} from "./bridge-cli";
import type { EpicBindingStore } from "./epic-binding-store";
import type { AgentSummary, ChatStatus, EpicSummary } from "./bridge-types";

/**
 * Ties A2's identity resolution to the bridge CLI, per read. Every
 * outcome is a typed result — never a thrown exception a caller could
 * accidentally swallow, and never a value that looks like data when it
 * isn't. `resolveTenant` is called with the caller-supplied
 * `VerifiedPrincipal` unmodified — this module never constructs or casts
 * one itself, per A2's seam obligation.
 */

export type ReadSurfaceFailure =
  | { readonly kind: "principal_refused"; readonly reason: RefusalReason }
  | { readonly kind: "epic_not_bound" }
  | {
      readonly kind: "bridge_unavailable";
      readonly reason: BridgeCliFailureReason;
      readonly detail: string;
    };

export type FleetResult =
  | { readonly kind: "ok"; readonly agents: readonly AgentSummary[] }
  | ReadSurfaceFailure;

export type ChatResult =
  | { readonly kind: "ok"; readonly status: ChatStatus }
  | ReadSurfaceFailure;

export type EpicListResult =
  | { readonly kind: "ok"; readonly epics: readonly EpicSummary[] }
  | ReadSurfaceFailure;

export interface HostAccessDeps {
  readonly registry: IdentityRegistry;
  readonly epicBindings: EpicBindingStore;
  readonly bridgeCliConfig: BridgeCliConfig;
  readonly senderAgentId: string;
  readonly parentEnv: NodeJS.ProcessEnv;
}

/**
 * Resolves a principal to a tenant, builds that tenant's env via A2's own
 * `buildTenantEnvironment` (never a hand-rolled equivalent — see
 * `tenant-environment.ts`'s docblock on why two independent env
 * constructions is the defect this exists to prevent), and folds in the
 * epic id the CALLER already resolved. `epicId` is a parameter, not looked
 * up here, so this function has no opinion on where a conversation's epic
 * binding comes from beyond needing one.
 */
function buildBridgeEnv(
  tenant: { readonly home: string; readonly hostId: string },
  epicId: string,
  deps: HostAccessDeps,
): NodeJS.ProcessEnv {
  return buildTenantEnvironment({
    tenant: { ...tenant, entraOid: null, traycerUserId: null },
    parentEnv: deps.parentEnv,
    extra: {
      TRAYCER_EPIC_ID: epicId,
      TRAYCER_AGENT_ID: deps.senderAgentId,
    },
  });
}

function toReadSurfaceFailure(
  result: { readonly kind: "failed"; readonly reason: BridgeCliFailureReason; readonly detail: string },
): ReadSurfaceFailure {
  return { kind: "bridge_unavailable", reason: result.reason, detail: result.detail };
}

export async function fetchFleet(
  principal: VerifiedPrincipal,
  conversationId: string,
  deps: HostAccessDeps,
): Promise<FleetResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await listAgents(env, deps.bridgeCliConfig);
  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", agents: result.value };
}

export async function fetchChatStatus(
  principal: VerifiedPrincipal,
  conversationId: string,
  chatId: string,
  deps: HostAccessDeps,
): Promise<ChatResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await getChatStatus(chatId, env, deps.bridgeCliConfig);
  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", status: result.value };
}

/**
 * Epic listing does not need an epic id itself (the whole point of it) —
 * so this is the one read-surface call that only needs the tenant's
 * `home`, not a bound epic. Uses a placeholder `TRAYCER_EPIC_ID` value
 * because the bridge CLI currently requires the env var to be non-empty
 * even for a (future) command that doesn't use it — see `listEpics`'s own
 * docblock for why this call fails against the real bridge today
 * regardless.
 */
export async function fetchEpicList(
  principal: VerifiedPrincipal,
  deps: HostAccessDeps,
): Promise<EpicListResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const env = buildBridgeEnv(resolution.tenant, "unused", deps);
  const result = await listEpics(env, deps.bridgeCliConfig);
  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", epics: result.value };
}
