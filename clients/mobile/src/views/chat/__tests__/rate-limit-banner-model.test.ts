/**
 * M2 item 3 — the tri-state, tested on both axes.
 *
 * ## `unknown` is built through its PRODUCER, not cast into existence
 *
 * `rateLimitStatus` carries `.catch("unknown")`, so a row that OMITS the field
 * parses to `unknown`. That is route (4) of the four ways the state arises in
 * production (never read, gone stale, probe failed, host predates the field),
 * and constructing it that way exercises the parser rather than asserting a
 * shape the parser might never produce.
 *
 * Casting `{rateLimitStatus: "unknown"}` would look identical and prove
 * nothing about whether anything can emit it — the polite-fixture failure with
 * an extra step.
 *
 * The live host reports `unknown: 0` today, so this state has no live
 * specimen. It is NOT unreachable — see the ticket's enumeration.
 */
import { describe, expect, it } from "vitest";
import {
  providerProfileSchema,
  type ProviderProfile,
} from "@traycer/protocol/host/provider-schemas";
import {
  guiAgentModelOptionSchema,
  type GuiAgentModelOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import {
  deriveRateLimitBanner,
  isBetterSwitchTarget,
} from "@/views/chat/rate-limit-banner-model";

function profile(overrides: Record<string, unknown>): ProviderProfile {
  return providerProfileSchema.parse({
    profileId: "p-managed",
    kind: "managed",
    authType: "oauth",
    label: "Work account",
    auth: { status: "authenticated", label: null, badgeText: null, detail: null },
    identity: null,
    usageUpdatedAt: null,
    rateLimitStatus: "ok",
    rateLimitLimitedScopes: [],
    duplicateOfProfileId: null,
    ambientDriftNotice: null,
    accentColor: null,
    ...overrides,
  });
}

/**
 * A profile whose status is `unknown` BECAUSE THE FIELD IS ABSENT — the same
 * route an older host build takes. Never written as a literal.
 */
function unknownProfile(overrides: Record<string, unknown>): ProviderProfile {
  // Built from the RAW object, not via `profile()`: that helper supplies
  // `rateLimitStatus: "ok"` as a base default, and omitting the key from the
  // overrides does not remove it. The first version of this did exactly that
  // and produced a HEALTHY profile — the guard below is what caught it, and
  // without the guard this suite would have "tested unknown" against `ok` and
  // passed.
  const raw: Record<string, unknown> = {
    profileId: "p-managed",
    kind: "managed",
    authType: "oauth",
    label: "Work account",
    auth: { status: "authenticated", label: null, badgeText: null, detail: null },
    identity: null,
    usageUpdatedAt: null,
    rateLimitLimitedScopes: [],
    duplicateOfProfileId: null,
    ambientDriftNotice: null,
    accentColor: null,
    ...overrides,
  };
  delete raw.rateLimitStatus;
  const built = providerProfileSchema.parse(raw);
  // Guard the construction itself: if `.catch("unknown")` ever stops
  // producing this, the test must fail loudly rather than silently testing
  // a healthy profile.
  if (built.rateLimitStatus !== "unknown") {
    throw new Error(
      `expected an omitted rateLimitStatus to parse as "unknown", got "${built.rateLimitStatus}"`,
    );
  }
  return built;
}

const MODEL: GuiAgentModelOption = guiAgentModelOptionSchema.parse({
  harnessId: "claude",
  slug: "opus[1m]",
  label: "Opus 5 (1M context)",
  description: null,
  contextWindow: null,
  maxOutputTokens: null,
  defaultReasoningEffort: null,
  supportedReasoningEfforts: [],
  metadata: {},
});

describe("deriveRateLimitBanner — the empty scope array means HEALTHY", () => {
  it("says NOTHING for a profile with an empty scope list, even when the enum is limited", () => {
    // The ticket's "empty ⇒ profile-wide" reading would fire a banner here.
    // On the live host, two of three profiles carry exactly this shape.
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({ profileId: "p-a", rateLimitStatus: "hard_limit", rateLimitLimitedScopes: [] }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner).toBeNull();
  });

  it("says nothing for a healthy profile", () => {
    expect(
      deriveRateLimitBanner({
        profiles: [profile({ profileId: "p-a" })],
        currentProfileId: "p-a",
        model: MODEL,
      }),
    ).toBeNull();
  });
});

describe("deriveRateLimitBanner — profile-wide vs named families", () => {
  it("reports NO families for a scope whose family is null — the live codex shape", () => {
    // Captured from a real host: `[{family: null, severity: "hard_limit"}]`.
    // Profile-wide, and there is no family to name.
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "hard_limit",
          rateLimitLimitedScopes: [{ family: null, severity: "hard_limit" }],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner?.severity).toBe("hard_limit");
    expect(banner?.limitedFamilies).toEqual([]);
  });

  it("names the families when the host scopes the limit to one", () => {
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "hard_limit",
          rateLimitLimitedScopes: [{ family: "opus", severity: "hard_limit" }],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner?.limitedFamilies).toEqual(["opus"]);
  });

  /**
   * Every other fixture in this describe carries exactly ONE scope, and with
   * one scope both of the rules below are invisible: naming "the families of
   * the matching scopes" and naming "the families desktop would name" agree.
   * The claim is about SELECTING among scopes, so it needs at least two.
   *
   * Found by the Evaluator; the rules are desktop's
   * `limitedFamiliesForCopy` (`use-profile-rate-limit-switch-prompt.ts`).
   */
  it("names NO families when a family:null window gates everything alongside a named one", () => {
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "hard_limit",
          rateLimitLimitedScopes: [
            { family: "opus", severity: "hard_limit" },
            // A shared window: it gates EVERY model, so the limit is not
            // "for opus" — naming only opus tells the user it is narrower
            // than it is, on the surface whose whole job is the opposite.
            { family: null, severity: "hard_limit" },
          ],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner?.severity).toBe("hard_limit");
    expect(banner?.limitedFamilies).toEqual([]);
  });

  it("does not name a merely near-limit family on a hard-limit banner", () => {
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "hard_limit",
          rateLimitLimitedScopes: [
            // Both families match MODEL, so both reach the copy; only the
            // one AT the banner's severity may be named.
            { family: "opus", severity: "near_limit" },
            { family: "Opus 5", severity: "hard_limit" },
          ],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner?.severity).toBe("hard_limit");
    expect(banner?.limitedFamilies).toEqual(["Opus 5"]);
  });

  it("falls back to the profile-level status when per-scope data is absent", () => {
    const banner = deriveRateLimitBanner({
      profiles: [
        profile({ profileId: "p-a", rateLimitStatus: "near_limit", rateLimitLimitedScopes: null }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(banner?.severity).toBe("near_limit");
    expect(banner?.limitedFamilies).toEqual([]);
  });
});

describe("switch targets — unknown is incomparable, not a tier", () => {
  const LIMITED = profile({
    profileId: "p-limited",
    rateLimitStatus: "hard_limit",
    rateLimitLimitedScopes: [{ family: null, severity: "hard_limit" }],
  });

  it("NEVER offers an unknown profile as a destination", () => {
    // THE assertion. A never-read gauge is not evidence of health, and the
    // warning-side read would score it as healthy and offer it.
    const candidate = unknownProfile({ profileId: "p-unknown", rateLimitLimitedScopes: null });
    expect(isBetterSwitchTarget(candidate, "hard_limit", MODEL)).toBe(false);

    const banner = deriveRateLimitBanner({
      profiles: [LIMITED, candidate],
      currentProfileId: "p-limited",
      model: MODEL,
    });
    expect(banner?.switchTarget).toBeNull();
  });

  it("offers a known-healthy profile", () => {
    const healthy = profile({ profileId: "p-healthy", label: "Spare account" });
    const banner = deriveRateLimitBanner({
      profiles: [LIMITED, healthy],
      currentProfileId: "p-limited",
      model: MODEL,
    });
    expect(banner?.switchTarget).toEqual({ profileId: "p-healthy", label: "Spare account" });
  });

  it("offers near_limit as strictly better than hard_limit, but not the reverse", () => {
    const near = profile({
      profileId: "p-near",
      rateLimitStatus: "near_limit",
      rateLimitLimitedScopes: [{ family: null, severity: "near_limit" }],
    });
    expect(isBetterSwitchTarget(near, "hard_limit", MODEL)).toBe(true);
    expect(isBetterSwitchTarget(LIMITED, "near_limit", MODEL)).toBe(false);
  });

  it("maps an ambient destination to a NULL commit id, never the sentinel", () => {
    const ambient = profile({ profileId: "ambient", kind: "ambient", label: "Terminal account" });
    const banner = deriveRateLimitBanner({
      profiles: [LIMITED, ambient],
      currentProfileId: "p-limited",
      model: MODEL,
    });
    expect(banner?.switchTarget?.profileId).toBeNull();
    expect(banner?.switchTarget?.label).toBe("Terminal account");
  });

  it("reports the TERMINAL state when the limited profile is the only one", () => {
    // The live codex shape: one profile, hard-limited. "No other profile is
    // currently available" — and no switch action offered.
    const banner = deriveRateLimitBanner({
      profiles: [LIMITED],
      currentProfileId: "p-limited",
      model: MODEL,
    });
    expect(banner?.severity).toBe("hard_limit");
    expect(banner?.switchTarget).toBeNull();
  });
});

describe("episode key", () => {
  it("changes when severity escalates, so dismissing near_limit does not hide hard_limit", () => {
    const near = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "near_limit",
          rateLimitLimitedScopes: [{ family: null, severity: "near_limit" }],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    const hard = deriveRateLimitBanner({
      profiles: [
        profile({
          profileId: "p-a",
          rateLimitStatus: "hard_limit",
          rateLimitLimitedScopes: [{ family: null, severity: "hard_limit" }],
        }),
      ],
      currentProfileId: "p-a",
      model: MODEL,
    });
    expect(near?.episodeKey).not.toBe(hard?.episodeKey);
  });
});

describe("no current profile", () => {
  it("says nothing when the committed profile is not in the list", () => {
    expect(
      deriveRateLimitBanner({
        profiles: [profile({ profileId: "p-a" })],
        currentProfileId: "p-missing",
        model: MODEL,
      }),
    ).toBeNull();
  });
});
