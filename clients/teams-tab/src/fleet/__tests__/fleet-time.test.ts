import { describe, expect, it } from "vitest";
import { relativeTime, terseTime } from "../fleet-grid";

const NOW = 1_800_000_000_000;
const s = (n: number): number => NOW - n * 1000;

describe("fleet time — an absent timestamp", () => {
  it("CONTRACT: null renders as an em dash, never as 'now' or an epoch date", () => {
    // "Never seen" and "seen a moment ago" are opposite facts about a row,
    // and the fleet exists to tell them apart.
    expect(relativeTime(null, NOW)).toBe("—");
    expect(terseTime(null, NOW)).toBe("—");
  });
});

describe("fleet time — a timestamp ahead of the clock", () => {
  it("CONTRACT: a future timestamp clamps instead of counting backwards", () => {
    // Host and client clocks are not synchronised, and a few seconds of
    // skew is normal. "-3s ago" reads as a bug in the row rather than in
    // the clock.
    expect(relativeTime(NOW + 5_000, NOW)).toBe("0s ago");
    expect(terseTime(NOW + 5_000, NOW)).toBe("now");
    expect(relativeTime(NOW + 86_400_000, NOW)).toBe("0s ago");
    expect(terseTime(NOW + 86_400_000, NOW)).toBe("now");
  });

  it("never emits a minus sign", () => {
    for (const ahead of [1, 60, 3600, 86_400]) {
      expect(relativeTime(NOW + ahead * 1000, NOW)).not.toContain("-");
      expect(terseTime(NOW + ahead * 1000, NOW)).not.toContain("-");
    }
  });
});

describe("fleet time — the unit boundaries", () => {
  it("stays in seconds below a minute", () => {
    expect(relativeTime(s(0), NOW)).toBe("0s ago");
    expect(relativeTime(s(59), NOW)).toBe("59s ago");
  });

  it("crosses into minutes, hours and days at the right points", () => {
    expect(relativeTime(s(60), NOW)).toBe("1m ago");
    expect(relativeTime(s(60 * 60), NOW)).toBe("1h ago");
    expect(relativeTime(s(24 * 60 * 60), NOW)).toBe("1d ago");
    expect(relativeTime(s(3 * 24 * 60 * 60), NOW)).toBe("3d ago");
  });

  it("the terse form uses the same boundaries", () => {
    expect(terseTime(s(60), NOW)).toBe("1m");
    expect(terseTime(s(60 * 60), NOW)).toBe("1h");
    expect(terseTime(s(24 * 60 * 60), NOW)).toBe("1d");
    expect(terseTime(s(3 * 24 * 60 * 60), NOW)).toBe("3d");
  });

  it("CONTRACT: under a minute the terse form says 'now', not '0s'", () => {
    // A ticking seconds value on a list that is not live-updating would be
    // a precision the data does not have.
    expect(terseTime(s(0), NOW)).toBe("now");
    expect(terseTime(s(59), NOW)).toBe("now");
    expect(terseTime(s(0), NOW)).not.toContain("s");
  });
});

describe("fleet time — the terse form is genuinely shorter", () => {
  it("CONTRACT: never longer than the full form, at any age", () => {
    // It exists because a tree row spends its width on an indent, a guide
    // rail, an icon, a title and a chevron before the timestamp gets any.
    for (const age of [0, 5, 59, 60, 90, 3599, 3600, 86_399, 86_400, 900_000]) {
      expect(terseTime(s(age), NOW).length).toBeLessThanOrEqual(
        relativeTime(s(age), NOW).length,
      );
    }
  });

  it("the full form always says 'ago' and the terse form never does", () => {
    for (const age of [0, 60, 3600, 86_400]) {
      expect(relativeTime(s(age), NOW)).toContain("ago");
      expect(terseTime(s(age), NOW)).not.toContain("ago");
    }
  });
});
