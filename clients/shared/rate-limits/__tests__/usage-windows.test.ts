/**
 * The arm normalisation had NO test of any kind before this file, in either
 * client that shipped it. `clients/mobile/src/views/toolbar/__tests__/usage-sheet.test.tsx`
 * — the only suite that touched it — covers profile election and anchoring
 * exclusively (M2 items 1 and 4) and asserts on which PROFILES are read, never
 * on which windows come back for a given arm. So every branch below could have
 * returned the wrong window, or none, against a green suite.
 *
 * Every fixture is built by PARSING through `providerRateLimitsSchema` rather
 * than as an object literal. Two concrete reasons, the second learned in this
 * epic: the grok arm carries a `superRefine` tying `period.resetsAt` to
 * `periodEnd`, so a hand-written literal can express a snapshot the host is
 * structurally incapable of sending; and a cast that omits a required field
 * takes the wrong branch at runtime and "passes before the fix", which is how a
 * defect hides behind a green test rather than being caught by one.
 *
 * The `null`-vs-`[]` distinction is the one worth most of this file. They are
 * different answers — "this provider has no window concept" against "this
 * provider has windows and none are live" — and every caller renders them
 * differently. A test that accepted either would let the two collapse.
 */
import { describe, expect, it } from "vitest";
import {
  providerRateLimitsSchema,
  type ProviderRateLimits,
} from "@traycer/protocol/host/rate-limit";
import {
  extractUsageWindows,
  formatResetLine,
  windowLabel,
} from "../usage-windows";

function rateLimits(value: Record<string, unknown>): ProviderRateLimits {
  return providerRateLimitsSchema.parse(value);
}

function window(
  usedPercent: number,
  durationMinutes: number | null,
  resetsAt: number | null,
): Record<string, unknown> {
  return { usedPercent, durationMinutes, resetsAt };
}

function codex(overrides: Record<string, unknown>): ProviderRateLimits {
  return rateLimits({
    provider: "codex",
    available: true,
    planType: null,
    limitId: null,
    limitName: null,
    primary: null,
    secondary: null,
    extraWindows: [],
    credits: null,
    individualLimit: null,
    resetCredits: null,
    rateLimitReachedType: null,
    ...overrides,
  });
}

function claudeCode(overrides: Record<string, unknown>): ProviderRateLimits {
  return rateLimits({
    provider: "claude-code",
    available: true,
    subscriptionType: null,
    fiveHour: null,
    sevenDay: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    ...overrides,
  });
}

describe("windowLabel", () => {
  it("names the two windows desktop names in words", () => {
    expect(windowLabel(300)).toBe("Current session");
    expect(windowLabel(10080)).toBe("Weekly");
  });

  it("falls back to a generic label rather than computing a confident wrong one", () => {
    // 4320 minutes is three days. The failure this pins is a label that reads
    // "Weekly" about a window that is not a week — worse than a generic true
    // one, because a user cannot tell it is wrong.
    expect(windowLabel(4320)).toBe("Usage window");
    expect(windowLabel(299)).toBe("Usage window");
    expect(windowLabel(null)).toBe("Usage window");
  });
});

describe("extractUsageWindows — the null/empty distinction", () => {
  it("returns null for a provider with NO window concept, not an empty list", () => {
    // openrouter and kilocode report credit balances. `null` routes the caller
    // to its balance-only fallback; `[]` would tell the user their windows had
    // emptied, which is a different and false claim.
    const openrouter = rateLimits({
      provider: "openrouter",
      available: true,
      limit: 100,
      limitRemaining: 40,
      dailySpend: null,
      weeklySpend: null,
      monthlySpend: null,
      totalCredits: null,
      totalUsage: null,
      balance: null,
    });
    const kilocode = rateLimits({
      provider: "kilocode",
      available: true,
      creditBalance: 12,
      passState: null,
    });

    expect(extractUsageWindows(openrouter)).toBeNull();
    expect(extractUsageWindows(kilocode)).toBeNull();
  });

  it("returns an EMPTY list for an arm that has windows but reports none live", () => {
    // Paired with the case above deliberately: `toEqual([])` and `toBeNull()`
    // are the two halves of one claim, and either alone would pass on a
    // function that had collapsed them.
    expect(extractUsageWindows(codex({}))).toEqual([]);
    expect(extractUsageWindows(claudeCode({}))).toEqual([]);
  });

  it("returns null for an unavailable snapshot regardless of provider", () => {
    const unavailable = rateLimits({
      provider: "codex",
      available: false,
      reason: "cli_not_found",
    });
    expect(extractUsageWindows(unavailable)).toBeNull();
  });
});

