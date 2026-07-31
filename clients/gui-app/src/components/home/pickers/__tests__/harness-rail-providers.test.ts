import { describe, expect, it } from "vitest";
import type { HarnessOption } from "@/components/home/data/landing-options";
import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type { ProviderProfile } from "@traycer/protocol/host/provider-schemas";
import {
  railHarnessDegraded,
  resolveActiveProfileForHarness,
  visibleRailEntries,
} from "@/components/home/pickers/harness-rail-providers";
import { profileCommitId } from "@/components/providers/provider-profile-model";

const NO_ACTIVE_PROFILE_OVERRIDES = new Map<GuiHarnessId, string | null>();

function harness(id: "claude" | "codex"): HarnessOption {
  return {
    id,
    label: id === "claude" ? "Claude Code" : "Codex",
    enabled: true,
    available: true,
    error: null,
    modes: ["gui"],
    requiresApiKey: false,
    supportedPermissionModes: ["supervised", "full_access"],
    availabilityPending: false,
  };
}

function profile(
  profileId: string,
  kind: "ambient" | "managed",
  label: string,
): ProviderProfile {
  return {
    profileId,
    kind,
    authType: "oauth",
    label,
    auth: {
      status: "authenticated",
      badgeText: null,
      label: null,
      detail: null,
    },
    identity: null,
    usageUpdatedAt: null,
    rateLimitStatus: "unknown",
    rateLimitLimitedScopes: null,
    duplicateOfProfileId: null,
    ambientDriftNotice: null,
    accentColor: null,
  };
}

describe("visibleRailEntries", () => {
  it("renders exactly one entry per provider, regardless of profile count", () => {
    const entries = visibleRailEntries({
      harnesses: [harness("claude")],
      fallbackHarnesses: [],
      degradedHarnessIds: new Set(),
      profilesByHarnessId: new Map([
        [
          "claude",
          [
            profile("ambient", "ambient", "Claude Terminal account"),
            profile("work-uuid", "managed", "Work"),
          ],
        ],
      ]),
      activeProfileIdByHarnessId: NO_ACTIVE_PROFILE_OVERRIDES,
    });

    // The rail no longer splits by profile - one tab for Claude, full stop.
    // Profile switching lives in the picker's profile dropdown.
    expect(entries).toHaveLength(1);
    expect(entries[0].harness.id).toBe("claude");
  });

  it("renders no accent dot for a harness under 2 profiles - byte-identical to today", () => {
    const entries = visibleRailEntries({
      harnesses: [harness("codex")],
      fallbackHarnesses: [],
      degradedHarnessIds: new Set(),
      profilesByHarnessId: new Map([
        ["codex", [profile("ambient", "ambient", "Codex Terminal account")]],
      ]),
      activeProfileIdByHarnessId: NO_ACTIVE_PROFILE_OVERRIDES,
    });

    expect(entries).toEqual([
      {
        harness: harness("codex"),
        degraded: false,
        accentDot: null,
      },
    ]);
  });

  it("colors the accent dot from the resolved active profile for 2+ profiles", () => {
    const entries = visibleRailEntries({
      harnesses: [harness("claude")],
      fallbackHarnesses: [],
      degradedHarnessIds: new Set(),
      profilesByHarnessId: new Map([
        [
          "claude",
          [
            profile("ambient", "ambient", "Claude Terminal account"),
            profile("work-uuid", "managed", "Work"),
          ],
        ],
      ]),
      activeProfileIdByHarnessId: new Map<GuiHarnessId, string | null>([
        ["claude", "work-uuid"],
      ]),
    });

    expect(entries[0].accentDot).toEqual({
      profileId: "work-uuid",
      accentColor: null,
      label: "Work",
    });
  });

  it("falls back to the harness's first selectable profile (ambient) when no active profile is supplied", () => {
    const entries = visibleRailEntries({
      harnesses: [harness("claude")],
      fallbackHarnesses: [],
      degradedHarnessIds: new Set(),
      profilesByHarnessId: new Map([
        [
          "claude",
          [
            profile("ambient", "ambient", "Claude Terminal account"),
            profile("work-uuid", "managed", "Work"),
          ],
        ],
      ]),
      activeProfileIdByHarnessId: NO_ACTIVE_PROFILE_OVERRIDES,
    });

    expect(entries[0].accentDot).toEqual({
      profileId: "ambient",
      accentColor: null,
      label: "Claude Terminal account",
    });
  });
});

