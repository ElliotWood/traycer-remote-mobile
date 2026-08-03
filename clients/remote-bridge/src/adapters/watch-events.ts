/**
 * What `bridge watch` puts on stdout — a DIFF, not a dump.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS REPLACES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `watch` polled every tracked agent's status every four seconds and printed
 * every pending approval it found, on every tick. A consumer reading that
 * stream cannot distinguish *"a human has just become blocked"* from *"the
 * same human is still blocked"* — the two are byte-identical lines.
 *
 * For a proactive/notification consumer that is not a cosmetic difference. One
 * unanswered approval is fifteen identical lines a minute, for as long as it
 * stays unanswered. **The failure mode is not a duplicate card; it is a user
 * who turns the bot off.**
 *
 * So this module answers the one question the raw poll cannot: WHAT CHANGED.
 * It is pure — no bridge, no network, no clock — because "is this new?" is a
 * question about two consecutive observations and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE BRIDGE AND NOT THE CONSUMER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The bridge is the long-running process that actually sees the poll
 * sequence. A consumer that de-duplicates instead must hold the same state
 * AND still cannot see a resolution — because a resolved approval does not
 * announce itself, it simply stops appearing. `resolved` is not derivable
 * downstream from a stream that only ever says what is pending.
 *
 * **This does NOT replace a consumer's own idempotency.** The tracker's
 * memory is process-lifetime: a bridge restart re-announces every open
 * approval, correctly, because it cannot know what a consumer already did
 * with them. Both halves are needed and they answer different questions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GUARD THAT MATTERS MOST: `connected`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * {@link ChatStatus.connected} is `false` when the bridge's `chat.subscribe`
 * session for that chat is not genuinely open, and its own docblock says the
 * pending lists then reflect *"the last frame the bridge actually saw before
 * the connection went away"*.
 *
 * A dropped subscription therefore looks exactly like *"every approval on
 * that chat was just answered"*. Diffing against it would emit `resolved` for
 * approvals that are still pending — telling a notification consumer to
 * retract a card for a decision nobody has made. **A disconnected chat is
 * unknown, not empty**, so it contributes neither `appeared` nor `resolved`
 * and its open events stay open.
 *
 * The same reasoning covers a chat whose status call simply failed this tick:
 * absence from the observation set is not evidence of resolution.
 */
import type { ChatStatus } from "../action-surface";

/**
 * The two kinds that actually WAIT on a person, named exactly as the host's
 * notification feed names them (`approval.requested` / `interview.requested`).
 *
 * Deliberately the host's vocabulary rather than a bridge-local one: a
 * consumer that also reads the host feed — directly or through another
 * client — must not have to learn two names for one event, and a shared name
 * is what makes the two answers comparable at all.
 */
export type WatchEventKind = "approval.requested" | "interview.requested";

interface WatchEventCommon {
  /** Stable across ticks and across restarts — see {@link approvalEventId}. */
  readonly eventId: string;
  readonly kind: WatchEventKind;
  readonly epicId: string;
  readonly chatId: string;
}

/** One line of `bridge watch`'s stdout. */
export type WatchEvent =
  | (WatchEventCommon & {
      readonly type: "appeared";
      readonly kind: "approval.requested";
      readonly chatTitle: string | null;
      readonly approvalId: string;
      readonly toolName: string;
      readonly description: string;
      readonly requestedAt: number;
    })
  | (WatchEventCommon & {
      readonly type: "appeared";
      readonly kind: "interview.requested";
      readonly chatTitle: string | null;
      readonly blockId: string;
      readonly title: string | null;
      readonly description: string | null;
      readonly requestedAt: number;
    })
  | (WatchEventCommon & { readonly type: "resolved" });

/**
 * Derived, never minted.
 *
 * The id has to survive a bridge restart, so a counter or a UUID would be
 * wrong: the same still-pending approval must carry the same id after a
 * restart as before it, or a consumer's own de-duplication set is useless
 * across exactly the event that most needs it.
 *
 * `approvalId` is unique per approval rather than per chat, so a re-raised
 * approval is genuinely a new event and correctly announces again.
 */
export function approvalEventId(chatId: string, approvalId: string): string {
  return `approval.requested:${chatId}:${approvalId}`;
}

/** The interview counterpart of {@link approvalEventId}, keyed on block id. */
export function interviewEventId(chatId: string, blockId: string): string {
  return `interview.requested:${chatId}:${blockId}`;
}

/**
 * Turns consecutive observations of chat status into an event stream.
 *
 * Stateful by necessity and pure by construction: {@link diff} is the only
 * method, it takes what was observed and returns what changed, and it touches
 * nothing outside this object.
 */
export class WatchEventTracker {
  private readonly open = new Map<
    string,
    { readonly kind: WatchEventKind; readonly chatId: string }
  >();

  /**
   * @param observed Every chat whose status was successfully read THIS tick.
   *   A chat that failed to read must be omitted rather than passed as an
   *   empty status — see this file's header on why absence is not resolution.
   */
  diff(epicId: string, observed: readonly ChatStatus[]): readonly WatchEvent[] {
    const events: WatchEvent[] = [];
    const pendingNow = new Set<string>();
    const usableChats = new Set<string>();

    for (const status of observed) {
      // Unknown, not empty. See the header.
      if (!status.connected) continue;
      usableChats.add(status.chatId);

      for (const approval of status.pendingApprovals) {
        const eventId = approvalEventId(status.chatId, approval.approvalId);
        pendingNow.add(eventId);
        if (this.open.has(eventId)) continue;
        this.open.set(eventId, {
          kind: "approval.requested",
          chatId: status.chatId,
        });
        events.push({
          type: "appeared",
          eventId,
          kind: "approval.requested",
          epicId,
          chatId: status.chatId,
          chatTitle: status.title,
          approvalId: approval.approvalId,
          toolName: approval.toolName,
          description: approval.description,
          requestedAt: approval.requestedAt,
        });
      }

      for (const interview of status.pendingInterviews) {
        const eventId = interviewEventId(status.chatId, interview.blockId);
        pendingNow.add(eventId);
        if (this.open.has(eventId)) continue;
        this.open.set(eventId, {
          kind: "interview.requested",
          chatId: status.chatId,
        });
        events.push({
          type: "appeared",
          eventId,
          kind: "interview.requested",
          epicId,
          chatId: status.chatId,
          chatTitle: status.title,
          blockId: interview.blockId,
          title: interview.title,
          description: interview.description,
          requestedAt: interview.requestedAt,
        });
      }
    }

    for (const [eventId, record] of this.open) {
      if (pendingNow.has(eventId)) continue;
      // Only a chat we actually READ, and whose subscription was live, can
      // testify that something is gone.
      if (!usableChats.has(record.chatId)) continue;
      this.open.delete(eventId);
      events.push({
        type: "resolved",
        eventId,
        kind: record.kind,
        epicId,
        chatId: record.chatId,
      });
    }

    return events;
  }
}
