/**
 * The three rules that decide which SECTION a notification lands in.
 *
 * These are worth pinning because getting one wrong is invisible: a blocked
 * agent quietly filed under "Earlier" still renders, still has the right copy,
 * and is simply never seen. Nothing throws and no count is obviously off.
 *
 * The day-bucket cases below are the ones that fail against the obvious
 * implementation (`elapsed / 86_400_000`), which is why they carry explicit
 * clock values rather than offsets from "now".
 */
import { describe, expect, it } from "vitest";
import {
  hostNotificationEntrySchema,
  type HostNotificationEntry,
} from "@traycer/protocol/host/notifications/host-notifications";
import {
  dayBucket,
  formatNotificationAge,
  groupByDay,
  isAttentionEntry,
} from "../host-notifications-grouping";

/**
 * Built through the schema, never cast. A cast omits whatever the protocol has
 * since added and produces a fixture that type-checks and lies.
 */
function entry(over: Record<string, unknown>): HostNotificationEntry {
  return hostNotificationEntrySchema.parse({
    id: "n1",
    kind: "approval.requested",
    outcome: null,
    resolvedAt: null,
    severity: "needs_action",
    updatedAt: 1_000,
    readAt: null,
    sourceRef: null,
    epicId: "e1",
    chatId: "c1",
    payload: {},
    ...over,
  });
}

describe("isAttentionEntry", () => {
  it("is true for an unread blocking row", () => {
    expect(
      isAttentionEntry(entry({ severity: "needs_action", readAt: null })),
    ).toBe(true);
  });

  it("is true for an unread failure", () => {
    expect(
      isAttentionEntry(
        entry({
          kind: "agent.stalled",
          outcome: "errored",
          severity: "failure",
          readAt: null,
        }),
      ),
    ).toBe(true);
  });

  /**
   * The half that makes the toggle coherent: "Needs attention" already means
   * unread, so a READ blocking row belongs in recent activity. Without this,
   * answering an approval elsewhere would leave it pinned at the top forever.
   */
  it("is false once the row has been read, even though it is blocking", () => {
    expect(
      isAttentionEntry(entry({ severity: "needs_action", readAt: 2_000 })),
    ).toBe(false);
  });

  it("is false for an unread informational row", () => {
    expect(isAttentionEntry(entry({ severity: "info", readAt: null }))).toBe(
      false,
    );
  });
});

describe("dayBucket", () => {
  /**
   * THE CASE THAT FAILS AGAINST ELAPSED TIME. 23:50 last night, read at 00:30
   * this morning, is FORTY MINUTES old — an elapsed-hours implementation calls
   * that "today" and the user calls it yesterday.
   */
  it("buckets by calendar day, not by elapsed hours", () => {
    const lastNight = new Date(2026, 7, 2, 23, 50).getTime();
    const justAfterMidnight = new Date(2026, 7, 3, 0, 30).getTime();
    expect(dayBucket(lastNight, justAfterMidnight)).toBe("yesterday");
  });

  /**
   * The mirror of it: 23 hours is nearly a day and is still TODAY when both
   * instants share a date. Together these two pin the rule from both sides, so
   * an implementation that merely shifted its threshold cannot satisfy both.
   */
  it("calls a 23-hour-old row from the same date today", () => {
    const earlyToday = new Date(2026, 7, 3, 0, 30).getTime();
    const lateToday = new Date(2026, 7, 3, 23, 30).getTime();
    expect(dayBucket(earlyToday, lateToday)).toBe("today");
  });

  it("calls anything two or more days back earlier", () => {
    const then = new Date(2026, 7, 1, 12, 0).getTime();
    const now = new Date(2026, 7, 3, 12, 0).getTime();
    expect(dayBucket(then, now)).toBe("earlier");
  });

  /** A row stamped slightly ahead of our clock is today, never "tomorrow". */
  it("treats a future timestamp as today", () => {
    const now = new Date(2026, 7, 3, 12, 0).getTime();
    expect(dayBucket(now + 60_000, now)).toBe("today");
  });
});

describe("formatNotificationAge", () => {
  it("reports minutes, hours and days", () => {
    const now = 10 * 86_400_000;
    expect(formatNotificationAge(now - 30_000, now)).toBe("just now");
    expect(formatNotificationAge(now - 5 * 60_000, now)).toBe("5m");
    expect(formatNotificationAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatNotificationAge(now - 2 * 86_400_000, now)).toBe("2d");
  });

  /** Clocks disagree across machines; a negative age must not render. */
  it("clamps a future timestamp rather than rendering a negative age", () => {
    expect(formatNotificationAge(5_000, 1_000)).toBe("just now");
  });
});

describe("groupByDay", () => {
  it("puts every entry in exactly one bucket", () => {
    const now = new Date(2026, 7, 3, 12, 0).getTime();
    const rows = [
      entry({ id: "a", updatedAt: new Date(2026, 7, 3, 9, 0).getTime() }),
      entry({ id: "b", updatedAt: new Date(2026, 7, 2, 9, 0).getTime() }),
      entry({ id: "c", updatedAt: new Date(2026, 6, 30, 9, 0).getTime() }),
    ];
    const groups = groupByDay(rows, now);
    expect(groups.today.map((e) => e.id)).toEqual(["a"]);
    expect(groups.yesterday.map((e) => e.id)).toEqual(["b"]);
    expect(groups.earlier.map((e) => e.id)).toEqual(["c"]);
    expect(
      groups.today.length + groups.yesterday.length + groups.earlier.length,
    ).toBe(rows.length);
  });
});
