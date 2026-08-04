// @vitest-environment jsdom
/**
 * `use-notification-config.ts`'s read failure used to clear `loading` and
 * leave `config` null with no record of why — `settings-screen.tsx`'s
 * condition (`loading || config === null`) then rendered "Loading…"
 * forever, indistinguishable from a genuinely slow host. Reachable, not
 * hypothetical: `host.notifications.getConfig` is not on the released
 * floor (checked against `released-floor.ts` directly), so an older host
 * answering `E_HOST_UNSUPPORTED` is a real case, not a corner one.
 *
 * The condition is the defect, not just the catch — a fix that only adds an
 * error STATE without the render distinguishing it would leave the same
 * spinner. Every test here asserts on what RENDERS, never on the hook's
 * internal state.
 */
import { describe, expect, it } from "vitest";
import { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import { SettingsScreen } from "@/views/toolbar/settings-screen";
import { HostClientProvider } from "@/host/host-client-context";
import { createFakeHostClient } from "@/test-utils/fakes";
import { render, screen, waitFor } from "@/test-utils/dom";

const READY_CONFIG = {
  matrix: {
    info: { renderer: true },
    needs_action: { renderer: true },
    failure: { renderer: true },
    done: { renderer: false },
  },
  channels: {
    renderer: { lastError: null },
    email: {
      host: null,
      port: null,
      user: null,
      from: null,
      credentialConfigured: false,
      lastError: null,
    },
  },
};

/**
 * `providers.list`/`host.status` are unrelated to this suite but mount
 * alongside `NotificationsSection` inside `SettingsScreen` — stubbed so
 * their own hooks resolve (or fail silently, matching their real fallback)
 * rather than leaving an unhandled rejection in the test output.
 */
function requestImpl(
  getConfig: () => Promise<unknown>,
): (method: string, params: unknown) => Promise<unknown> {
  return (method) => {
    if (method === "host.notifications.getConfig") return getConfig();
    if (method === "providers.list") return Promise.resolve({ providers: [] });
    if (method === "host.status") return Promise.reject(new Error("not stubbed"));
    throw new Error(`unexpected method ${method}`);
  };
}

function renderSettings(getConfig: () => Promise<unknown>): void {
  const host = createFakeHostClient(requestImpl(getConfig));
  render(
    <HostClientProvider client={host.client}>
      <SettingsScreen onSignOut={() => {}} />
    </HostClientProvider>,
  );
}

describe("SettingsScreen — Notifications section load failure", () => {
  it("shows the severities once the read succeeds (contrast: the error path below is not merely 'never renders content')", async () => {
    renderSettings(() => Promise.resolve(READY_CONFIG));

    expect(await screen.findByText("Informational")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("renders a distinguishable error, NOT 'Loading…' forever, when the host answers E_HOST_UNSUPPORTED", async () => {
    renderSettings(() =>
      Promise.reject(
        new HostRpcError({
          code: "E_HOST_UNSUPPORTED",
          message: "This host does not support 'host.notifications.getConfig'.",
          requestId: "r1",
          method: "host.notifications.getConfig",
          fatalDetails: null,
        }),
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This host doesn't support notification settings yet.");
    // The load-bearing negative: never stuck on the loading copy.
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.queryByText("Informational")).toBeNull();
  });

  it("renders a distinguishable (generic) error for a non-capability failure too", async () => {
    renderSettings(() => Promise.reject(new Error("network hiccup")));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't load notification settings.");
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  });
});
