/**
 * @vitest-environment jsdom
 *
 * The settings screen, asserted on the two distinctions that render as the
 * same zero rows if you let them collapse, and on the one that mobile gets
 * wrong.
 *
 *   1. **`error` is not `empty`.** "No providers reported by this host" is a
 *      fact about the host; "couldn't read providers" is a fact about the
 *      request. A screen that renders both as an empty list tells the user
 *      something false in one of the two cases.
 *   2. **`error` is not `loading`.** Mobile's notifications section renders
 *      `loading || config === null`, and its hook's catch clears `loading`
 *      while leaving `config` null — so a host that lacks
 *      `host.notifications.getConfig` (it is NOT on the released floor) spins
 *      forever. A permanent spinner is indistinguishable from a slow host,
 *      which is why nobody has noticed. This screen must say it out loud.
 *   3. **A failed write leaves the switch where the HOST has it.** Asserted
 *      through the switch's own `checked` state rather than through a
 *      message, because a message is easy to render beside a control that has
 *      already lied.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HostNotificationsConfigResponse } from "@traycer/protocol/host/notifications/host-notifications";
import { SettingsScreen } from "../settings-screen";
import type {
  HostStatusState,
  NotificationConfigResult,
  ProviderSummary,
  ProvidersState,
  SettingsClient,
} from "../use-settings";

/**
 * jsdom has no `ResizeObserver` and Fluent's `MessageBar` constructs one.
 * Stub, not fake — see the identical note in
 * `notifications/__tests__/notifications-screen.test.tsx`, which is where this
 * hazard was first paid for.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;

afterEach(() => {
  cleanup();
});

/**
 * A provider row, built against the NARROW prop type and with no cast.
 *
 * `ProviderCliState` composes a versioned auth union a fixture cannot
 * reproduce without `as unknown as` — banned here, and the shape that let a
 * fixture silently omit `workflowMeta` elsewhere in this client. Narrowing the
 * renderer's prop is what removes the need. The wire shape still has to match:
 * `useProviders` assigns the real `response.providers` into this type, so a
 * protocol change that drops one of these three fields is a `tsc` error.
 */
function provider(over: Partial<ProviderSummary>): ProviderSummary {
  return {
    providerId: "claude-code",
    enabled: true,
    auth: { status: "authenticated" },
    // Defaults to NO profiles — the pre-profile host shape. The usage rows
    // still read once with a `null` profile in that case, which is why every
    // render below needs a client even when the test is about something else.
    profiles: [],
    ...over,
  };
}

/**
 * A client whose usage read never settles, for the tests that are not about
 * usage.
 *
 * A never-resolving promise rather than `null`: `null` is the "no host
 * configured" state and renders its own error copy, which would then appear in
 * every provider assertion below and make a matcher for real usage text pass
 * for the wrong reason. A pending read renders "Loading usage…" and nothing
 * else, which is inert with respect to what these tests assert.
 */
const PENDING_CLIENT: SettingsClient = {
  request: () => new Promise(() => undefined),
};

/**
 * Every severity, off on both channels.
 *
 * The matrix is a TOTAL `Record` over the four severities — `tsc` rejected the
 * three-key fixture this file was first written with, which is the type doing
 * exactly what it should. Tests override only the severities they are about.
 */
const ALL_OFF: HostNotificationsConfigResponse["matrix"] = {
  info: { renderer: false, email: false },
  needs_action: { renderer: false, email: false },
  failure: { renderer: false, email: false },
  done: { renderer: false, email: false },
};

/** The real response type, constructed literally — no cast needed. */
function config(
  over: Partial<HostNotificationsConfigResponse["matrix"]>,
): HostNotificationsConfigResponse {
  return {
    matrix: { ...ALL_OFF, ...over },
    channels: {
      renderer: { lastError: null },
      email: {
        host: "smtp.example.com",
        port: 587,
        user: "bot",
        from: "bot@example.com",
        credentialConfigured: true,
        lastError: null,
      },
    },
  };
}

const LOADED_STATUS: HostStatusState = {
  kind: "ready",
  status: { hostVersion: "1.4.2", protocolVersion: { major: 3, minor: 1 } },
};

function notifications(
  state: NotificationConfigResult["state"],
  setRendererSeverity: NotificationConfigResult["setRendererSeverity"],
): NotificationConfigResult {
  return { state, setRendererSeverity };
}

const NOOP_SET = (): void => undefined;

