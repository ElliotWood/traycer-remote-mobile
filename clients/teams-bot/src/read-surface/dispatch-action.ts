import type { Attachment } from "@microsoft/agents-activity";
import {
  APPROVE_VERB,
  buildActionOutcomeCard,
  buildIdentityUnavailableCard,
  buildPrincipalRefusedCard,
  buildBridgeUnavailableCard,
  buildEpicNotBoundCard,
  buildUsageCard,
  buildMessageOutcomeCard,
  MAX_MESSAGE_LENGTH,
  MESSAGE_INPUT_ID,
  REJECT_VERB,
  SEND_VERB,
  OLDER_VERB,
  NEWER_VERB,
  FULL_HISTORY_VERB,
  TRANSCRIPT_PAGE_SIZE,
  buildTranscriptCard,
  type ChatRef,
} from "./cards";
import {
  submitApprovalDecision,
  submitChatMessage,
  fetchTranscript,
  type ApprovalDecision,
} from "./host-access";
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

/**
 * The send path. Same identity ordering as a decision — resolve, then act.
 *
 * The empty-message guard is not defensive padding: `Action.Submit` fires
 * whether or not the user typed anything, so an accidental tap on an
 * untouched composer would otherwise deliver an empty message into a running
 * agent's queue. That is unsendable once away, so it is refused here rather
 * than reported afterwards.
 */
async function dispatchSend(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const chatId = readString(request.data, "chatId");
  if (chatId === null) {
    return {
      card: buildUsageCard("That composer was missing its chat id."),
      acted: false,
    };
  }

  // Trimmed for the emptiness test AND for what is sent: a message that is
  // nothing but a stray newline is the same accident as an empty one.
  const text = (readString(request.data, MESSAGE_INPUT_ID) ?? "").trim();
  if (text.length === 0) {
    return {
      card: buildUsageCard(
        "Nothing to send — type a message before pressing Send.",
      ),
      acted: false,
    };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      card: buildUsageCard(
        `That message is ${String(text.length)} characters; the limit is ${String(MAX_MESSAGE_LENGTH)}.`,
      ),
      acted: false,
    };
  }

  // Identity first — before the message is issued, never after.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const chat: ChatRef = {
    chatId,
    // The composer knows the title it was rendered with; carrying it back
    // means the outcome card can name the chat without a second host read.
    title: readString(request.data, "chatTitle"),
  };

  const result = await submitChatMessage(
    identity.principal,
    request.conversationId,
    chatId,
    text,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildMessageOutcomeCard(result.outcome, chat),
        acted: true,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      // NOT "nothing happened": the bridge may have delivered the message
      // before failing. `acted` reports only whether we know an outcome.
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}

/**
 * Paging — the one action here that changes nothing.
 *
 * It is still identity-gated, for the same reason the reads are: the offset
 * and chat id arrive in the card payload, and a resolved principal is what
 * decides WHICH HOST is read. Without it a relayed payload could name a chat
 * on a host the presser has no claim to.
 *
 * `acted` is `false` on success, unlike every other branch: nothing was
 * changed. The flag reports mutation, not whether the press worked.
 */
async function dispatchPage(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const chatId = readString(request.data, "chatId");
  if (chatId === null) {
    return {
      card: buildUsageCard("That button was missing its chat id."),
      acted: false,
    };
  }
  // A malformed offset pages from a defined place rather than throwing or
  // silently slicing from the wrong end.
  const rawOffset = Number.parseInt(
    readString(request.data, "offset") ?? "",
    10,
  );
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const result = await fetchTranscript(
    identity.principal,
    request.conversationId,
    chatId,
    offset,
    TRANSCRIPT_PAGE_SIZE,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildTranscriptCard(result.transcript, deps.now()),
        acted: false,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}

export async function dispatchActionInvoke(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  if (request.verb === SEND_VERB) {
    return dispatchSend(request, deps);
  }
  if (
    request.verb === OLDER_VERB ||
    request.verb === NEWER_VERB ||
    request.verb === FULL_HISTORY_VERB
  ) {
    return dispatchPage(request, deps);
  }
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
