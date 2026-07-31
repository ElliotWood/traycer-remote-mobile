/**
 * Whether this client may send owner frames for a given chat.
 *
 * THE QUESTION THE ACTION SURFACE TURNS ON. The tab holds one
 * `chat.subscribe` to ONE host. Owner frames go to the host you are connected
 * to. In the epic this was written against, 53 of 56 chats live somewhere
 * else — so "can I act on this" is the common case being NO, not an edge.
 *
 * WHY THIS IS DECIDED HERE AND NOT BY THE HOST. `ActionTracker` settles an
 * `accepted` ack as `applied`, reasoning that the decision "either just took
 * effect or already had". That holds for a chat the host owns. For a chat it
 * does not own, an ack — if one comes — would settle `applied` for an action
 * that reached nothing, and the snapshot reconcile would agree, because the
 * pending set for an unknown chat is trivially empty.
 *
 * Whether an unknown chat is rejected, ignored or acked is UNTESTED. A design
 * that needs that answer is a design that can be wrong about it, so this one
 * does not send the frame at all unless locality is positively established.
 *
 * Same discipline as the bot's composer gate: absence of a proven capability
 * is not a capability.
 *
 * TWO GATES, ANSWERING DIFFERENT QUESTIONS. Locality is only half of it:
 *
 *   canAct    am I PERMITTED, and is the stream live?   host-provided
 *   locality  will an owner frame REACH the agent?      client-derived
 *
 * Neither implies the other. `canAct` folds role and connection — a viewer
 * can never act, and a non-viewer with `canAct === false` means the stream is
 * not currently open. It is computed by the host that answered the
 * subscription, so it says nothing about a chat on a different host.
 *
 * Gating on locality ALONE would show approve and reject to a viewer, who is
 * not allowed to use them. Gating on `canAct` alone would show them for a
 * cross-host chat, where they reach nothing and report success twice over.
 * The first version of this module had only the second gate — the rule
 * "gate on the field that means what you need" applied once, to reachability,
 * while a second field meaning something else went unread.
 */
import {
  agentLocality,
  type EpicChatEntry,
} from "@traycer-clients/shared/epic/epic-doc-chats";

export type Actionability =
  /** Permitted, but the host says this stream cannot act right now. */
  | { readonly kind: "viewer" }
  | { readonly kind: "stream-not-live" }
  /** The chat is on this host. Owner frames are meaningful. */
  | { readonly kind: "actionable" }
  /** It runs elsewhere. We know that, and we say it. */
  | { readonly kind: "other-host" }
  /**
   * We cannot establish where it runs — unreplicated `hostId`, or a build
   * with no configured host id.
   *
   * Treated exactly like `other-host` for the purposes of ACTING, and worded
   * differently, because "runs elsewhere" and "we don't know" are different
   * facts and only one of them is something we observed.
   */
  | { readonly kind: "unknown" };

export function chatActionability(
  entry: EpicChatEntry,
  configuredHostId: string,
  access: { readonly canAct: boolean; readonly role: "owner" | "viewer" },
): Actionability {
  // PERMISSION FIRST. A viewer is not allowed to act regardless of where the
  // chat runs, and telling them "it runs on another machine" would explain
  // the wrong reason.
  if (access.role === "viewer") return { kind: "viewer" };
  if (!access.canAct) return { kind: "stream-not-live" };
  switch (agentLocality(entry, configuredHostId)) {
    case "this-host":
      return { kind: "actionable" };
    case "other-host":
      return { kind: "other-host" };
    case "unknown":
      return { kind: "unknown" };
  }
}

/**
 * Why the actions are absent, said BEFORE the user reaches for a button.
 *
 * Never "read-only" and never "unreachable": both are claims about the chat.
 * This is a statement about THIS CLIENT's position — which is all we know,
 * and it points at the thing that would actually work.
 */
export function actionabilityReason(state: Actionability): string | null {
  switch (state.kind) {
    case "actionable":
      return null;
    case "viewer":
      return "You have view-only access to this chat, so you can’t approve or reject here.";
    case "stream-not-live":
      return "Reconnecting to your host — approving is paused until the connection is back.";
    case "other-host":
      return "This agent runs on another machine, so it can’t be approved from here. Open it on that host, or from Traycer on your desktop.";
    case "unknown":
      return "We can’t tell which machine this agent runs on yet, so approving from here might not reach it. Try again in a moment.";
  }
}
