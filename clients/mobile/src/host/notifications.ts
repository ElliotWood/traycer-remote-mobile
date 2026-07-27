/**
 * Sprint 5 (C): permission + delivery for the foreground "chat became blocked"
 * alert, plus the pure transition-detector both `EpicView` and `ChatView` feed.
 *
 * Delivery always routes through `navigator.serviceWorker.ready.then(reg =>
 * reg.showNotification(...))`, never the bare `new Notification(...)`
 * constructor — Chrome on Android throws on the bare constructor, and this is
 * a mobile client. Permission is only ever requested from an explicit user
 * tap (see the "Enable alerts" affordance in the views) — this module never
 * calls `requestPermission()` on its own initiative.
 */

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

/** `"unsupported"` when the `Notification` API doesn't exist in this runtime. */
export function getNotificationPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Requests permission. Callers gate this behind an explicit tap — never call
 * it eagerly/on load (browsers throttle or silently ignore permission prompts
 * not tied to a user gesture, and an unprompted popup reads as spam).
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export interface BlockedNotificationPayload {
  readonly epicId: string;
  readonly chatId: string;
  readonly chatTitle: string;
}

/**
 * Fires the foreground alert via the registered service worker. A no-op
 * (never throws past the caller) when permission isn't granted, the SW API is
 * unavailable, or `serviceWorker.ready` rejects — a missed alert is an
 * acceptable degradation, a crash is not. `tag` scopes duplicate notifications
 * for the SAME chat to replace rather than stack; it is not what makes the
 * alert "exactly once" (that's `detectBlockedTransitions`'s job).
 */
export async function notifyBlocked(payload: BlockedNotificationPayload): Promise<void> {
  if (getNotificationPermission() !== "granted") {
    return;
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const title = payload.chatTitle.trim().length > 0 ? payload.chatTitle : "A chat";
    await registration.showNotification(title, {
      body: "Waiting on you",
      tag: `blocked:${payload.epicId}:${payload.chatId}`,
      data: { epicId: payload.epicId, chatId: payload.chatId },
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}

/** The minimum shape `detectBlockedTransitions` needs from a badge/chat state. */
export interface BlockedState {
  readonly blocked: boolean;
}

/**
 * Pure edge-triggered detector shared by `EpicView` (fed a real multi-chat
 * badge map) and `ChatView` (fed a synthetic single-entry map, gated on
 * `hasSnapshot` so it degrades to the exact same "absent = never observed"
 * semantics — see `use-chat.ts`'s `hasSnapshot` doc comment).
 *
 * Returns ids that flipped `blocked: false → true` between `prev` and `next`:
 *   - absent from `prev` (never observed before) → NEVER fires, even if
 *     already `blocked` in `next` — this is what stops an already-blocked
 *     chat from notifying the instant you open/switch into it.
 *   - present in `prev` with `blocked: false`, now `true` in `next` → fires.
 *   - present in `prev` with `blocked: true`, still `true` in `next` → does
 *     NOT re-fire (staying blocked is not a new transition).
 *   - a later `false → true` after an intervening `true → false` fires again
 *     (a genuine new transition) — callers must feed each successive `next`
 *     back in as the following call's `prev` for this to hold.
 */
export function detectBlockedTransitions<T extends BlockedState>(
  prev: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>,
): readonly string[] {
  const fired: string[] = [];
  for (const [id, state] of Object.entries(next)) {
    if (!state.blocked) {
      continue;
    }
    const prior = prev[id];
    if (prior === undefined) {
      continue;
    }
    if (!prior.blocked) {
      fired.push(id);
    }
  }
  return fired;
}
