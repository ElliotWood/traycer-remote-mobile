import { describe, expect, it } from "vitest";
import {
  DEADLINE_TIME_ZONES,
  formatOffset,
  isKnownTimeZone,
  resolveDeadline,
  zoneOffsetMinutes,
} from "../deadline";

/** 2026-01-01, comfortably before every date used below. */
const NOW = Date.UTC(2026, 0, 1);

function ok(
  date: string,
  time: string,
  timeZone: string,
): { iso: string; offset: string } {
  const result = resolveDeadline({ date, time, timeZone, nowMs: NOW });
  if (result.kind !== "ok") {
    throw new Error(`expected ok, got ${result.field}: ${result.message}`);
  }
  return { iso: result.iso, offset: result.offset };
}

describe("deadline — the offset is derived, never assumed", () => {
  it("CONTRACT: every resolved deadline carries an explicit offset", () => {
    // `new-bid.mjs` refuses without one, and there is no branch here that can
    // return a timestamp lacking it. A bare `Z` would not satisfy the tool.
    for (const zone of DEADLINE_TIME_ZONES) {
      const { iso } = ok("2026-09-15", "17:00", zone.id);
      expect(iso, zone.id).toMatch(/[+-]\d{2}:\d{2}$/);
      expect(iso, zone.id).not.toMatch(/Z$/);
    }
  });

  it("Perth is +08:00 in both January and July — it has no DST", () => {
    expect(ok("2026-01-15", "17:00", "Australia/Perth").offset).toBe("+08:00");
    expect(ok("2026-07-15", "17:00", "Australia/Perth").offset).toBe("+08:00");
  });

  it("CONTRACT: Sydney's offset follows the DATE, which is the whole point", () => {
    // This is the case a fixed "+10:00 AEST" picker gets wrong, silently and
    // by an hour, on half the year's tenders. Nobody would notice until the
    // bid was late.
    expect(ok("2026-01-15", "17:00", "Australia/Sydney").offset).toBe("+11:00");
    expect(ok("2026-07-15", "17:00", "Australia/Sydney").offset).toBe("+10:00");
  });

  it("keeps a half-hour zone's half hour", () => {
    // Adelaide is +09:30/+10:30. An implementation that divided by 60 and
    // dropped the remainder would look right for every other zone offered.
    expect(ok("2026-07-15", "17:00", "Australia/Adelaide").offset).toBe(
      "+09:30",
    );
    expect(ok("2026-01-15", "17:00", "Australia/Adelaide").offset).toBe(
      "+10:30",
    );
  });

  it("UTC renders as +00:00, not as a bare GMT or Z", () => {
    expect(ok("2026-09-15", "17:00", "UTC").offset).toBe("+00:00");
  });

  it("the wall-clock time the user typed is the wall-clock time in the ISO string", () => {
    // The offset moves; the numbers the user chose do not. An implementation
    // that converted to UTC and rendered THAT would show 09:00 for a 17:00
    // Perth deadline — still correct as an instant, and unrecognisable to the
    // person who typed it and to anyone reading the bid.
    expect(ok("2026-09-15", "17:00", "Australia/Perth").iso).toBe(
      "2026-09-15T17:00:00+08:00",
    );
  });

  it("the resolved instant is the one the offset claims", () => {
    const result = resolveDeadline({
      date: "2026-09-15",
      time: "17:00",
      timeZone: "Australia/Perth",
      nowMs: NOW,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // 17:00+08:00 is 09:00Z. Asserted independently of the string, so a
    // formatter that printed a correct-looking offset next to the wrong
    // instant cannot pass.
    expect(result.instantMs).toBe(Date.UTC(2026, 8, 15, 9, 0, 0));
  });
});

describe("deadline — what it refuses", () => {
  it("refuses an unselected time zone rather than defaulting one", () => {
    const result = resolveDeadline({
      date: "2026-09-15",
      time: "17:00",
      timeZone: "",
      nowMs: NOW,
    });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("timeZone");
  });

  it("refuses a zone that is real but not offered", () => {
    // `Europe/Paris` is a zone `Intl` knows. Accepting it would mean the
    // picker's list was decoration, and a relayed card payload could name
    // anything.
    const result = resolveDeadline({
      date: "2026-09-15",
      time: "17:00",
      timeZone: "Europe/Paris",
      nowMs: NOW,
    });
    expect(result.kind).toBe("invalid");
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    // `Date.UTC(2026, 1, 31)` is happily 3 March. A deadline moved two days
    // by an arithmetic convenience is exactly the failure this field is about.
    const result = resolveDeadline({
      date: "2026-02-31",
      time: "17:00",
      timeZone: "Australia/Perth",
      nowMs: NOW,
    });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("date");
  });

  it("refuses a deadline that has already passed", () => {
    // The realistic failure is a mistyped year, which nothing downstream
    // would question.
    const result = resolveDeadline({
      date: "2025-09-15",
      time: "17:00",
      timeZone: "Australia/Perth",
      nowMs: NOW,
    });
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.message).toContain("already passed");
  });

  it("refuses malformed date and time strings", () => {
    for (const date of ["", "15/09/2026", "2026-9-15", "tomorrow"]) {
      expect(
        resolveDeadline({
          date,
          time: "17:00",
          timeZone: "UTC",
          nowMs: NOW,
        }).kind,
        date,
      ).toBe("invalid");
    }
    for (const time of ["", "5pm", "25:00", "17:99"]) {
      expect(
        resolveDeadline({
          date: "2026-09-15",
          time,
          timeZone: "UTC",
          nowMs: NOW,
        }).kind,
        time,
      ).toBe("invalid");
    }
  });
});

describe("deadline — the primitives", () => {
  it("zoneOffsetMinutes returns null for a zone the platform does not know", () => {
    // Null rather than 0. A zone we cannot resolve is not a zone at UTC, and
    // treating it as one is how a deadline silently shifts eight hours.
    expect(zoneOffsetMinutes("Mars/Olympus", Date.now())).toBeNull();
  });

  it("formatOffset pads and signs", () => {
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(480)).toBe("+08:00");
    expect(formatOffset(570)).toBe("+09:30");
    expect(formatOffset(-210)).toBe("-03:30");
  });

  it("isKnownTimeZone matches the offered list exactly", () => {
    for (const zone of DEADLINE_TIME_ZONES) {
      expect(isKnownTimeZone(zone.id)).toBe(true);
    }
    expect(isKnownTimeZone("Europe/Paris")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
  });
});
