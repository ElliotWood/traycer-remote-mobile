import type { IdentityRegistry } from "@traycer-clients/shared/identity-registry/registry";
import { buildTenantEnvironment } from "@traycer-clients/shared/identity-registry/tenant-environment";
import type {
  RefusalReason,
  VerifiedPrincipal,
} from "@traycer-clients/shared/identity-registry/types";
import {
  answerInterviewAction,
  approveAction,
  getChatStatus,
  listAgents,
  listEpics,
  rejectAction,
  sendMessageAction,
  getTranscript,
  type BridgeCliConfig,
  type BridgeCliFailureReason,
  type InterviewAnswerInput,
} from "./bridge-cli";
import type { EpicBindingStore } from "./epic-binding-store";
import { logWarn } from "../logger";
import type {
  ActionOutcome,
  AgentSummary,
  ChatStatus,
  EpicSummary,
  Transcript,
} from "./bridge-types";

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
  | {
      readonly kind: "ok";
      readonly status: ChatStatus;
      /** The epic this status was fetched under — returned so cards can show
       * which epic a decision belongs to without re-reading the binding. */
      readonly epicId: string;
    }
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

/**
 * The single funnel every bridge failure passes through — and therefore the
 * right place to log the diagnostic detail.
 *
 * It is logged HERE precisely because it must not travel any further towards
 * the user. `detail` is raw subprocess stderr: it has carried a JSON log
 * line, an internal stream-client message, a tenant filesystem path and a
 * user id. That once reached a card verbatim, which was both ugly and a
 * disclosure. The card now selects wording from it and never prints it; this
 * log line is what makes the failure diagnosable instead.
 */
function toReadSurfaceFailure(result: {
  readonly kind: "failed";
  readonly reason: BridgeCliFailureReason;
  readonly detail: string;
}): ReadSurfaceFailure {
  logWarn("bridge call failed", {
    reason: result.reason,
    detail: result.detail,
  });
  return {
    kind: "bridge_unavailable",
    reason: result.reason,
    detail: result.detail,
  };
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
  return { kind: "ok", status: result.value, epicId };
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
export type ActionResult =
  { readonly kind: "ok"; readonly outcome: ActionOutcome } | ReadSurfaceFailure;

export type ApprovalDecision =
  | { readonly kind: "approve" }
  | { readonly kind: "reject"; readonly reason: string | null };

/**
 * T3's write path. Identity-gated exactly like the reads — `resolveTenant`
 * runs BEFORE the action is issued, and the bridge runs under that tenant's
 * own `HOME`, so an action can only ever land on the host of the principal
 * that authorised it.
 *
 * A routing bug here is categorically worse than in a read (see T3's
 * ticket): a read shows the wrong data, an action is *taken as the wrong
 * person*. Hence the same gate, no shortcuts, and no path that reaches the
 * bridge without a resolved tenant.
 */
export async function submitApprovalDecision(
  principal: VerifiedPrincipal,
  conversationId: string,
  approvalId: string,
  decision: ApprovalDecision,
  deps: HostAccessDeps,
): Promise<ActionResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result =
    decision.kind === "approve"
      ? await approveAction(approvalId, env, deps.bridgeCliConfig)
      : await rejectAction(
          approvalId,
          decision.reason,
          env,
          deps.bridgeCliConfig,
        );

  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", outcome: result.value };
}

/**
 * Sends a message to a chat, through the SAME identity seam as approvals —
 * `resolveTenant` before the send, never after, and the bridge runs under
 * that tenant's own `HOME`.
 *
 * Routing this through `resolveTenant` rather than trusting the card's
 * `chatId` matters for a reason beyond consistency. The chat id arrives in
 * the action payload, which Bot Service relays and which we do not treat as
 * an identity signal. A forged payload can therefore name a different chat —
 * but only ever on the acting user's OWN host, because the host is chosen by
 * the resolved principal and nothing in the payload can influence it. It can
 * never send as someone else.
 *
 * KNOWN GAP, out of scope today and deliberately not papered over: the
 * bridge stamps the outbound frame with its own authenticated host user, so
 * a message sent from Teams is indistinguishable in the transcript from one
 * typed on the desktop. That is fine while the demo principal is env-gated
 * and single-user. It stops being fine the moment SSO admits a second person,
 * at which point their message would be attributed to the host owner. The
 * send path goes through this seam precisely so that fix is a change of
 * VALUE, not a change of shape.
 */
export async function submitChatMessage(
  principal: VerifiedPrincipal,
  conversationId: string,
  chatId: string,
  text: string,
  deps: HostAccessDeps,
): Promise<ActionResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await sendMessageAction(
    chatId,
    text,
    env,
    deps.bridgeCliConfig,
  );

  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", outcome: result.value };
}