describe("settings — providers", () => {
  it("distinguishes 'the host has none' from 'we could not ask'", () => {
    const empty: ProvidersState = { kind: "ready", providers: [] };
    const { unmount } = render(
      <SettingsScreen
        providers={empty}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(screen.getByText(/No providers reported by this host/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't read providers/)).toBeNull();
    unmount();

    const failed: ProvidersState = { kind: "error", detail: "socket closed" };
    render(
      <SettingsScreen
        providers={failed}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(screen.getByText(/Couldn't read providers/)).toBeTruthy();
    // The detail is carried, not swallowed — it is the only thing that tells
    // a user whether to retry or to report.
    expect(screen.getByText(/socket closed/)).toBeTruthy();
    expect(screen.queryByText(/No providers reported/)).toBeNull();
  });

  it("names providers with their display name and reports connection state", () => {
    const ready: ProvidersState = {
      kind: "ready",
      providers: [
        provider({}),
        provider({
          providerId: "codex",
          enabled: false,
          auth: { status: "unauthenticated" },
        }),
      ],
    };
    render(
      <SettingsScreen
        providers={ready}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(screen.getByText("Connected")).toBeTruthy();
    // The host's own token for the bad case, rather than an invented word.
    expect(screen.getByText("unauthenticated")).toBeTruthy();
  });

  it("reads usage for the ENABLED provider only", async () => {
    /*
     * `host.getRateLimitUsage` makes the host reach out to the provider, so a
     * usage read for a switched-off account spends a live call to report limits
     * nobody asked for. The filter is invisible on screen — a disabled row
     * looks the same with and without it — so this is asserted on the requests.
     *
     * Both providers carry a profile, so a broken filter produces TWO calls and
     * the length check alone would catch it; the identity check is here because
     * "two calls" and "the wrong one of two" are different defects.
     */
    const calls: Array<{ readonly providerId?: string }> = [];
    // Asserted onto the member type, matching `use-settings.test.tsx`'s
    // `fakeClient`. `as any` is banned in this package.
    const request = ((_method: string, params: { providerId?: string }) => {
      calls.push(params);
      return new Promise(() => undefined);
    }) as SettingsClient["request"];
    const client: SettingsClient = { request };
    const ready: ProvidersState = {
      kind: "ready",
      providers: [
        provider({
          profiles: [{ profileId: "p1", kind: "managed", label: "A" }],
        }),
        provider({
          providerId: "codex",
          enabled: false,
          profiles: [{ profileId: "p2", kind: "managed", label: "B" }],
        }),
      ],
    };
    render(
      <SettingsScreen
        providers={ready}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={client}
      />,
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.providerId).toBe("claude-code");
  });
});

describe("settings — notifications", () => {
  it("says the settings could not be read, rather than spinning forever", () => {
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications(
          { kind: "error", detail: "unknown method" },
          NOOP_SET,
        )}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(
      screen.getByText(/Couldn't read notification settings from this host/),
    ).toBeTruthy();
    // THE MOBILE DEFECT, asserted as absent. Its render condition is
    // `loading || config === null`, so this is the string a user gets there.
    expect(screen.queryByText(/Loading notification settings/)).toBeNull();
  });

  it("reflects the matrix and reports the severity that was toggled", () => {
    // TYPED, and the lint rule that requires it names exactly why: an untyped
    // mock records its arguments as `any`, so `toHaveBeenCalledWith("info",
    // true)` below could not fail — it would accept a call with the wrong
    // severity, or with the boolean inverted.
    const setRendererSeverity =
      vi.fn<NotificationConfigResult["setRendererSeverity"]>();
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications(
          {
            kind: "ready",
            config: config({
              info: { renderer: false, email: false },
              needs_action: { renderer: true, email: false },
            }),
            saving: null,
            saveError: null,
          },
          setRendererSeverity,
        )}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    const info = screen.getByRole("switch", { name: "Informational" });
    const needsAction = screen.getByRole("switch", {
      name: "Needs your action (approvals/interviews)",
    });
    expect((info as HTMLInputElement).checked).toBe(false);
    expect((needsAction as HTMLInputElement).checked).toBe(true);
    // All four rows render, in mobile's order, whatever the matrix says. The
    // ORDER is part of the parity claim and comes from a literal tuple in the
    // screen rather than from `Object.keys` over the protocol's enum.
    expect(screen.getAllByRole("switch")).toHaveLength(4);
    expect(
      (screen.getByRole("switch", { name: "Failures" }) as HTMLInputElement)
        .checked,
    ).toBe(false);

    fireEvent.click(info);
    expect(setRendererSeverity).toHaveBeenCalledWith("info", true);
  });

  it("a failed write leaves the switch showing what the HOST has", () => {
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications(
          {
            kind: "ready",
            // The host still has it OFF — the write did not land.
            config: config({ info: { renderer: false, email: false } }),
            saving: null,
            saveError: "host refused",
          },
          NOOP_SET,
        )}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(
      (
        screen.getByRole("switch", {
          name: "Informational",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(screen.getByText(/wasn't saved/)).toBeTruthy();
    expect(screen.getByText(/host refused/)).toBeTruthy();
  });

  it("disables the switches while a write is in flight", () => {
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications(
          {
            kind: "ready",
            config: config({ info: { renderer: false, email: false } }),
            saving: "info",
            saveError: null,
          },
          NOOP_SET,
        )}
        hostStatus={LOADED_STATUS}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    expect(
      (
        screen.getByRole("switch", {
          name: "Informational",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });
});

describe("settings — about", () => {
  it("reports the host version, and signs out", () => {
    const onSignOut = vi.fn<() => void>();
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={LOADED_STATUS}
        onSignOut={onSignOut}
        client={PENDING_CLIENT}
      />,
    );
    expect(screen.getByText(/Host v1\.4\.2/)).toBeTruthy();
    expect(screen.getByText(/protocol\s*3\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders the rest of the screen when the version is unavailable", () => {
    render(
      <SettingsScreen
        providers={{ kind: "ready", providers: [] }}
        notifications={notifications({ kind: "loading" }, NOOP_SET)}
        hostStatus={{ kind: "error", detail: "timed out" }}
        onSignOut={NOOP_SET}
        client={PENDING_CLIENT}
      />,
    );
    // The POINT of three independent states: only two of the four methods are
    // on the released floor, so one section failing must not take the screen
    // down. Sign-out in particular has to survive it — it is the control a
    // user reaches for when the host is unreachable.
    expect(screen.getByText(/Host version unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });
});