describe("resolveActiveProfileForHarness", () => {
  const profilesWithAmbient = [
    profile("ambient", "ambient", "Claude Terminal account"),
    profile("work-uuid", "managed", "Work"),
  ];
  const managedOnlyProfiles = [
    profile("a-uuid", "managed", "A"),
    profile("b-uuid", "managed", "B"),
  ];

  it("returns null outright under 2 profiles - profile identity has no meaning there", () => {
    expect(
      resolveActiveProfileForHarness(
        [profile("ambient", "ambient", "Claude Terminal account")],
        "anything",
        "anything",
      ),
    ).toBeNull();
  });

  it("prefers the browsed profile id when it belongs to this harness", () => {
    expect(
      resolveActiveProfileForHarness(profilesWithAmbient, "work-uuid", null),
    ).toBe("work-uuid");
  });

  it("falls back to the selected profile id when the browsed one doesn't belong here", () => {
    expect(
      resolveActiveProfileForHarness(
        profilesWithAmbient,
        "stale-from-another-harness",
        "work-uuid",
      ),
    ).toBe("work-uuid");
  });

  it("falls back to the ambient profile (commit id null) when neither matches", () => {
    expect(
      resolveActiveProfileForHarness(profilesWithAmbient, "nope", "nope-2"),
    ).toBeNull();
  });

  it("falls back to the first selectable profile for an all-managed harness", () => {
    expect(
      resolveActiveProfileForHarness(managedOnlyProfiles, "nope", "nope-2"),
    ).toBe("a-uuid");
  });
});

describe("profileCommitId", () => {
  it("maps the ambient profile to the null commit id, not the wire sentinel", () => {
    expect(
      profileCommitId(profile("ambient", "ambient", "Terminal")),
    ).toBeNull();
  });

  it("keeps a managed profile's own profileId as its commit id", () => {
    expect(profileCommitId(profile("work-uuid", "managed", "Work"))).toBe(
      "work-uuid",
    );
  });
});

describe("railHarnessDegraded", () => {
  it("degrades a signed-out provider even while its harness reports available", () => {
    // Availability probes binary presence, never auth - an installed but
    // signed-out provider (Copilot after a real logout) keeps reporting
    // `available: true`. The signed-out set must degrade WITHOUT the
    // availability gate, or the rail offers a fully-lit, selectable tab for a
    // provider the send gate then refuses to run.
    expect(
      railHarnessDegraded(harness("claude"), new Set<GuiHarnessId>(["claude"])),
    ).toBe(true);
  });

  it("keeps a healthy available provider non-degraded", () => {
    expect(railHarnessDegraded(harness("claude"), new Set())).toBe(false);
  });

  it("keeps the API-key arm availability-gated", () => {
    const apiKeyHarness: HarnessOption = {
      ...harness("codex"),
      requiresApiKey: true,
    };
    // An available API-key provider is running on SOME key - not degraded.
    expect(railHarnessDegraded(apiKeyHarness, new Set())).toBe(false);
    // Unavailable, it stays visible-but-degraded for the add-key CTA.
    expect(
      railHarnessDegraded({ ...apiKeyHarness, available: false }, new Set()),
    ).toBe(true);
  });

  it("leaves an unavailable keyless provider non-degraded - the hidden path", () => {
    expect(
      railHarnessDegraded({ ...harness("codex"), available: false }, new Set()),
    ).toBe(false);
  });
});

describe("visibleRailEntries: signed-out while available", () => {
  it("sinks a signed-out-but-available provider below the ready ones", () => {
    // Degrading codex, which sorts FIRST canonically - proving the
    // deprioritization fires without `available: false`.
    const entries = visibleRailEntries({
      harnesses: [harness("claude"), harness("codex")],
      fallbackHarnesses: [],
      degradedHarnessIds: new Set<GuiHarnessId>(["codex"]),
      profilesByHarnessId: new Map(),
      activeProfileIdByHarnessId: NO_ACTIVE_PROFILE_OVERRIDES,
    });

    expect(entries.map((entry) => entry.harness.id)).toEqual([
      "claude",
      "codex",
    ]);
    expect(entries[1].degraded).toBe(true);
  });
});