/**
 * Answers a pending interview, through the SAME identity seam as approvals
 * and sends — `resolveTenant` first, act second. `blockId` arrives in the
 * card's payload and is treated exactly as `chatId` is: it says WHICH
 * interview, never who is answering it, so a forged payload can at worst
 * name a different block on the acting user's own host.
 *
 * Carries the same attribution gap as {@link submitChatMessage}: the bridge
 * stamps its own authenticated host user, so an answer given from Teams is
 * indistinguishable from one given on the desktop. Single-user and
 * env-gated today; the fix is a change of VALUE at this seam, not of shape.
 */
export async function submitInterviewAnswer(
  principal: VerifiedPrincipal,
  conversationId: string,
  chatId: string,
  blockId: string,
  answers: readonly InterviewAnswerInput[],
  deps: HostAccessDeps,
): Promise<ActionResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await answerInterviewAction(
    chatId,
    blockId,
    answers,
    env,
    deps.bridgeCliConfig,
  );

  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", outcome: result.value };
}

/**
 * What this host can do with one chat.
 *
 * A separate read because the capability is per-AGENT (`agent.list`) while
 * the chat status is per-CHAT (`chat.subscribe`), and the two do not travel
 * together. That costs an extra spawn on `chat <id>`, which is the right
 * trade against rendering a Send box on a chat that cannot receive one —
 * measured: 53 of 56 agents are readable and not messageable.
 *
 * Deliberately NOT cached. Capability is stable for an agent's life, so a
 * cache is tempting and cheap; a stale one that wrongly ENABLES Send is
 * worse than the spawn it saves, and there is no measurement yet saying the
 * spawn hurts.
 */
export type ChatCapabilities = {
  readonly readTranscript: boolean;
  readonly sendMessage: boolean;
};

export type CapabilitiesResult =
  | { readonly kind: "ok"; readonly capabilities: ChatCapabilities }
  | ReadSurfaceFailure;

export async function fetchChatCapabilities(
  principal: VerifiedPrincipal,
  conversationId: string,
  chatId: string,
  deps: HostAccessDeps,
): Promise<CapabilitiesResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }
  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) return { kind: "epic_not_bound" };

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await listAgents(env, deps.bridgeCliConfig);
  if (result.kind === "failed") return toReadSurfaceFailure(result);

  const agent = result.value.find((a) => a.agentId === chatId);
  // An id the fleet does not know: report NO capability rather than assuming
  // one. Guessing "allowed" here would put the Send box back.
  return {
    kind: "ok",
    capabilities: agent?.capabilities ?? {
      readTranscript: false,
      sendMessage: false,
    },
  };
}

export type TranscriptResult =
  { readonly kind: "ok"; readonly transcript: Transcript } | ReadSurfaceFailure;

/** Identity-gated exactly like every other read. `offset` counts from the newest end. */
export async function fetchTranscript(
  principal: VerifiedPrincipal,
  conversationId: string,
  chatId: string,
  offset: number,
  limit: number,
  deps: HostAccessDeps,
): Promise<TranscriptResult> {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") {
    return { kind: "principal_refused", reason: resolution.reason };
  }

  const epicId = await deps.epicBindings.get(conversationId);
  if (epicId === null) {
    return { kind: "epic_not_bound" };
  }

  const env = buildBridgeEnv(resolution.tenant, epicId, deps);
  const result = await getTranscript(
    chatId,
    offset,
    limit,
    env,
    deps.bridgeCliConfig,
  );
  if (result.kind === "failed") {
    return toReadSurfaceFailure(result);
  }
  return { kind: "ok", transcript: result.value };
}

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

/**
 * The tenant env for a principal, for callers outside this file.
 *
 * Exists so `startAssessment` does NOT build its own. `buildBridgeEnv` is
 * private on purpose and `tenant-environment.ts` records why: two independent
 * env constructions is the defect that file exists to prevent. A second
 * construction in `index.ts` would drift from this one silently, and the
 * symptom would be an agent running under the wrong HOME.
 *
 * `null` when the principal resolves to no tenant — the caller must refuse
 * rather than fall back to the parent env, which would run the bridge as
 * whoever the bot process is.
 */
export function resolveTenantEnv(
  principal: VerifiedPrincipal,
  epicId: string,
  deps: HostAccessDeps,
): NodeJS.ProcessEnv | null {
  const resolution = deps.registry.resolveTenant(principal);
  if (resolution.kind === "refused") return null;
  return buildBridgeEnv(resolution.tenant, epicId, deps);
}
