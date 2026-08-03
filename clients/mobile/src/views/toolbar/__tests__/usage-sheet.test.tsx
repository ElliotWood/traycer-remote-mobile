// @vitest-environment jsdom
/**
 * M2 item 1 — the usage sheet must stop electing `provider.profiles[0]` as
 * "the active profile" and read usage for EVERY profile.
 *
 * The defect is invisible with one profile configured, which is how it
 * survived: `profiles[0]` is correct exactly when there is nothing to get
 * wrong. So the load-bearing test below uses TWO, and asserts on which
 * `profileId`s reach `host.getRateLimitUsage` — not on what the sheet renders.
 * A sheet that showed two labelled rows while still fetching one profile's
 * numbers twice would look completely right.
 *
 * Fixtures parse through `providerCliStateSchema`, so a row the host could
 * never send fails here rather than passing quietly.
 */
import { describe, expect, it } from "vitest";
import {
  providerCliStateSchema,
  type ProviderCliState,
} from "@traycer/protocol/host/provider-schemas";
import { UsageSheet } from "@/views/toolbar/usage-sheet";
import { HostClientProvider } from "@/host/host-client-context";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

function profile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
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
  };
}

function providerRow(profiles: readonly Record<string, unknown>[]): ProviderCliState {
  return providerCliStateSchema.parse({
    providerId: "claude-code",
    enabled: true,
    disabledBy: null,
    selected: { kind: "bundled" },
    candidates: [],
    authPending: false,
    checkedAt: null,
    apiKey: { supported: false, configured: false, source: null },
    auth: { status: "authenticated", label: null, badgeText: null, detail: null },
    profiles,
  });
}

/** Records every `profileId` the sheet asks usage for. */
function hostWith(provider: ProviderCliState): {
  readonly fake: FakeHostClient;
  readonly usageProfileIds: string[];
} {
  const usageProfileIds: string[] = [];
  const fake = createFakeHostClient((method, params) => {
    if (method === "providers.list") {
      return Promise.resolve({ providers: [provider] });
    }
    if (method === "host.getRateLimitUsage") {
      const p = params as { profileId: string | null };
      usageProfileIds.push(p.profileId ?? "<null>");
      return Promise.resolve({
        totalTokens: null,
        remainingTokens: null,
        providerRateLimits: { available: false, provider: "claude-code", reason: "timeout" },
      });
    }
    return Promise.reject(new Error(`unexpected RPC: ${method}`));
  });
  return { fake, usageProfileIds };
}

function renderSheet(fake: FakeHostClient, anchorProfileId: string | null | undefined): void {
  render(
    <HostClientProvider client={fake.client}>
      <UsageSheet onClose={() => {}} anchorProfileId={anchorProfileId} />
    </HostClientProvider>,
  );
}

describe("UsageSheet — profile election (M2 item 1)", () => {
  it("reads usage for EVERY profile, not just the first", async () => {
    // THE test. With `profiles[0]`, only "p-one" is ever requested.
    const { fake, usageProfileIds } = hostWith(
      providerRow([
        profile({ profileId: "p-one", label: "First account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(usageProfileIds).toContain("p-one");
    });
    await waitFor(() => {
      expect(usageProfileIds).toContain("p-two");
    });
  });

  it("labels each profile when there is more than one, so a row is attributable", async () => {
    const { fake } = hostWith(
      providerRow([
        profile({ profileId: "p-one", label: "First account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(screen.getByText(/First account/)).toBeTruthy();
    });
    expect(screen.getByText(/Second account/)).toBeTruthy();
  });

  it("marks the ambient profile as the machine login rather than showing a bare label", async () => {
    const { fake } = hostWith(
      providerRow([
        profile({ profileId: "ambient", kind: "ambient", label: "Terminal account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(screen.getByText(/signed in on this machine/)).toBeTruthy();
    });
  });

  it("does not label a lone profile — there is nothing to disambiguate", async () => {
    const { fake } = hostWith(providerRow([profile({ profileId: "p-only", label: "Only account" })]));
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeTruthy();
    });
    expect(screen.queryByText(/Only account/)).toBeNull();
  });

  it("still requests usage for a provider reporting NO profiles", async () => {
    // The pre-profile shape: `profileId: null` is the honest request, and the
    // card must not silently render nothing.
    const { fake, usageProfileIds } = hostWith(providerRow([]));
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(usageProfileIds).toEqual(["<null>"]);
    });
  });
});

describe("UsageSheet — anchoring (M2 item 4)", () => {
  it("ANCHORS to a profile without filtering the others away", async () => {
    // Anchor, not filter. Filtering would re-introduce the single-profile view
    // that item 1 removed, and it would look correct — someone arriving from
    // the banner would have no way to know the other accounts exist.
    const { fake } = hostWith(
      providerRow([
        profile({ profileId: "p-one", label: "First account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, "p-two");

    await waitFor(() => {
      expect(screen.getByText(/Second account/)).toBeTruthy();
    });
    // The OTHER row is still on screen — that is the whole point.
    expect(screen.getByText(/First account/)).toBeTruthy();
    expect(document.querySelectorAll('[data-anchored="true"]')).toHaveLength(1);
  });

  it("anchors the AMBIENT row on a null commit id, not the wire sentinel", async () => {
    // The ambient row's wire id is "ambient" but its committed form is null;
    // matching on `profileId` would never anchor to it.
    const { fake } = hostWith(
      providerRow([
        profile({ profileId: "ambient", kind: "ambient", label: "Terminal account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, null);

    await waitFor(() => {
      expect(document.querySelectorAll('[data-anchored="true"]')).toHaveLength(1);
    });
  });

  it("anchors nothing when opened from the toolbar", async () => {
    const { fake } = hostWith(
      providerRow([
        profile({ profileId: "p-one", label: "First account" }),
        profile({ profileId: "p-two", label: "Second account" }),
      ]),
    );
    renderSheet(fake, undefined);

    await waitFor(() => {
      expect(screen.getByText(/First account/)).toBeTruthy();
    });
    expect(document.querySelectorAll('[data-anchored="true"]')).toHaveLength(0);
  });
});
