/**
 * @vitest-environment jsdom
 *
 * The usage rows, asserted on the three things that render as the same "no
 * bars" if you let them collapse, and on the one request-shaping decision that
 * cannot be seen from the screen at all.
 *
 *   1. **"no window concept" is not "no live windows".** openrouter reports a
 *      credit balance and has no window notion; claude-code has windows and may
 *      currently report none. Both draw zero bars. Telling a credits user their
 *      windows had emptied is a false statement rendered as an empty state,
 *      which is why this is the first thing here.
 *   2. **A per-profile failure is not a section failure.** Each profile owns
 *      its own read, so one account's error must leave the others' bars up.
 *   3. **The ambient profile is requested as `null`, not as the wire
 *      sentinel.** Invisible on screen in every case — the rows look identical
 *      either way — so it is asserted on the REQUEST, which is the only place
 *      the difference exists.
 *
 * Fixtures parse through `providerRateLimitsSchema` rather than being cast, for
 * the reason this client has already paid for once: a cast that omits a field
 * takes the wrong branch at runtime and passes before AND after a fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  providerRateLimitsSchema,
  type ProviderRateLimits,
} from "@traycer/protocol/host/rate-limit";
import { ProviderUsage } from "../provider-usage";
import type { ProviderSummary, SettingsClient } from "../use-settings";

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;

afterEach(() => {
  cleanup();
});

function provider(over: Partial<ProviderSummary>): ProviderSummary {
  return {
    providerId: "claude-code",
    enabled: true,
    auth: { status: "authenticated" },
    profiles: [],
    ...over,
  };
}

function claudeCode(over: Record<string, unknown>): ProviderRateLimits {
  return providerRateLimitsSchema.parse({
    provider: "claude-code",
    available: true,
    subscriptionType: null,
    fiveHour: null,
    sevenDay: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    ...over,
  });
}

/**
 * A client that answers every usage read with one snapshot, and records the
 * params it was asked with.
 *
 * The recording is not incidental — it is the only instrument that can see
 * decision 3 above.
 */
interface UsageCall {
  readonly providerId?: string;
  readonly profileId: string | null;
}

function usageClient(
  answer: (call: UsageCall) => ProviderRateLimits | null | Promise<never>,
): { client: SettingsClient; calls: UsageCall[] } {
  const calls: UsageCall[] = [];
  /*
   * Asserted onto `SettingsClient["request"]` — the member type — rather than
   * erased with `as any`, which this package's lint config bans by name. The
   * narrow `Pick<HostRequester, "request">` seam is what makes a fake possible
   * at all; `use-settings.test.tsx`'s own `fakeClient` does the same thing, and
   * this follows it rather than inventing a second shape.
   */
  const request = ((method: string, params: UsageCall) => {
    if (method !== "host.getRateLimitUsage") {
      return Promise.reject(new Error(`unexpected method ${method}`));
    }
    calls.push(params);
    const result = answer(params);
    if (result instanceof Promise) return result;
    return Promise.resolve({ providerRateLimits: result });
  }) as SettingsClient["request"];
  return { client: { request }, calls };
}

