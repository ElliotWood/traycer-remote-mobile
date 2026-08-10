import {
  ActivityHandler,
  MessageFactory,
  type TurnContext,
} from "@microsoft/agents-hosting";
import type {
  AdaptiveCardInvokeResponse,
  AdaptiveCardInvokeValue,
} from "@microsoft/agents-hosting";
import { parseCommand } from "./commands";
import { routeWhileFocused } from "./focus-routing";
import type { FocusedChat } from "./focused-chat-store";

/**
 * The label a card would use for this chat — the string the echo check looks
 * for. Mirrors `chatLabel` in `cards.ts`, which is not exported; kept as one
 * line rather than widening that module's surface for a heuristic.
 */
function chatLabelOf(chat: FocusedChat): string {
  const title = chat.title?.trim() ?? "";
  return title.length > 0 ? title : chat.chatId.slice(0, 8);
}
import { dispatchCommand, type DispatchDeps } from "./dispatch";
import { dispatchActionInvoke } from "./dispatch-action";
import { logInfo, logWarn } from "../logger";
import { stripMentions, type MentionEntity } from "../intake/mention";
import { classify } from "../intake/classify";
import { describeRoute } from "../intake/route-labels";
import {
  buildClarifyCard,
  buildIntakeRefusedCard,
  buildFocusEndedCard,
  focusExpiredText,
  focusInterceptedText,
  focusSentText,
} from "./cards";
import {
  captureRawAttachments,
  RAW_ATTACHMENT_LOG_FLAG,
} from "../intake/attachment-capture";
import {
  stagingUnavailable,
  type StagingOutcome,
} from "../intake/attachment-staging";

/**
 * The activity handler — messages and card actions.
 *
 * Deliberately thin: everything decidable without a `TurnContext` lives in
 * `commands.ts` (parsing), `dispatch.ts` (reads) and `dispatch-action.ts`
 * (writes), all unit-tested. This file only adapts the SDK's turn to those,
 * so the part that's hard to test holds almost no logic.
 */
class ReadSurfaceHandler extends ActivityHandler {
  private readonly deps: DispatchDeps;