describe("extractUsageWindows — codex", () => {
  it("labels primary and secondary from their own durations", () => {
    const result = extractUsageWindows(
      codex({ primary: window(10, 300, null), secondary: window(20, 10080, null) }),
    );
    expect(result).toEqual([
      { label: "Current session", window: { usedPercent: 10, durationMinutes: 300, resetsAt: null } },
      { label: "Weekly", window: { usedPercent: 20, durationMinutes: 10080, resetsAt: null } },
    ]);
  });

  it("skips a null primary without shifting the secondary into its place", () => {
    const result = extractUsageWindows(codex({ secondary: window(20, 10080, null) }));
    expect(result).toEqual([
      { label: "Weekly", window: { usedPercent: 20, durationMinutes: 10080, resetsAt: null } },
    ]);
  });

  it("prefers an extra window's own NAME over the duration-derived label", () => {
    // The one place a provider gets to name its own window. A regression here
    // renders "Usage window" over a limit the provider called something
    // specific, which reads as missing data rather than a lost label.
    const result = extractUsageWindows(
      codex({
        extraWindows: [
          { limitId: "l1", limitName: "Code review", primary: window(30, 60, null), secondary: null },
        ],
      }),
    );
    expect(result).toEqual([
      { label: "Code review", window: { usedPercent: 30, durationMinutes: 60, resetsAt: null } },
    ]);
  });

  it("falls back to the duration label when an extra window is unnamed", () => {
    const result = extractUsageWindows(
      codex({
        extraWindows: [
          { limitId: "l1", limitName: null, primary: window(30, 300, null), secondary: null },
        ],
      }),
    );
    expect(result).toEqual([
      { label: "Current session", window: { usedPercent: 30, durationMinutes: 300, resetsAt: null } },
    ]);
  });

  it("drops an extra window with no primary rather than emitting a labelled hole", () => {
    const result = extractUsageWindows(
      codex({
        extraWindows: [
          { limitId: "l1", limitName: "Code review", primary: null, secondary: window(5, 60, null) },
        ],
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("extractUsageWindows — claude-code", () => {
  it("emits all four named windows in order, then the model-scoped ones", () => {
    // Whole-list assertion, not four presence checks: ORDER is what the sheet
    // renders, and a per-field check cannot see a reordering.
    const result = extractUsageWindows(
      claudeCode({
        fiveHour: window(11, 300, null),
        sevenDay: window(22, 10080, null),
        sevenDayOpus: window(33, 10080, null),
        sevenDaySonnet: window(44, 10080, null),
        modelScoped: [{ displayName: "Haiku", usedPercent: 55, durationMinutes: 10080, resetsAt: null }],
      }),
    );
    expect(result).toEqual([
      { label: "Current session", window: { usedPercent: 11, durationMinutes: 300, resetsAt: null } },
      { label: "Weekly", window: { usedPercent: 22, durationMinutes: 10080, resetsAt: null } },
      {
        label: "Opus (weekly)",
        window: { usedPercent: 33, durationMinutes: 10080, resetsAt: null },
      },
      {
        label: "Sonnet (weekly)",
        window: { usedPercent: 44, durationMinutes: 10080, resetsAt: null },
      },
      {
        label: "Haiku",
        window: { displayName: "Haiku", usedPercent: 55, durationMinutes: 10080, resetsAt: null },
      },
    ]);
  });

  it("names the per-model windows explicitly rather than by duration", () => {
    // Opus and Sonnet both carry a 10080 duration, so a duration-derived label
    // would render "Weekly" three times with no way to tell which account-wide
    // limit is which.
    const result = extractUsageWindows(
      claudeCode({ sevenDayOpus: window(33, 10080, null), sevenDaySonnet: window(44, 10080, null) }),
    );
    expect(result?.map((row) => row.label)).toEqual([
      "Opus (weekly)",
      "Sonnet (weekly)",
    ]);
  });
});

describe("extractUsageWindows — grok", () => {
  function grok(overrides: Record<string, unknown>): ProviderRateLimits {
    return rateLimits({
      provider: "grok",
      available: true,
      subscriptionTier: null,
      periodType: null,
      periodStart: null,
      periodEnd: null,
      period: null,
      monthlyLimit: null,
      onDemandCap: null,
      onDemandUsed: null,
      prepaidBalance: null,
      ...overrides,
    });
  }

  it("emits its single synthesized billing-period window", () => {
    // `periodEnd` must equal `period.resetsAt` — the arm's own superRefine
    // enforces it, so this fixture could not be written any other way.
    const result = extractUsageWindows(
      grok({ period: window(60, 10080, 1_700_000_000_000), periodEnd: 1_700_000_000_000 }),
    );
    expect(result).toEqual([
      {
        label: "Weekly",
        window: { usedPercent: 60, durationMinutes: 10080, resetsAt: 1_700_000_000_000 },
      },
    ]);
  });

  it("returns an empty list — NOT null — for a zero-usage snapshot with no period", () => {
    // The distinction this file exists for, on the arm where it is easiest to
    // get wrong: grok reports tier and dates with no usage to meter. That is an
    // arm WITH a window concept reporting none, so `[]`, not the `null` that
    // means "credits provider".
    expect(extractUsageWindows(grok({ subscriptionTier: "premium" }))).toEqual([]);
  });
});

describe("formatResetLine", () => {
  const now = 1_700_000_000_000;

  it("returns an empty string when there is no reset instant to report", () => {
    expect(formatResetLine(null, now)).toBe("");
  });

  it("says 'soon' rather than a negative duration for an elapsed window", () => {
    expect(formatResetLine(now - 60_000, now)).toBe("Resets soon");
    // The boundary itself: exactly now is elapsed, not "in 0m".
    expect(formatResetLine(now, now)).toBe("Resets soon");
  });

  it("reports minutes below the 3-hour threshold and hours at it", () => {
    // Both sides of the only boundary in the function that can silently
    // degrade: 179m stays minutes, 180m becomes hours. A one-sided test passes
    // with the comparison inverted.
    expect(formatResetLine(now + 179 * 60_000, now)).toBe("Resets in 179m");
    expect(formatResetLine(now + 180 * 60_000, now)).toBe("Resets in 3h");
  });

  it("reports hours below the 48-hour threshold and a date at it", () => {
    expect(formatResetLine(now + 47 * 3_600_000, now)).toBe("Resets in 47h");
    const distant = formatResetLine(now + 48 * 3_600_000, now);
    expect(distant.startsWith("Resets in")).toBe(false);
    expect(distant.startsWith("Resets ")).toBe(true);
  });
});
