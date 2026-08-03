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

function renderSheet(fake: FakeHostClient): void {
  render(
    <HostClientProvider client={fake.client}>
      <UsageSheet onClose={() => {}} />
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
    renderSheet(fake);

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
    renderSheet(fake);

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
    renderSheet(fake);

    await waitFor(() => {
      expect(screen.getByText(/signed in on this machine/)).toBeTruthy();
    });
  });

  it("does not label a lone profile — there is nothing to disambiguate", async () => {
    const { fake } = hostWith(providerRow([profile({ profileId: "p-only", label: "Only account" })]));
    renderSheet(fake);

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeTruthy();
    });
    expect(screen.queryByText(/Only account/)).toBeNull();
  });

  it("still requests usage for a provider reporting NO profiles", async () => {
    // The pre-profile shape: `profileId: null` is the honest request, and the
    // card must not silently render nothing.
    const { fake, usageProfileIds } = hostWith(providerRow([]));
    renderSheet(fake);

    await waitFor(() => {
      expect(usageProfileIds).toEqual(["<null>"]);
    });
  });
});
