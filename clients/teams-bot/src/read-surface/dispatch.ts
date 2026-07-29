import type { Attachment } from "@microsoft/agents-activity";
import {
  buildBridgeUnavailableCard,
  buildChatCard,
  buildEpicBoundCard,
  buildEpicNotBoundCard,
  buildEpicPickerCard,
  buildFleetCard,
  buildHelpCard,
  buildIdentityUnavailableCard,
  buildPrincipalRefusedCard,
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

export async function dispatchCommand(
  command: Command,
  conversationId: string,
  deps: DispatchDeps,
): Promise<Attachment> {
  if (command.kind === "help") {
    return buildHelpCard();
  }

  // Identity first, always — before any host data is fetched, for every
  // command that could touch it. A command that cannot establish who is
  // asking gets a refusal, never a default or a partial view.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return buildIdentityUnavailableCard(identity.reason);
  }
  const { principal } = identity;

  switch (command.kind) {
    case "epics": {
      const result = await fetchEpicList(principal, deps);
      return result.kind === "ok"
        ? buildEpicPickerCard(result.epics)
        : failureCard(result);
    }
    case "bind_epic": {
      // Binding is still identity-gated: an unmapped principal must not be
      // able to write a binding it could never use, and must not learn
      // whether an epic id exists.
      const resolution = deps.registry.resolveTenant(principal);
      if (resolution.kind === "refused") {
        return buildPrincipalRefusedCard(resolution.reason);
      }
      await deps.epicBindings.set(conversationId, command.epicId);
      return buildEpicBoundCard(command.epicId);
    }
    case "fleet": {
      const result = await fetchFleet(principal, conversationId, deps);
      return result.kind === "ok"
        ? buildFleetCard(result.agents)
        : failureCard(result);
    }
    case "chat": {
      const result = await fetchChatStatus(
        principal,
        conversationId,
        command.chatId,
        deps,
      );
      return result.kind === "ok"
        ? buildChatCard(result.status)
        : failureCard(result);
    }
  }
}
