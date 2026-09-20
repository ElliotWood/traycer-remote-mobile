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
import type {
  AppearedEvent,
  ResolvedEvent,
  RunFinished,
  WatchEvent,
} from "./watch-line";
import type { SendProactive } from "./push-notifications";
import type { ProactiveTarget } from "./proactive-store";
import { buildMentionedText, type MentionEntityOut } from "../teams/mention";

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
 * Our mention entity → the SDK's `Entity`.
 *
 * `Entity` types `type` as a plain string and carries arbitrary extra
 * properties, so this is a widening rather than a reinterpretation — the same
 * field-by-field discipline {@link toConversationReference} uses one function
 * up, and for the same reason: a cast would compile through a renamed field
 * and lose it silently, which is exactly what `bot` → `agent` did.
 */
function toActivityEntity(mention: MentionEntityOut): Entity {
  return {
    type: mention.type,
    text: mention.text,
    mentioned: { id: mention.mentioned.id, name: mention.mentioned.name },
  };
}

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
 * The completion reply — the thing `wpro-retail-run` is about.
 *
 * An assessment started from Teams ran for hours, produced a usable answer,
 * and told nobody; Elliot came and asked for it. Everything needed to say so
 * was already built — the conversation reference is captured at intake
 * before anything that can fail, and the send path below has been waiting
 * for an event. The missing piece was the bridge saying "it stopped".
 *
 * TAGGED, unlike `resolvedText`. That one is a courtesy withdrawal of a
 * demand; this is the answer somebody asked for, and it is the one message
 * in this file a person is actually waiting on. An untagged completion in a
 * channel arrives silently, which is the defect with an extra step.
 *
 * NO CARD, deliberately. `render-card.ts` maps events onto cards the read
 * surface already owns, and there is no "finished" card to own — inventing
 * one here is exactly the second vocabulary that file's header forbids. The
 * link is the whole payload, and it is the same `chatDeepLink` the intake
 * ack already sent, so the two agree by construction.
 *
 * `link` may be `null` — no tab URL is configured, which is the current
 * deployment. Then the message still goes: "it finished" with no link beats
 * silence, and beats a dead button.
 */
export function finishedLead(
  event: RunFinished,
  link: string | null,
): { readonly lead: string; readonly trail: string } {
  const what = event.chatTitle === null ? "your assessment" : event.chatTitle;
  return {
    lead: "",
    trail:
      link === null
        ? ` — ${what} has finished. Open it to read the result.`
        : ` — ${what} has finished. Read the result: ${link}`,
  };
}

/**
 * What the correction says when something stops waiting.
 *
 * Plain text, no card, no tag. The card above it cannot be refreshed —
 * `Action.Submit` has no in-place update — so this exists to stop a live
 * request for a decision that was already made elsewhere from being the last
 * thing on screen.
 */
export function resolvedText(event: ResolvedEvent): string {
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
  /**
   * The chat's deep link, or `null` when no tab URL is configured. Injected
   * rather than built here for the reason `deep-link.ts` states: the bot and
   * the tab are separately deployed and the link is configuration.
   */
  chatLink: (event: RunFinished) => string | null,
): SendProactive {
  return async (target: ProactiveTarget, event: WatchEvent): Promise<void> => {
    await adapter.continueConversation(
      agentAppId,
      toConversationReference(target.reference),
      async (context: TurnContext): Promise<void> => {
        if (event.type === "resolved") {
          await context.sendActivity(MessageFactory.text(resolvedText(event)));
          return;
        }
        if (event.type === "finished") {
          const { lead, trail } = finishedLead(event, chatLink(event));
          const mentioned = buildMentionedText(
            target.mention ?? null,
            lead,
            trail,
          );
          // Text only — see `finishedLead` on why there is no card. Same
          // two-halves-on-one-activity rule as the tagged branch below: a
          // mention entity without the matching `<at>` markup renders as
          // literal text and notifies nobody.
          const activity = MessageFactory.text(mentioned.text);
          if (mentioned.entities.length > 0) {
            activity.entities = mentioned.entities.map(toActivityEntity);
          }
          await context.sendActivity(activity);
          return;
        }
        const { lead, trail } = appearedLead(event);
        const mentioned = buildMentionedText(
          target.mention ?? null,
          lead,
          trail,
        );
        const activity = MessageFactory.attachment(renderCard(event));
        // Both halves on the SAME activity. A card with no text notifies
        // nobody; text with no entity renders `<at>…</at>` literally.
        activity.text = mentioned.text;
        if (mentioned.entities.length > 0) {
          activity.entities = mentioned.entities.map(toActivityEntity);
        }
        await context.sendActivity(activity);
      },
    );
  };
}
