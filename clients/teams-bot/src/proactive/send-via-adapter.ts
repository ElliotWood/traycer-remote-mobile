/**
 * The Bot Service edge of the proactive path — deliberately the thinnest
 * thing that can work.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SCOPE, STATED PLAINLY: THIS HAS NEVER BEEN RUN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No proactive message has ever been sent from this bot. T0c (the app
 * package) is blocked on a human, so `continueConversation` cannot be
 * exercised against real Bot Service from here, and pretending otherwise is
 * the hollow-green-check this epic keeps catching.
 *
 * The response is not to skip the code — it is to make the **unrunnable
 * surface as small as possible**. Everything that can be decided without a
 * network lives in `push-notifications.ts` and `classify-send-failure.ts`
 * and is unit-tested. What remains here is a field mapping and one SDK call.
 * {@link toConversationReference} is pure and IS tested; only
 * {@link createAdapterSend}'s single `await` is unverified.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 THE RENAME THAT FAILS SILENTLY: `bot` → `agent`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `StoredConversationReference` persists `bot: { id, name? }`, matching the
 * Bot Framework vocabulary and what this project has written down.
 * `@microsoft/agents-activity`'s `ConversationReference` calls that same
 * field **`agent`** (its `conversationReference.d.ts`: *"The agent involved
 * in the conversation"*), and every member of it is OPTIONAL.
 *
 * So `{ ...stored }` type-checks, runs, and leaves `agent` undefined. There
 * is no error — the send simply goes out without the field, and the failure
 * appears later as a routing problem with no obvious cause. That is the
 * documented agents-* v4 rename hazard, arriving on the exact structure this
 * file has to convert.
 *
 * Hence an explicit field-by-field mapping and a test that asserts `agent`
 * is populated. A spread would be shorter and would be the bug.
 */
import type { CloudAdapter, TurnContext } from "@microsoft/agents-hosting";
import { MessageFactory } from "@microsoft/agents-hosting";
import type {
  Attachment,
  ConversationReference,
  Entity,
} from "@microsoft/agents-activity";
import type { StoredConversationReference } from "../state/conversation-reference-store";
import type { AppearedEvent, WatchEvent } from "./watch-line";
import type { SendProactive } from "./push-notifications";
import type { ProactiveTarget } from "./proactive-store";
import { buildMentionedText } from "../teams/mention";

/**
 * Our persisted shape → the SDK's shape.
 *
 * Field-by-field on purpose; see the header on `bot` → `agent`. Pure, so the
 * one mapping that can silently lose a field is testable without Bot
 * Service.
 */
export function toConversationReference(
  stored: StoredConversationReference,
): ConversationReference {
  return {
    channelId: stored.channelId,
    serviceUrl: stored.serviceUrl,
    conversation: {
      id: stored.conversation.id,
      conversationType: stored.conversation.conversationType,
      tenantId: stored.tenantId,
    },
    // THE RENAME. `stored.bot`, SDK `agent`. Do not "simplify" to a spread.
    agent: { id: stored.bot.id, name: stored.bot.name },
    user: stored.user === undefined ? undefined : { id: stored.user.id },
  };
}

/**
 * Turns an event into the card that interrupts someone.
 *
 * Injected with NO default, deliberately. The T4 design is explicit that *"a
 * proactive approval card and a tab-delivered approval card must be the same
 * card, or the user learns two vocabularies for one decision"* — so which
 * card this is, is a decision belonging to the card surface in
 * `read-surface/cards.ts`, not one to be invented here because the send path
 * needed something to send. A default would quietly become that second
 * vocabulary.
 */
export type RenderProactiveCard = (event: AppearedEvent) => Attachment;

/**
 * Binds an adapter, an app id and a card renderer into the {@link
 * SendProactive} contract: resolve on acceptance, throw on failure.
 *
 * It does NOT catch. Classification is `outcomeOfSendError`'s job, in one
 * place, so a new failure mode is diagnosed once — and a `try` here that
 * returned normally would report every failure as a successful send.
 */
/**
 * The lead-in sentence, which is also the LOCK SCREEN PREVIEW.
 *
 * Teams shows the start of `activity.text` in the notification, so this is
 * what a person reads before deciding whether to open Teams at all. It names
 * the chat, because "an agent needs you" across a fleet of fifty is not
 * actionable.
 */
export function appearedLead(event: AppearedEvent): {
  readonly lead: string;
  readonly trail: string;
} {
  const where = event.chatTitle === null ? "an agent" : event.chatTitle;
  return event.kind === "approval.requested"
    ? { lead: "", trail: ` — ${where} needs your approval to continue.` }
    : { lead: "", trail: ` — ${where} is waiting on your answer.` };
}

/**
 * What the correction says when something stops waiting.
 *
 * Plain text, no card, no tag. The card above it cannot be refreshed —
 * `Action.Submit` has no in-place update — so this exists to stop a live
 * request for a decision that was already made elsewhere from being the last
 * thing on screen.
 */
export function resolvedText(event: WatchEvent): string {
  return event.kind === "approval.requested"
    ? "That approval has been handled — nothing needed from you now."
    : "That interview has been answered — nothing needed from you now.";
}

/**
 * Binds an adapter, an app id and a card renderer into the {@link
 * SendProactive} contract: resolve on acceptance, throw on failure.
 *
 * It does NOT catch. Classification is `outcomeOfSendError`'s job, in one
 * place, so a new failure mode is diagnosed once — and a `try` here that
 * returned normally would report every failure as a successful send.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TAG IS THE FEATURE, NOT A GARNISH
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elliot asked for "a push notification with a tag to get my attention". In a
 * Teams CHANNEL, a bot message with no @-mention arrives silently — the card
 * can be perfect and never be seen. So an `appeared` send carries the mention
 * entity AND the matching `<at>` markup, built together in `teams/mention.ts`
 * because Teams renders them as literal text and notifies nobody when they
 * disagree, with no error on either side.
 *
 * A `resolved` send carries NO tag. A tag demands attention and "you no
 * longer need to do this" is the opposite of a demand; tagging on every
 * resolution is how a channel gets muted, which is the same outcome as the
 * bug being fixed.
 */
export function createAdapterSend(
  adapter: CloudAdapter,
  agentAppId: string,
  renderCard: RenderProactiveCard,
): SendProactive {
  return async (
    target: ProactiveTarget,
    event: WatchEvent,
  ): Promise<void> => {
    await adapter.continueConversation(
      agentAppId,
      toConversationReference(target.reference),
      async (context: TurnContext): Promise<void> => {
        if (event.type === "resolved") {
          await context.sendActivity(MessageFactory.text(resolvedText(event)));
          return;
        }
        const { lead, trail } = appearedLead(event);
        const mentioned = buildMentionedText(target.mention ?? null, lead, trail);
        const activity = MessageFactory.attachment(renderCard(event));
        // Both halves on the SAME activity. A card with no text notifies
        // nobody; text with no entity renders `<at>…</at>` literally.
        activity.text = mentioned.text;
        if (mentioned.entities.length > 0) {
          activity.entities = mentioned.entities as unknown as Entity[];
        }
        await context.sendActivity(activity);
      },
    );
  };
}
