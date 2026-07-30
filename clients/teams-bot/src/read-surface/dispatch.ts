import type { Attachment } from "@microsoft/agents-activity";
import {
  buildApprovalCard,
  buildBridgeUnavailableCard,
  buildChatCard,
  buildInterviewCard,
  buildEpicBoundCard,
  buildEpicNotBoundCard,
  buildEpicPickerCard,
  buildFleetCard,
  buildHelpCard,
  buildIdentityUnavailableCard,
  buildPrincipalRefusedCard,
  buildUsageCard,
} from "./cards";
import type { Command } from "./commands";
import {
  fetchChatStatus,
  fetchEpicList,
  fetchFleet,
  type HostAccessDeps,
  type ReadSurfaceFailure,
} from "./host-access";
import type { ResolvePrincipal } from "./principal-source";

/**
 * Turns a parsed {@link Command} into exactly one card. No `TurnContext`,
 * no SDK types beyond `Attachment` — so the entire read surface's routing
 * and failure behaviour is testable without standing up a bot.
 *
 * Every branch returns a card. There is no path that returns nothing, and
 * no path that renders host data without having resolved a verified
 * principal first — identity resolution happens before any fetch, for
 * every command that touches host data.
 */

export interface DispatchDeps extends HostAccessDeps {
  readonly resolvePrincipal: ResolvePrincipal;
  /** Injected so "requested 2m ago" labels are deterministic in tests. */
  readonly now: () => number;
}

function failureCard(failure: ReadSurfaceFailure): Attachment {
  switch (failure.kind) {
    case "principal_refused":
      return buildPrincipalRefusedCard(failure.reason);
    case "epic_not_bound":
      return buildEpicNotBoundCard();
    case "bridge_unavailable":
      return buildBridgeUnavailableCard(failure.reason, failure.detail);
  }
}

/**
 * Returns one OR MORE cards. `chat <id>` renders the status card plus one
 * actionable approval card per pending approval, so a blocked agent can be
 * answered from the same reply — that is the product's whole promise and it
 * shouldn't take a second command to reach.
 */
export async function dispatchCommand(
  command: Command,
  conversationId: string,
  deps: DispatchDeps,
): Promise<readonly Attachment[]> {
  if (command.kind === "help") {
    return [buildHelpCard()];
  }
  // A recognised word used wrongly gets a usage card, not the help card —
  // the user typed bare `epic`, saw help, and read it as "no such command".
  if (command.kind === "usage") {
    return [buildUsageCard(command.usage)];
  }

  // Identity first, always — before any host data is fetched, for every
  // command that could touch it. A command that cannot establish who is
  // asking gets a refusal, never a default or a partial view.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return [buildIdentityUnavailableCard(identity.reason)];
  }
  const { principal } = identity;

  switch (command.kind) {
    case "epics": {
      const result = await fetchEpicList(principal, deps);
      return [
        result.kind === "ok"
          ? buildEpicPickerCard(result.epics)
          : failureCard(result),
      ];
    }
    case "bind_epic": {
      // Binding is still identity-gated: an unmapped principal must not be
      // able to write a binding it could never use, and must not learn
      // whether an epic id exists.
      const resolution = deps.registry.resolveTenant(principal);
      if (resolution.kind === "refused") {
        return [buildPrincipalRefusedCard(resolution.reason)];
      }
      await deps.epicBindings.set(conversationId, command.epicId);
      return [buildEpicBoundCard(command.epicId)];
    }
    case "fleet": {
      const result = await fetchFleet(principal, conversationId, deps);
      return [
        result.kind === "ok"
          ? buildFleetCard(result.agents)
          : failureCard(result),
      ];
    }
    case "chat": {
      const result = await fetchChatStatus(
        principal,
        conversationId,
        command.chatId,
        deps,
      );
      if (result.kind !== "ok") {
        return [failureCard(result)];
      }
      const { epicId } = result;
      const cards: Attachment[] = [buildChatCard(result.status, epicId)];
      // Only offer buttons when the bridge says the subscription is genuinely
      // live. Acting on a stale snapshot is how you approve something that
      // was already resolved — `connected: false` means every field above may
      // be out of date, so it must not carry actions.
      if (result.status.connected) {
        const now = deps.now();
        // Carries the title too: these cards are read on their own, detached
        // from the status card above them, so a bare short id names nothing.
        const chat = {
          chatId: result.status.chatId,
          title: result.status.title,
        };
        for (const approval of result.status.pendingApprovals) {
          cards.push(buildApprovalCard(chat, epicId, approval, now));
        }
        for (const interview of result.status.pendingInterviews) {
          cards.push(buildInterviewCard(chat, epicId, interview, now));
        }
      }
      return cards;
    }
  }
}
