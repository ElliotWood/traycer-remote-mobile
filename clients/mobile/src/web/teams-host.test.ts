import { describe, expect, it, vi } from "vitest";
import {
  applyTeamsHostAttributes,
  initializeTeamsHost,
  type TeamsAppSdk,
} from "./teams-host";

/**
 * A fake `app` namespace. `initialize` is supplied per test, because WHICH WAY
 * it settles - resolve, reject, or never - is the entire subject here.
 */
function fakeSdk(overrides: Partial<TeamsAppSdk>): TeamsAppSdk {
  return {
    initialize: () => Promise.resolve(),
    getContext: () =>
      Promise.resolve({
        app: { theme: "dark", host: { clientType: "desktop" } },
      }),
    notifySuccess: () => Promise.resolve(),
    registerOnThemeChangeHandler: () => {},
    ...overrides,
  };
}

/** A promise that never settles - the measured behaviour of a real
 *  `initialize()` under a parent that is not Teams. */
function never(): Promise<never> {
  return new Promise<never>(() => {});
}

describe("initializeTeamsHost", () => {
  it("does not even load the SDK when the document is not framed", async () => {
    // The PWA case, and the overwhelmingly common one. Asserting on the LOADER
    // rather than on the returned state is the point: a version that imported
    // ~100KB of Teams SDK and then reported `inTeams: false` would satisfy an
    // assertion about the state alone while still paying the whole cost.
    const loadSdk = vi.fn(() => Promise.resolve(fakeSdk({})));

    const state = await initializeTeamsHost({
      isFramed: () => false,
      loadSdk,
    });

    expect(loadSdk).not.toHaveBeenCalled();
    expect(state).toEqual({ inTeams: false, theme: null, hostClientType: null });
  });

  it("gives up on a handshake that never answers, instead of hanging", async () => {
    // THE defect this module exists to prevent. `initialize()` does not reject
    // under a non-Teams parent - it postMessages and waits forever. The
    // retired teams-tab shipped exactly this and rendered an empty document,
    // no errors, indefinitely.
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const pending = initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () => Promise.resolve(fakeSdk({ initialize: never })),
        timeoutMs: 4000,
      }).then((state) => {
        settled(state);
        return state;
      });

      // The dynamic-import await has to drain before the timer exists.
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4000);
      await expect(pending).resolves.toEqual({
        inTeams: false,
        theme: null,
        hostClientType: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no unhandled rejection when a timed-out initialize later rejects", async () => {
    // Once the timeout wins the race is settled, so a rejection arriving
    // afterwards has no handler unless one was attached to the initialize
    // promise itself. In a real tab that surfaces as console noise that hides
    // the next real error.
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let rejectLate: (reason: Error) => void = () => {};
      const pending = initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () =>
          Promise.resolve(
            fakeSdk({
              initialize: () =>
                new Promise<void>((_resolve, reject) => {
                  rejectLate = reject;
                }),
            }),
          ),
        timeoutMs: 4000,
      });

      await vi.advanceTimersByTimeAsync(4000);
      await expect(pending).resolves.toEqual({
        inTeams: false,
        theme: null,
        hostClientType: null,
      });

      rejectLate(new Error("host went away"));
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
      // Node reports unhandled rejections a macrotask after the fact.
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      process.off("unhandledRejection", unhandled);
    }
  });

  it("reports a plain browser when initialize rejects outright", async () => {
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({ initialize: () => Promise.reject(new Error("no host")) }),
        ),
    });

    expect(state).toEqual({ inTeams: false, theme: null, hostClientType: null });
  });

  it("reports a plain browser when the SDK chunk fails to load", async () => {
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () => Promise.reject(new Error("chunk load failed")),
    });

    expect(state).toEqual({ inTeams: false, theme: null, hostClientType: null });
  });

  it("completes the handshake and answers the host's load protocol", async () => {
    const notifySuccess = vi.fn(() => Promise.resolve());
    const onTheme = vi.fn();

    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () => Promise.resolve(fakeSdk({ notifySuccess })),
      onTheme,
    });

    // Whole-object, so a dropped field fails here rather than being missed by
    // a set of per-field assertions that only covers the fields someone
    // thought of.
    expect(state).toEqual({
      inTeams: true,
      theme: "dark",
      hostClientType: "desktop",
    });
    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(onTheme).toHaveBeenCalledWith("dark");
  });

  it("stays in Teams when notifySuccess rejects", async () => {
    // The host answered `initialize` - that is what `inTeams` means. Retracting
    // it over a load-protocol acknowledgement would make the layout disagree
    // with reality.
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({ notifySuccess: () => Promise.reject(new Error("nope")) }),
        ),
    });

    expect(state.inTeams).toBe(true);
  });

  it("stays in Teams, with nulls, when getContext fails", async () => {
    const notifySuccess = vi.fn(() => Promise.resolve());
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({
            getContext: () => Promise.reject(new Error("context unavailable")),
            notifySuccess,
          }),
        ),
    });

    expect(state).toEqual({
      inTeams: true,
      theme: null,
      hostClientType: null,
    });
    // The degraded path must still answer the load protocol, or the tab can
    // sit behind a spinner for want of a context nobody needed.
    expect(notifySuccess).toHaveBeenCalledTimes(1);
  });

  it("tolerates a host that omits clientType", async () => {
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({
            getContext: () =>
              Promise.resolve({ app: { theme: "contrast", host: {} } }),
          }),
        ),
    });

    expect(state).toEqual({
      inTeams: true,
      theme: "contrast",
      hostClientType: null,
    });
  });

  it("forwards later theme changes pushed by the host", async () => {
    const onTheme = vi.fn();
    let push: (theme: string) => void = () => {};

    await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({
            registerOnThemeChangeHandler: (handler) => {
              push = handler;
            },
          }),
        ),
      onTheme,
    });

    push("contrast");
    expect(onTheme.mock.calls).toEqual([["dark"], ["contrast"]]);
  });
});

describe("applyTeamsHostAttributes", () => {
  it("writes nothing at all outside Teams", () => {
    // A plain browser must be indistinguishable from one where this shell was
    // never wired in, or a CSS rule keyed on the attribute leaks into the PWA.
    const root = document.createElement("html");
    applyTeamsHostAttributes(
      { inTeams: false, theme: null, hostClientType: null },
      root,
    );
    expect(root.getAttributeNames()).toEqual([]);
  });

  it("records the client type and theme in Teams", () => {
    const root = document.createElement("html");
    applyTeamsHostAttributes(
      { inTeams: true, theme: "dark", hostClientType: "ios" },
      root,
    );
    expect(root.getAttribute("data-teams-host")).toBe("ios");
    expect(root.getAttribute("data-teams-theme")).toBe("dark");
  });

  it("still marks the tab as Teams when the client type is unknown", () => {
    // `data-teams-host` absent and `data-teams-host="unknown"` are different
    // claims: the first says "not Teams", which would be wrong here.
    const root = document.createElement("html");
    applyTeamsHostAttributes(
      { inTeams: true, theme: null, hostClientType: null },
      root,
    );
    expect(root.getAttribute("data-teams-host")).toBe("unknown");
    expect(root.hasAttribute("data-teams-theme")).toBe(false);
  });
});