  constructor(deps: DispatchDeps) {
    super();
    this.deps = deps;
    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    // R2 GROUNDWORK, and a measurement rather than a feature: record what an
    // attachment actually looks like in each conversation scope. Off unless
    // the flag is set — a payload carries a customer file name and a
    // pre-authorised download URL. Runs BEFORE parsing, so a message that
    // carries only a file and no text is still observed.
    captureRawAttachments({
      attachments: context.activity.attachments,
      conversationType: context.activity.conversation?.conversationType,
      enabled: process.env[RAW_ATTACHMENT_LOG_FLAG] === "1",
    });

    // A CARD BUTTON ARRIVES HERE, NOT AT `onAdaptiveCardInvoke`.
    //
    // Every action this bot emits is `Action.Submit` — deliberately, because
    // `Action.Execute` renders on Teams mobile and sends no invoke at all.
    // But Teams delivers `Action.Submit` as a MESSAGE activity carrying its
    // `data` in `activity.value`, with no text. `onAdaptiveCardInvoke` only
    // fires for `Action.Execute`.
    //
    // So until now every button on every card landed in `parseCommand("")`
    // and returned the HELP CARD. Approve, Reject, Send — all of them. The
    // write path in `dispatch-action.ts` was complete, tested, and connected
    // to an ingress nothing could reach: the file even records choosing
    // Submit over Execute on purpose, and the handler implements only the
    // Execute route.
    //
    // This is the ingress the buttons actually use.
    const actionValue = context.activity.value as
      | Record<string, unknown>
      | undefined;
    const actionVerb =
      typeof actionValue?.["verb"] === "string" ? actionValue["verb"] : null;
    if (actionVerb !== null) {
      const convId = context.activity.conversation?.id ?? "";
      const result = await dispatchActionInvoke(
        {
          verb: actionVerb,
          conversationId: convId,
          data: actionValue ?? {},
          // Captured HERE because this turn is the only moment it exists.
          // An action that starts long-running work must record where to
          // reply before it starts; afterwards there is nothing to derive it
          // from. Passed to every action rather than to the one that needs
          // it, so a second such action is a handler that already has it.
          conversationReference: context.activity.getConversationReference(),
        },
        this.deps,
      );
      if (!result.acted) {
        logWarn("card action did not complete", { verb: actionVerb });
      }
      logInfo("card action", { verb: actionVerb, acted: result.acted });
      await context.sendActivity(MessageFactory.attachment(result.card));
      return;
    }

    // Mentions come off via the ENTITIES, which are the contract; the old
    // `<at>` regex in `parseCommand` is a rendering assumption and stays only
    // as a fallback. This matters more than it used to: the text is becoming
    // classifier input rather than a verb lookup, so a stray "Traycer" at the
    // front is a token in a decision about a customer document.
    const spoken = stripMentions(
      context.activity.text ?? "",
      context.activity.entities as readonly MentionEntity[] | undefined,
      context.activity.recipient?.id,
    );
    const conversationId = context.activity.conversation?.id ?? "";

    /*
     * ══════════════════════════════════════════════════════════════════
     * FOCUS, BEFORE ANYTHING ELSE READS THE TEXT.
     *
     * When a chat is focused, an unrecognised sentence is A MESSAGE TO AN
     * AGENT rather than a request for help. That inverts the meaning of
     * everything below, so it cannot be a branch inside the fallback — it
     * has to come first, before `parseCommand` and before `classify`.
     *
     * The precedence rule and the argument for it live in
     * `focus-routing.ts`, deliberately as a pure function: this is the one
     * decision in the feature that can misdirect a message, so it is the
     * one that has to be testable without standing up a turn.
     * ══════════════════════════════════════════════════════════════════
     */
    const focus = await this.deps.focusedChats.get(conversationId, this.deps.now());
    if (focus.kind === "focused") {
      const routing = routeWhileFocused({
        text: spoken.text,
        hasAttachments: (context.activity.attachments?.length ?? 0) > 0,
      });
      if (routing.kind === "send") {
        await this.sendWhileFocused(context, conversationId, focus.chat, routing.text);
        return;
      }
      if (routing.kind === "exit") {
        await this.deps.focusedChats.clear(conversationId);
        await context.sendActivity(
          MessageFactory.attachment(buildFocusEndedCard(focus.chat)),
        );
        logInfo("focus cleared", { by: "word" });
        return;
      }
      // A reserved word. Say WHY it did not go to the agent, then run it —
      // in that order, so the explanation is above the result rather than
      // below it. `intercepted` is empty for an attachment or an empty
      // message, neither of which the user typed as a command.
      if (routing.intercepted.length > 0) {
        await context.sendActivity(
          MessageFactory.text(focusInterceptedText(routing.intercepted, focus.chat)),
        );
      }
    } else if (focus.kind === "expired" && spoken.text.trim().length > 0) {
      // NOT silently dropped. The message is not sent — that is the safe
      // direction and it is not in question — but the user's model was "I
      // am talking to Foo" and nothing had contradicted it.
      await context.sendActivity(
        MessageFactory.text(focusExpiredText(focus.title)),
      );
      logInfo("focus expired", {});
    }

    const command = parseCommand(spoken.text);

    // NATURAL LANGUAGE FIRST, commands as the fallback.
    //
    // `parseCommand` returns `help` for anything it does not recognise, which
    // was correct when a verb list was the interface and is wrong now: it
    // means "does this fit SensorMine?" gets a syntax card. So an
    // unrecognised message goes to the classifier instead, and only falls
    // back to help when the classifier recognises nothing either.
    if (command.kind === "help" && spoken.text.trim().length > 0) {
      const classified = classify({
        text: spoken.text,
        hasAttachments: (context.activity.attachments?.length ?? 0) > 0,
      });
      const route =
        classified.kind === "routed" ? classified.route : classified.suggestion;
      if (route !== null) {
        /*
         * STAGED HERE, ON THIS TURN, AND NOWHERE ELSE.
         *
         * A Teams `downloadUrl` is only valid on the activity that carried
         * it, and the confirm press arrives as a separate activity with no
         * attachments. So the bytes have to be fetched now, before anyone has
         * agreed to anything — the alternative is putting a pre-authorised
         * download URL into a card payload and asking Bot Service to relay it
         * back to us, which turns a credential into round-trip data.
         *
         * Gated on the classifier having produced a route, so an unrelated
         * file dropped into the chat is not downloaded.
         */
        const staging = await this.stage(context);
        if (staging.kind === "refused") {
          // LOUD. Channel scope, an undownloadable attachment and a duplicate
          // file name all land here, and every one of them would otherwise
          // become an assessment against zero documents that reads as
          // finished work.
          await context.sendActivity(
            MessageFactory.attachment(buildIntakeRefusedCard(staging.reason)),
          );
          logWarn("intake refused before it started", { reason: "staging" });
          return;
        }
        const staged =
          staging.kind === "staged"
            ? { id: staging.stagingId, names: staging.files.map((f) => f.name) }
            : { id: "", names: [] as readonly string[] };

        // The BUTTON carries the route. The handler must not re-derive it
        // from `suggestion` when the reply comes back — see buildClarifyCard.
        //
        // A CONFIDENT route gets the same card, not a silent dispatch: the
        // intake form needs five fields nothing here can supply, so a
        // confirmation step exists either way. What differs is the wording.
        await context.sendActivity(
          MessageFactory.attachment(
            buildClarifyCard({
              suggestionLabel: describeRoute(route),
              product: route.product,
              intent: route.intent,
              skill: route.skill,
              spokenText: spoken.text,
              stagingId: staged.id,
              stagedNames: staged.names,
              // Display-only, and the intake form's owner prefill. NEVER an
              // identity signal — who is acting still comes solely from
              // `resolvePrincipal`, exactly as it does for every card action.
              requesterName: context.activity.from?.name ?? "",
            }),
          ),
        );
        logInfo("offered an assessment", {
          confident: classified.kind === "routed",
          staged: staged.names.length,
        });
        return;
      }
    }

    if (conversationId === "") {
      logWarn("activity has no conversation id", { command: command.kind });
      await context.sendActivity(
        MessageFactory.text("Couldn't identify this conversation."),
      );
      return;
    }

    const cards = await dispatchCommand(command, conversationId, this.deps);
    // Logs the PARSED command kind and the reply size, never the message
    // text — the text can contain anything a user typed, including things
    // meant for an agent rather than for a log file.
    //
    // Added because a report of "one command produced two cards" could not
    // be confirmed or dismissed: nothing recorded which activities had
    // arrived, so there was no way to tell one command returning two cards
    // from two commands returning one each.
    logInfo("dispatched command", {
      command: command.kind,
      cards: cards.length,
    });
    for (const card of cards) {
      await context.sendActivity(MessageFactory.attachment(card));
    }
  }

