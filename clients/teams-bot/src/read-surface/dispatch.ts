import type { Attachment } from "@microsoft/agents-activity";
import {
  buildApprovalCard,
  buildBridgeUnavailableCard,
  buildChatCard,
  buildFocusStartedCard,
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
import type { FocusedChatStore } from "./focused-chat-store";
import type { OpportunityDetails } from "../intake/intake-form";
import type { StagingOutcome } from "../intake/attachment-staging";

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
    /** The five fields the intake form collected, already validated. */
    readonly opportunity: OpportunityDetails;
    /** Handle for the staged documents; `""` when nothing was attached. */
    readonly stagingId?: string;
  }) => Promise<{
    readonly kind: "started" | "unconfirmed";
    readonly card: Attachment;
  }>;
  /**
   * Downloads the documents on an arriving message. OPTIONAL for the same
   * reason `startAssessment` is: a deployment with nowhere to put them says
   * so rather than starting an assessment with no documents.
   */
  readonly stageAttachments?: (
    attachments: readonly unknown[] | undefined,
  ) => Promise<StagingOutcome>;
  /**
   * Preselects the intake form's time zone. Deliberately NOT defaulted in
   * code: an unset value means the user must choose, and a wrong offset on a
   * tender deadline is invisible where a missing one is a red message.
   */
  readonly defaultTimeZone?: string;
  /**
   * Records where proactive notifications for an epic should go.
   *
   * Called on a TURN, because a conversation reference exists nowhere else —
   * and until something calls it, `pushWatchEvent` has no route for any epic
   * and every approval is dropped with a "no Teams conversation bound" line.
   * That is half of why no approval has ever reached Teams.
   *
   * Synchronous, idempotent and cheap: it parses, compares against what is
   * stored, and returns without writing when nothing changed. Safe to call on
   * every message. `user` supplies the @-mention and `null` is a legitimate
   * state — it costs the tag, not the notification.
   */
  readonly rememberProactiveTarget?: (
    epicId: string,
    reference: unknown,
    user: { readonly id: string; readonly name: string } | null,
  ) => void;
  /** Injected so "requested 2m ago" labels are deterministic in tests. */
  readonly now: () => number;
  /**
   * Where this conversation's next typed message goes. REQUIRED, not
   * optional: an unwired store would make `Reply` appear to work and then
   * quietly send nothing, which is the failure this whole feature exists to
   * remove. A deployment that cannot focus should fail to construct, not
   * fail per message.
   */
  readonly focusedChats: FocusedChatStore;
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
        /*
         * NO COMPOSER CARD. Removed 2026-08-10.
         *
         * This used to append `buildComposeCard`, an `Input.Text` with its own
         * Send button — rendered directly above Teams' real compose box. Two
         * inputs, one of them fake. Elliot, from the live install: "reply
         * being embedded in a card instead of being natural".
         *
         * Replying is now focus: the status card's `Reply` button points the
         * conversation at this chat and you type in Teams' own box. So the
         * card that used to be here is the button that is already up there.
         *
         * `buildReadOnlyChatCard` SURVIVES, and its reason survives with it:
         * "a missing composer with no explanation is the white-screen failure
         * in miniature". Omitting the Reply button on an unsendable chat
         * silently poses the same question — where is the reply box — so the
         * answer is still said out loud rather than inferred from an absence.
         */
        if (!canSend) {
          cards.push(buildReadOnlyChatCard(chat));
        }
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

      /*
       * THE ONE PLACE FOCUS IS SET, and it is here rather than in the action
       * dispatcher for a reason worth stating: `Reply` on a card and
       * `compose <id>` typed by hand are the same intention, and this is
       * already the command both of them run. Setting focus in the button's
       * handler would have left the typed path rendering the old composer —
       * two ways to talk to an agent, only one of them the new one.
       *
       * It is also AFTER the `connected` check, deliberately. Focus is a
       * destination for everything the user types next; binding it to an id
       * the bridge could not resolve is `say hi` again, and this time the
       * mistake would be silent for every subsequent message rather than
       * visible on one card.
       */
      const target = {
        chatId: result.status.chatId,
        title: result.status.title,
      };
      // `canSend` is NOT checked here, and that is not an oversight — it is
      // the one gap in this design worth naming. `fetchChatCapabilities`
      // costs a second spawn, and the send itself already refuses and reports
      // through `buildMessageOutcomeCard`. Focusing an unsendable chat
      // therefore fails on the first message with a real reason rather than
      // on the button with a guessed one. If that proves confusing in use,
      // the fix is a capability read here, not a silent send.
      await deps.focusedChats.set(conversationId, {
        chatId: target.chatId,
        title: target.title,
        touchedAt: deps.now(),
      });
      return [buildFocusStartedCard(target, result.epicId)];
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
