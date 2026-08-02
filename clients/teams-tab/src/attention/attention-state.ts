/**
 * "Waiting on you", projected from the app-level feed.
 *
 * WAS `use-attention.ts`, a hook that opened its own
 * `host.notifications.feed.subscribe`. The subscription moved to
 * `notifications/use-notifications.ts` when the bell arrived — see that file
 * for why one stream serves both surfaces rather than two.
 *
 * What is left is a PURE FUNCTION, and that is the useful part of the change:
 * the waiting screen's contents are now a projection of feed state that can be
 * tested by calling it, with no stream, no fake session and no React.
 *
 * The row projection itself still lives in
 * `@traycer-clients/shared/epic/attention` — `toAttentionItems` is where the
 * blocking-kinds rule and the oldest-first sort are argued. This file only
 * maps one state union onto another.
 */
import {
  toAttentionItems,
  type AttentionItem,
} from "@traycer-clients/shared/epic/attention";
import type { HostNotificationsSummary } from "@traycer/protocol/host/notifications/host-notifications";
import type { NotificationsState } from "../notifications/use-notifications";

export type AttentionState =
  /** Subscribed, no snapshot yet. NOT "nothing is waiting". */
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly items: readonly AttentionItem[];
      /** From the host's own `summary`, never derived here. */
      readonly summary: HostNotificationsSummary | null;
      /** `epicId` → title, filled in as the join resolves. May be empty. */
      readonly epicTitles: Readonly<Record<string, string>>;
    }
  | { readonly kind: "error"; readonly detail: string };

/**
 * Narrows the whole feed to the rows that are waiting on a person.
 *
 * `loading` and `error` pass through unchanged rather than being flattened to
 * an empty list: "we have not been told yet" and "nothing is waiting" are
 * different facts, and this is the surface where conflating them renders a
 * confident "you're all caught up" over an unanswered approval.
 */
export function toAttentionState(state: NotificationsState): AttentionState {
  if (state.kind !== "ready") return state;
  return {
    kind: "ready",
    items: toAttentionItems(state.entries),
    summary: state.summary,
    epicTitles: state.epicTitles,
  };
}