  /**
   * Stages the turn's attachments, or reports that this deployment cannot.
   *
   * A deployment with no `stageAttachments` wired REFUSES when files are
   * present rather than proceeding without them: "assessment started" on a
   * request whose documents were dropped is the false-success shape this
   * whole client keeps finding. With no attachments at all it is simply a
   * request with no files, which is legitimate.
   */
  private async stage(context: TurnContext): Promise<StagingOutcome> {
    const attachments = context.activity.attachments;
    return this.deps.stageAttachments === undefined
      ? stagingUnavailable(attachments)
      : this.deps.stageAttachments(attachments);
  }

  /**
   * Deliver a typed message to the focused chat.
   *
   * ROUTES THROUGH `dispatchCommand({ kind: "say" })`, which is the same path
   * the typed `say <id> <text>` command uses. Not a shortcut to
   * `submitChatMessage`: that command already validates the destination
   * before sending, refuses a chat the bridge cannot resolve, and renders the
   * outcome through `buildMessageOutcomeCard` — including the "may already
   * have reached the agent" wording that a duplicate send depends on. A
   * second, thinner send path would have had to reproduce all of it, and the
   * one it forgot would be the one that matters.
   *
   * `touchedAt` is refreshed BEFORE the send, not after. The window matters:
   * a send that hangs and then fails should still have counted as activity,
   * because the user was demonstrably here. Refreshing afterwards would let a
   * slow failure expire the focus the user is actively using.
   */
  private async sendWhileFocused(
    context: TurnContext,
    conversationId: string,
    chat: FocusedChat,
    text: string,
  ): Promise<void> {
    await this.deps.focusedChats.set(conversationId, {
      ...chat,
      touchedAt: this.deps.now(),
    });

    const cards = await dispatchCommand(
      { kind: "say", chatId: chat.chatId, text },
      conversationId,
      this.deps,
    );

    /*
     * THE ECHO, and it is the answer to "how do I know where my typing is
     * going".
     *
     * `dispatchCommand` already returns an outcome card, and on the happy
     * path that card says "Message sent — Delivered to Foo". So the echo is
     * only added when the send did NOT produce one that names the target:
     * two confirmations for one message is noise, and noise is what makes
     * people stop reading the thing that matters.
     *
     * The invariant, not the implementation: after every message, the last
     * thing in the conversation names the agent it went to. If it does not,
     * you are not focused.
     */
    const named = cards.some((card) =>
      JSON.stringify(card.content).includes(chatLabelOf(chat)),
    );
    for (const card of cards) {
      await context.sendActivity(MessageFactory.attachment(card));
    }
    if (!named) {
      await context.sendActivity(MessageFactory.text(focusSentText(chat)));
    }
    logInfo("sent while focused", { named });
  }

  /**
   * `Action.Execute` from an approval card. Returns HTTP 200 with a fresh
   * card so Teams replaces the pressed card in place — that is the whole
   * point of Execute over Submit, and it is what stops a resolved approval
   * leaving live buttons behind.
   */
  protected async onAdaptiveCardInvoke(
    context: TurnContext,
    invokeValue: AdaptiveCardInvokeValue,
  ): Promise<AdaptiveCardInvokeResponse> {
    const conversationId = context.activity.conversation?.id ?? "";
    const verb = invokeValue.action?.verb ?? "";
    const data =
      (invokeValue.action?.data as Record<string, unknown> | undefined) ?? {};

    const result = await dispatchActionInvoke(
      { verb, conversationId, data },
      this.deps,
    );

    if (!result.acted) {
      logWarn("card action did not complete", { verb });
    }

    return {
      statusCode: 200,
      type: "application/vnd.microsoft.card.adaptive",
      value: asCardContent(result.card.content),
    };
  }
}

/**
 * `Attachment.content` is untyped at the SDK boundary; the invoke response
 * requires a `Record<string, unknown>`. Narrow it after a real runtime check
 * rather than asserting blindly — an empty object is a safe fallback that
 * Teams renders as an empty card instead of throwing.
 */
function asCardContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function createReadSurfaceHandler(deps: DispatchDeps): ActivityHandler {
  return new ReadSurfaceHandler(deps);
}
