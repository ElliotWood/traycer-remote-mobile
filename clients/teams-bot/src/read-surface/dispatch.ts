import type { Attachment } from "@microsoft/agents-activity";
import {
  buildApprovalCard,
  buildBridgeUnavailableCard,
  buildChatCard,
  buildComposeCard,
  buildContextStripCard,
  buildTranscriptCard,
  buildUnknownChatCard,
  buildReadOnlyChatCard,
  CONTEXT_STRIP_SIZE,
  TRANSCRIPT_PAGE_SIZE,
  buildInterviewCard,
  buildMessageOutcomeCard,
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
  fetchTranscript,
  fetchChatCapabilities,
  submitChatMessage,
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
  /**
   * Starts a long-running assessment. OPTIONAL: a deployment without it
   * refuses the button in words rather than appearing to work.
   *
   * Takes the conversation reference because the reply arrives hours later
   * and this turn is the only moment it exists.
   */
  readonly startAssessment?: (input: {
    readonly conversationId: string;
    readonly skill: string;
    readonly product: string;
    readonly intent: string;
    readonly conversationReference: unknown;
    /** The requester's own words, carried through the button. */
    readonly spokenText?: string;
    readonly attachmentCount?: number;
  }) => Promise<{ readonly kind: "started" | "unconfirmed"; readonly card: Attachment }>;
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
      /**
       * The capability read moved ABOVE the status card, because the status
       * card now offers `Reply` and has to know whether it may.
       *
       * Same call, same cost, one step earlier — and it is skipped entirely
       * when the chat is disconnected, since that card carries no actions
       * either way. Gating Reply on `connected` alone was measured wrong once
       * already: 53 of 56 agents are readable and not messageable.
       */
      const caps = result.status.connected
        ? await fetchChatCapabilities(
            principal,
            conversationId,
            command.chatId,
            deps,
          )
        : null;
      const canSend =
        caps !== null && caps.kind === "ok" && caps.capabilities.sendMessage;

      const cards: Attachment[] = [
        buildChatCard(result.status, epicId, canSend),
      ];
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
        // A SHORT context strip, not the transcript. Enough to see what the
        // agent was doing when it stopped, without pushing the approval
        // behind Teams' "see more" collapse — the full history is `log <id>`,
        // one button away.
        //
        // A transcript failure must not take the decision cards with it: the
        // approval above is the thing that matters, so a broken strip is
        // simply omitted rather than turned into an error card.
        const transcript = await fetchTranscript(
          principal,
          conversationId,
          command.chatId,
          0,
          CONTEXT_STRIP_SIZE,
          deps,
        );
        if (transcript.kind === "ok") {
          cards.push(buildContextStripCard(transcript.transcript, now));
        }
        // The composer goes LAST, after anything awaiting a decision. A chat
        // you can watch but not talk to was the functional hole; putting the
        // reply box above the approvals would bury the thing that is
        // actually blocking the agent.
        //
        // But ONLY when this host can actually send. `connected` is not
        // sufficient evidence: it describes the subscription, which works
        // fine for a remote chat — that is how the transcript above arrives.
        // Measured, 53 of 56 agents are readable and NOT messageable, so
        // gating on `connected` put a Send box on 53 chats that could not
        // receive one. Same class as the composer `say hi` opened onto a
        // chat that did not exist, one field over.
        //
        // `canSend` is read once, above, and used TWICE — here and by the
        // status card's Reply button. Two reads could disagree.
        cards.push(
          canSend
            ? buildComposeCard(chat, epicId)
            : buildReadOnlyChatCard(chat),
        );
      }
      return cards;
    }
    case "log": {
      // Same destination check as `say`/`compose`, and for the same reason.
      // Found by asking what ELSE a person might reasonably type: "log in"
      // parses as `log` + chat id "in", and the bridge answers a bogus id
      // with a valid, empty transcript —
      //   {"chatId":"in","title":null,"totalCount":0,"messages":[]}
      // — which rendered as a history card for a chat that does not exist.
      // Verified against the real bridge, not assumed.
      //
      // Costs one extra spawn on a command that already spawns. Worth it:
      // the rule is now the same everywhere a user names a chat, so there is
      // one thing to remember rather than three places to check.
      const target = await fetchChatStatus(
        principal,
        conversationId,
        command.chatId,
        deps,
      );
      if (target.kind !== "ok") {
        return [failureCard(target)];
      }
      if (!target.status.connected) {
        return [buildUnknownChatCard(command.chatId)];
      }

      const result = await fetchTranscript(
        principal,
        conversationId,
        command.chatId,
        command.offset,
        TRANSCRIPT_PAGE_SIZE,
        deps,
      );
      if (result.kind !== "ok") {
        return [failureCard(result)];
      }
      return [buildTranscriptCard(result.transcript, deps.now())];
    }
    case "compose": {
      const result = await fetchChatStatus(
        principal,
        conversationId,
        command.chatId,
        deps,
      );
      if (result.kind !== "ok") {
        return [failureCard(result)];
      }
      // `connected` is the ONLY evidence the chat is real.
      //
      // A `kind: "ok"` status is not: the bridge opens a subscription for
      // whatever id it is handed and reports `connected: false` when no
      // snapshot ever arrives, so a nonexistent id comes back as a
      // plausible-looking status with a null title. That is how `say hi`
      // rendered a composer headed "Reply to hi" — a card that looks
      // actionable and points nowhere, which is exactly the failure the
      // card-input design was chosen to prevent. It got in through
      // validation rather than through the design.
      if (!result.status.connected) {
        return [buildUnknownChatCard(command.chatId)];
      }
      return [
        buildComposeCard(
          { chatId: result.status.chatId, title: result.status.title },
          result.epicId,
        ),
      ];
    }
    case "say": {
      // Validate the destination BEFORE sending, for the same reason the
      // composer does: `say hi there` would otherwise deliver "there" to a
      // chat named "hi", failing somewhere in the bridge with a message the
      // user cannot act on. One extra status read is cheap next to a
      // message that cannot be unsent going somewhere unintended.
      const target = await fetchChatStatus(
        principal,
        conversationId,
        command.chatId,
        deps,
      );
      if (target.kind !== "ok") {
        return [failureCard(target)];
      }
      if (!target.status.connected) {
        return [buildUnknownChatCard(command.chatId)];
      }

      const result = await submitChatMessage(
        principal,
        conversationId,
        command.chatId,
        command.text,
        deps,
      );
      if (result.kind !== "ok") {
        return [failureCard(result)];
      }
      return [
        buildMessageOutcomeCard(result.outcome, {
          chatId: command.chatId,
          title: target.status.title,
        }),
      ];
    }
  }
}
