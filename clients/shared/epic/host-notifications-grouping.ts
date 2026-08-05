/**
 * How a notification list is SPLIT — attention vs recent, and recent by day.
 *
 * EXTRACTED from `clients/mobile/src/views/toolbar/notifications-screen.tsx`
 * and `clients/mobile/src/host/use-host-notifications.ts` when the Teams tab
 * built the same screen. Moved rather than copied: these three rules decide
 * which section a row lands in, and two clients quietly disagreeing about that
 * is a difference nobody would see until a blocked agent sat in "Earlier".
 *
 * EVERY FUNCTION TAKES `now`. Mobile's originals called `new Date()` and
 * `Date.now()` inline, which is how a test ends up reading the wall clock
 * without anyone having chosen that — and on this module it is worse than
 * usual, because the whole output is *relative to* now. A fixture dated
 * "yesterday" silently becomes "today" when the suite runs after midnight.
 */
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";

/**
 * Unread AND either blocking (`needs_action`) or a failure.
 *
 * This is the "Needs attention" section, and it is deliberately NOT filtered
 * out by the unread-only toggle — the toggle narrows recent activity, and a
 * section whose definition already includes "unread" cannot be narrowed by it.
 */
export function isAttentionEntry(entry: HostNotificationEntry): boolean {
  return (
    entry.readAt === null &&
    (entry.severity === "needs_action" || entry.severity === "failure")
  );
}

export type DayBucket = "today" | "yesterday" | "earlier";

/**
 * Which day-group a row belongs to, by CALENDAR day rather than by elapsed
 * hours.
 *
 * The distinction matters and the naive version gets it wrong: something from
 * 23:50 last night is 40 minutes old at 00:30 and still belongs under
 * "Yesterday". Comparing midnights rather than subtracting durations is what
 * makes the label match what the user would call it.
 */
export function dayBucket(updatedAt: number, now: number): DayBucket {
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(new Date(now)) - startOfDay(new Date(updatedAt))) /
      (24 * 60 * 60 * 1000),
  );
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "earlier";
}

/**
 * A short age label: `just now` · `5m` · `3h` · `2d`.
 *
 * Clamped at zero, because a row whose `updatedAt` is slightly ahead of our
 * clock (different machine, no sync) would otherwise render a negative age.
 */
export function formatNotificationAge(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/** The recent rows, grouped. Attention rows are the caller's to remove first. */
export interface DayGroups {
  readonly today: readonly HostNotificationEntry[];
  readonly yesterday: readonly HostNotificationEntry[];
  readonly earlier: readonly HostNotificationEntry[];
}

export function groupByDay(
  entries: readonly HostNotificationEntry[],
  now: number,
): DayGroups {
  const groups: Record<DayBucket, HostNotificationEntry[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const entry of entries) groups[dayBucket(entry.updatedAt, now)].push(entry);
  return groups;
}