describe("provider usage — the empty states are different answers", () => {
  it("says 'no window data' for a credits provider, NOT 'no active windows'", async () => {
    const openrouter = providerRateLimitsSchema.parse({
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
    const { client } = usageClient(() => openrouter);
    render(
      <ProviderUsage
        client={client}
        provider={provider({ providerId: "openrouter" })}
      />,
    );

    expect(
      await screen.findByText(/No usage-window data for this provider/),
    ).toBeTruthy();
    // The PAIRED negative. Without it, a component that rendered nothing at
    // all would satisfy a `queryByText(...)` null check for the other string.
    expect(screen.queryByText(/No active usage windows/)).toBeNull();
  });

  it("says 'no active windows' for a windowed provider reporting none", async () => {
    const { client } = usageClient(() => claudeCode({}));
    render(<ProviderUsage client={client} provider={provider({})} />);

    expect(await screen.findByText(/No active usage windows/)).toBeTruthy();
    expect(screen.queryByText(/No usage-window data/)).toBeNull();
  });
});

describe("provider usage — meters", () => {
  it("renders one labelled meter per window, with the percentage and reset", async () => {
    const { client } = usageClient(() =>
      claudeCode({
        fiveHour: { usedPercent: 42.4, durationMinutes: 300, resetsAt: null },
        sevenDay: { usedPercent: 8, durationMinutes: 10080, resetsAt: null },
      }),
    );
    render(<ProviderUsage client={client} provider={provider({})} />);

    expect(await screen.findByText("Current session")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
    // Rounded, not truncated, and not carrying the raw float.
    expect(screen.getByText(/42% used/)).toBeTruthy();

    // The accessible name carries the WINDOW. Four bars announcing a bare
    // percentage each is the failure this asserts against.
    const meters = screen.getAllByRole("progressbar");
    expect(meters).toHaveLength(2);
    expect(meters[0]?.getAttribute("aria-label")).toBe(
      "Current session: 42% used",
    );
  });

  it("marks a window at or past the severe threshold, and not one below it", async () => {
    // 89/90 rather than 10/95: the interesting failure is an off-by-one or an
    // inverted comparison at the boundary, and a distant pair cannot see it.
    const { client } = usageClient(() =>
      claudeCode({
        fiveHour: { usedPercent: 89, durationMinutes: 300, resetsAt: null },
        sevenDay: { usedPercent: 90, durationMinutes: 10080, resetsAt: null },
      }),
    );
    render(<ProviderUsage client={client} provider={provider({})} />);
    await screen.findByText("Current session");

    const meters = screen.getAllByRole("progressbar");
    /*
     * THE INTENT IS ON THE `__bar` CHILD, not on the `progressbar` root.
     *
     * Written first against the root, where it failed — both roots carry a
     * byte-identical class list regardless of `color`, because Fluent styles
     * the fill element and leaves the track alone. Worth recording: had the
     * first version been written the other way round (asserting the roots were
     * the SAME), it would have passed, and it would have passed just as well
     * with the threshold deleted.
     *
     * Compared to each other rather than to a literal class name, so this
     * catches a threshold that stopped firing without pinning Fluent's
     * generated class hashes.
     */
    const bars = meters.map((meter) =>
      meter.querySelector(".fui-ProgressBar__bar")?.className,
    );
    expect(bars[0]).toBeTruthy();
    expect(bars[0]).not.toBe(bars[1]);
  });
});

describe("provider usage — per-profile isolation", () => {
  const twoProfiles = provider({
    profiles: [
      { profileId: "ambient", kind: "ambient", label: "Terminal account" },
      { profileId: "p2", kind: "managed", label: "Altra" },
    ],
  });

  it("requests the AMBIENT profile as null, not as the wire sentinel", async () => {
    // Decision 3. Nothing on screen differs between the two, so this is
    // asserted on the request or not at all.
    const { client, calls } = usageClient(() => claudeCode({}));
    render(<ProviderUsage client={client} provider={twoProfiles} />);

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((call) => call.profileId)).toEqual([null, "p2"]);
    // The sentinel must not reach the wire at all.
    expect(calls.map((call) => call.profileId)).not.toContain("ambient");
  });

  it("labels each profile when there is more than one, so a reading is attributable", async () => {
    const { client } = usageClient(() => claudeCode({}));
    render(<ProviderUsage client={client} provider={twoProfiles} />);

    expect(
      await screen.findByText(/Terminal account · signed in on this machine/),
    ).toBeTruthy();
    expect(screen.getByText("Altra")).toBeTruthy();
  });

  it("does not label a lone profile — there is nothing to disambiguate", async () => {
    const { client } = usageClient(() => claudeCode({}));
    render(
      <ProviderUsage
        client={client}
        provider={provider({
          profiles: [
            { profileId: "p2", kind: "managed", label: "Altra" },
          ],
        })}
      />,
    );

    await screen.findByText(/No active usage windows/);
    expect(screen.queryByText("Altra")).toBeNull();
  });

  it("keeps one profile's bars up when ANOTHER profile's read fails", async () => {
    // The point of a read per profile. A single shared load would take both
    // rows down, and the screen would look like a provider-wide outage.
    const { client } = usageClient((params) =>
      params.profileId === null
        ? Promise.reject(new Error("usage probe timed out"))
        : claudeCode({
            fiveHour: { usedPercent: 30, durationMinutes: 300, resetsAt: null },
          }),
    );
    render(<ProviderUsage client={client} provider={twoProfiles} />);

    expect(await screen.findByText(/usage probe timed out/)).toBeTruthy();
    expect(screen.getByText("Current session")).toBeTruthy();
    expect(screen.getByText(/30% used/)).toBeTruthy();
  });

  it("still reads usage for a provider reporting NO profiles", async () => {
    // The pre-profile host shape. Skipping it would silently drop usage for
    // exactly the older hosts most likely to need reading.
    const { client, calls } = usageClient(() => claudeCode({}));
    render(<ProviderUsage client={client} provider={provider({})} />);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.profileId).toBeNull();
  });
});

describe("provider usage — host-side unavailability", () => {
  it("renders the host's own reason rather than a generic failure", async () => {
    const unavailable = providerRateLimitsSchema.parse({
      provider: "claude-code",
      available: false,
      reason: "cli_not_found",
    });
    const { client } = usageClient(() => unavailable);
    render(<ProviderUsage client={client} provider={provider({})} />);

    expect(await screen.findByText("cli not found")).toBeTruthy();
  });

  it("distinguishes a null snapshot from a rejected request", async () => {
    const { client } = usageClient(() => null);
    render(<ProviderUsage client={client} provider={provider({})} />);

    // The request SUCCEEDED and carried nothing — a fact about the account, so
    // it must not be worded as a failed call.
    expect(
      await screen.findByText(/reported no usage data for this account/),
    ).toBeTruthy();
  });

  it("says so when no host is configured, rather than spinning forever", async () => {
    render(<ProviderUsage client={null} provider={provider({})} />);
    expect(
      await screen.findByText(/No Traycer host is configured/),
    ).toBeTruthy();
    expect(screen.queryByText(/Loading usage/)).toBeNull();
  });
});
