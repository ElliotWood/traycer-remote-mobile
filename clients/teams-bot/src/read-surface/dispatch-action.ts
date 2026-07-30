import type { Attachment } from "@microsoft/agents-activity";
import {
  APPROVE_VERB,
  buildActionOutcomeCard,
  buildIdentityUnavailableCard,
  buildPrincipalRefusedCard,
  buildBridgeUnavailableCard,
  buildEpicNotBoundCard,
  buildUsageCard,
  REJECT_VERB,
} from "./cards";
import { submitApprovalDecision, type ApprovalDecision } from "./host-access";
import type { DispatchDeps } from "./dispatch";

/**
 * T3's `Action.Execute` handler — the write path.
 *
 * Identity is resolved BEFORE the action is issued, exactly as for reads.
 * The verb and approvalId come from the card's own `data`, which Bot Service
 * relays; that is NOT treated as an identity signal, only as *which*
 * approval is being acted on. Who is acting still comes solely from
 * `resolvePrincipal`, so a forged `data` payload can at worst name a
 * different approval id on the acting user's own host — it can never act as
 * someone else.
 */

export interface ActionInvokeRequest {
  readonly verb: string;
  readonly conversationId: string;
  /** The card's `data` merged with any `Input.*` values Teams collected. */
  readonly data: Readonly<Record<string, unknown>>;
}

export type ActionInvokeResult = {
  /** Card to render in place of the one that was pressed. */
  readonly card: Attachment;
  /** `false` when the request was malformed or unauthorised rather than acted on. */
  readonly acted: boolean;
};

function readString(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function dispatchActionInvoke(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  if (request.verb !== APPROVE_VERB && request.verb !== REJECT_VERB) {
    return {
      card: buildUsageCard(`Unknown card action "${request.verb}".`),
      acted: false,
    };
  }

  const approvalId = readString(request.data, "approvalId");
  if (approvalId === null) {
    return {
      card: buildUsageCard("That button was missing its approval id."),
      acted: false,
    };
  }

  // Identity first — before the action is issued, never after.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const decision: ApprovalDecision =
    request.verb === APPROVE_VERB
      ? { kind: "approve" }
      : { kind: "reject", reason: readString(request.data, "rejectReason") };

  const result = await submitApprovalDecision(
    identity.principal,
    request.conversationId,
    approvalId,
    decision,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildActionOutcomeCard(result.outcome, decision.kind),
        acted: true,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      // NOT `acted: false` in the sense of "nothing happened" — the bridge
      // may have issued the action before failing. The card says so; this
      // flag only reports whether we know an outcome.
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}
