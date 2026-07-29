import { formatHostNotificationPresentation } from "@traycer/protocol/host/notifications/presentation";
import type { ActionableTransition } from "./actionable-detector";
import type { PushPayload } from "./push-sender";

const MAX_SUMMARY_TITLES = 5;

/**
 * Builds the push payload for one coalesced batch. `formatHostNotificationPresentation`
 * is the only source of title/body — the same formatter the in-app feed uses,
 * so phone copy never drifts from desktop.
 *
 * - Exactly one transition → its normal presentation, deep-linking to the
 *   chat when the entry carries one.
 * - More than one → a single summary push with no deep-link target (there is
 *   no single chat to land on) — the cold-open path falls back to Fleet for
 *   this case, which is deliberate, not a dropped target.
 */
export function buildPushPayload(
  transitions: readonly ActionableTransition[],
): PushPayload {
  if (transitions.length === 1) {
    return buildSingleEntryPayload(transitions[0].entry);
  }
  const titles = transitions.map(
    (t) => formatHostNotificationPresentation(t.entry).title,
  );
  const uniqueTitles = Array.from(new Set(titles));
  const shown = uniqueTitles.slice(0, MAX_SUMMARY_TITLES);
  const body =
    uniqueTitles.length > MAX_SUMMARY_TITLES
      ? `${shown.join(", ")}, and ${uniqueTitles.length - MAX_SUMMARY_TITLES} more`
      : shown.join(", ");
  return {
    title: `${transitions.length} chats need your attention`,
    body,
    data: {},
  };
}

function buildSingleEntryPayload(
  entry: Parameters<typeof formatHostNotificationPresentation>[0],
): PushPayload {
  const presentation = formatHostNotificationPresentation(entry);
  if (entry.epicId !== null && entry.chatId !== null) {
    return {
      title: presentation.title,
      body: presentation.body,
      data: { epicId: entry.epicId, chatId: entry.chatId },
    };
  }
  return { title: presentation.title, body: presentation.body, data: {} };
}
