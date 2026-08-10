/**
 * A watch event → the card that interrupts someone.
 *
 * `send-via-adapter.ts` takes this injected with NO default, and its docblock
 * says why: *"a proactive approval card and a tab-delivered approval card must
 * be the same card, or the user learns two vocabularies for one decision"*. So
 * this file does not author a card. It maps an event onto the cards the read
 * surface already owns.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 INTERVIEWS ARE NOT WIRED, AND SENDING ONE WOULD BE WORSE THAN SILENCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `bridge watch` really does emit `interview.requested` — the tracker has a
 * full branch for it — so this is a live case, not a hypothetical.
 *
 * But `InterviewAppeared` carries no `questions`, and `PendingInterview.questions`
 * is required, so the only value this could pass is `null`. `null` is the
 * branch `buildInterviewCard` renders as:
 *
 *   "This one can't be answered from here — its questions didn't reach the
 *    bot. Answer it on the desktop."
 *
 * Which is TRUE about the card's own state and WRONG as advice here: the
 * interview is perfectly answerable in Teams the moment the user opens the
 * chat. `null` is carrying two meanings with opposite correct advice — "the
 * bridge could not find the block" and "this transport does not carry
 * questions" — and the card cannot tell them apart.
 *
 * That is the `active: false → "Idle"` shape again: a value true about a
 * neighbouring subject, rendered in the slot a reader parses as instruction.
 * Sending the right card with the wrong instruction is worse than sending
 * nothing, because it reads as authoritative.
 *
 * So this THROWS, loudly, into the journal — and `pushWatchEvent` does not
 * record it as sent, so the notification arrives once the pointer card lands
 * rather than being lost. Replace this branch with
 * `buildInterviewWaitingCard`, agreed with the card surface on 2026-08-10.
 */
import type { Attachment } from "@microsoft/agents-activity";
import { buildApprovalCard } from "../read-surface/cards";
import type { AppearedEvent } from "./watch-line";

export class InterviewNotificationUnsupported extends Error {
  constructor(eventId: string) {
    super(
      `no proactive card exists for an interview yet (${eventId}) — buildInterviewCard would tell the user to go to a desktop, which is wrong here`,
    );
    this.name = "InterviewNotificationUnsupported";
  }
}

/**
 * `now` is SEND TIME, and that is the correct reading.
 *
 * `buildApprovalCard` renders "Requested Ns ago" from `now - requestedAt`. On
 * a proactive send the two are genuinely minutes apart — the watcher polls —
 * so passing the event's own timestamp would render "0s ago" for something
 * that has been waiting since the last tick.
 */
export function proactiveCardFor(
  event: AppearedEvent,
  now: number,
): Attachment {
  if (event.kind === "interview.requested") {
    throw new InterviewNotificationUnsupported(event.eventId);
  }
  return buildApprovalCard(
    { chatId: event.chatId, title: event.chatTitle },
    event.epicId,
    {
      approvalId: event.approvalId,
      toolName: event.toolName,
      description: event.description,
      requestedAt: event.requestedAt,
    },
    now,
  );
}
