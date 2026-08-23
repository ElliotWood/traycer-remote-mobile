import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyTeamsHostAttributes,
  initializeTeamsHost,
  teamsThemeToResolved,
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
    openLink: () => Promise.resolve(),
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
    expect(state).toEqual({
      inTeams: false,
      theme: null,
      hostClientType: null,
      subPageId: null,
    });
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
        subPageId: null,
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
        subPageId: null,
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

    expect(state).toEqual({
      inTeams: false,
      theme: null,
      hostClientType: null,
      subPageId: null,
    });
  });

  it("reports a plain browser when the SDK chunk fails to load", async () => {
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () => Promise.reject(new Error("chunk load failed")),
    });

    expect(state).toEqual({
      inTeams: false,
      theme: null,
      hostClientType: null,
      subPageId: null,
    });
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
      subPageId: null,
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
      subPageId: null,
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
      subPageId: null,
    });
  });

  /**
   * THE DEEP-LINK CHANNEL. `context.page.subPageId` is the only field in a
   * Teams entity deep link that can say which page to open, and until this
   * block existed nothing read it - so a card could address this tab and the
   * tab would open on its landing screen, silently. `onDeepLink` with no call
   * site would be that same defect one layer up, which is why these rows
   * assert on the CALLBACK and not only on the returned state.
   */
  describe("the deep link a card asked for", () => {
    const ROUTE = "/epics/epic-1/epic-1?focusArtifactId=chat-1";

    function sdkWithPage(subPageId: string | undefined): TeamsAppSdk {
      return fakeSdk({
        getContext: () =>
          Promise.resolve({
            app: { theme: "dark", host: { clientType: "desktop" } },
            page: { subPageId },
          }),
      });
    }

    it("hands the route to onDeepLink and reports it in the state", async () => {
      const onDeepLink = vi.fn();

      const state = await initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () => Promise.resolve(sdkWithPage(ROUTE)),
        onDeepLink,
      });

      expect(onDeepLink.mock.calls).toEqual([[ROUTE]]);
      expect(state.subPageId).toBe(ROUTE);
    });

    it("does not fire on an ordinary open, which is nearly every open", async () => {
      // The default fake returns a context with NO `page` at all, which is
      // what a tab opened from the Teams app list gets.
      const onDeepLink = vi.fn();

      const state = await initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () => Promise.resolve(fakeSdk({})),
        onDeepLink,
      });

      expect(onDeepLink).not.toHaveBeenCalled();
      expect(state.subPageId).toBeNull();
    });

    it("treats an empty subPageId as absent rather than as a route", async () => {
      // An empty string is the same non-answer as a missing field, and it is
      // the one a `?? ""` fallback elsewhere would let through as a value.
      const onDeepLink = vi.fn();

      const state = await initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () => Promise.resolve(sdkWithPage("")),
        onDeepLink,
      });

      expect(onDeepLink).not.toHaveBeenCalled();
      expect(state.subPageId).toBeNull();
    });

    /**
     * ORDERING, and it is the reviewable decision in this file.
     *
     * Applying a deep link can RELOAD the document. A page about to be
     * discarded must not first tell Teams it is ready: if the manifest ever
     * sets `showLoadingIndicator`, the honest state at that moment is still
     * loading. Every unit assertion above passes with the two calls in either
     * order, so only this row sees it.
     */
    it("offers the deep link BEFORE answering the load protocol", async () => {
      const order: string[] = [];
      const onDeepLink = vi.fn(() => {
        order.push("deep-link");
      });

      await initializeTeamsHost({
        isFramed: () => true,
        loadSdk: () =>
          Promise.resolve(
            fakeSdk({
              getContext: () =>
                Promise.resolve({
                  app: { theme: "dark", host: { clientType: "desktop" } },
                  page: { subPageId: ROUTE },
                }),
              notifySuccess: () => {
                order.push("notify-success");
                return Promise.resolve();
              },
            }),
          ),
        onDeepLink,
      });

      expect(order).toEqual(["deep-link", "notify-success"]);
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

/**
 * The gating is the whole subject. Handing a Teams-bound opener to a surface
 * that is not Teams would route every link on the PWA into an SDK with no host
 * to answer it - a wider failure than the silent one being fixed, reached by
 * the change meant to fix it.
 */
describe("the Teams link opener", () => {
  it("hands over an opener that calls the SDK, once the host has answered", async () => {
    const openLink = vi.fn(() => Promise.resolve());
    const onLinkOpener = vi.fn();

    await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () => Promise.resolve(fakeSdk({ openLink })),
      onLinkOpener,
    });

    expect(onLinkOpener).toHaveBeenCalledTimes(1);
    // Exercised rather than merely counted: an opener that was handed over but
    // wired to nothing would satisfy a call-count assertion exactly.
    const handed = onLinkOpener.mock.calls[0][0] as (
      url: string,
    ) => Promise<void>;
    await handed("https://example.test/x");
    expect(openLink).toHaveBeenCalledWith("https://example.test/x");
  });

  it("propagates the SDK's rejection, which is the only failure signal there is", async () => {
    const onLinkOpener = vi.fn();
    await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({ openLink: () => Promise.reject(new Error("refused")) }),
        ),
      onLinkOpener,
    });

    const handed = onLinkOpener.mock.calls[0][0] as (
      url: string,
    ) => Promise<void>;
    await expect(handed("https://example.test/x")).rejects.toThrow("refused");
  });

  it("hands over NOTHING when the document is not framed - the PWA keeps window.open", async () => {
    const onLinkOpener = vi.fn();
    await initializeTeamsHost({
      isFramed: () => false,
      loadSdk: () => Promise.resolve(fakeSdk({})),
      onLinkOpener,
    });
    expect(onLinkOpener).not.toHaveBeenCalled();
  });

  it("hands over NOTHING when the handshake times out under a non-Teams parent", async () => {
    const onLinkOpener = vi.fn();
    const state = await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () => Promise.resolve(fakeSdk({ initialize: never })),
      timeoutMs: 1,
      onLinkOpener,
    });
    // Paired with the state so this cannot pass by the handshake having failed
    // for some unrelated reason before reaching the registration.
    expect(state.inTeams).toBe(false);
    expect(onLinkOpener).not.toHaveBeenCalled();
  });

  it("hands over NOTHING when initialize rejects outright", async () => {
    const onLinkOpener = vi.fn();
    await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({ initialize: () => Promise.reject(new Error("no host")) }),
        ),
      onLinkOpener,
    });
    expect(onLinkOpener).not.toHaveBeenCalled();
  });

  it("still hands over when getContext fails - a degraded Teams session can still open links", async () => {
    // Deliberate ordering, asserted because it is the reviewable choice: the
    // registration sits BEFORE the optional context read, so the app's only
    // door out does not depend on a call this module already treats as
    // allowed to fail.
    const onLinkOpener = vi.fn();
    await initializeTeamsHost({
      isFramed: () => true,
      loadSdk: () =>
        Promise.resolve(
          fakeSdk({ getContext: () => Promise.reject(new Error("no ctx")) }),
        ),
      onLinkOpener,
    });
    expect(onLinkOpener).toHaveBeenCalledTimes(1);
  });
});

describe("applyTeamsHostAttributes", () => {
  it("writes nothing at all outside Teams", () => {
    // A plain browser must be indistinguishable from one where this shell was
    // never wired in, or a CSS rule keyed on the attribute leaks into the PWA.
    const root = document.createElement("html");
    applyTeamsHostAttributes(
      { inTeams: false, theme: null, hostClientType: null, subPageId: null },
      root,
    );
    expect(root.getAttributeNames()).toEqual([]);
  });

  it("records the client type and theme in Teams", () => {
    const root = document.createElement("html");
    applyTeamsHostAttributes(
      { inTeams: true, theme: "dark", hostClientType: "ios", subPageId: null },
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
      { inTeams: true, theme: null, hostClientType: null, subPageId: null },
      root,
    );
    expect(root.getAttribute("data-teams-host")).toBe("unknown");
    expect(root.hasAttribute("data-teams-theme")).toBe(false);
  });
});

describe("teamsThemeToResolved", () => {
  it("maps Teams' dark theme to dark", () => {
    expect(teamsThemeToResolved("dark")).toBe("dark");
  });

  it("maps the high-contrast theme to dark, because it is black-backed", () => {
    // A light app inside Teams' black high-contrast client is the worse of the
    // two wrong answers. This is not a claim to SUPPORT high contrast - the
    // app has no such preset - it is picking the nearer of light and dark.
    expect(teamsThemeToResolved("contrast")).toBe("dark");
  });

  it("maps the default and glass themes to light", () => {
    expect(teamsThemeToResolved("default")).toBe("light");
    expect(teamsThemeToResolved("glass")).toBe("light");
  });

  it("resolves an unrecognised future theme name to light, not dark", () => {
    // A new client's theme name must not black out a tab in a light client.
    // Asserted rather than left to chance: the failure is silent and visual.
    expect(teamsThemeToResolved("some-future-theme")).toBe("light");
    expect(teamsThemeToResolved("")).toBe("light");
  });

  it("is case-sensitive against the SDK's own spelling", () => {
    // The SDK emits lowercase names. Recorded so a future reader knows the
    // narrow match is deliberate and does not "fix" it into a fuzzy one.
    expect(teamsThemeToResolved("Dark")).toBe("light");
  });
});

describe("the entry point wires the theme through", () => {
  /**
   * A SOURCE contract, in this package's existing idiom, because the defect
   * this guards is a CALL SITE THAT DID NOT EXIST: `onTheme` shipped as a
   * documented option of `initializeTeamsHost` with zero callers, so every
   * unit test of the shell passed over a tab whose theme went nowhere.
   * `main.tsx` is the bundle entry - it runs `createRoot` at import - so there
   * is nothing to drive behaviourally without booting the whole app.
   *
   * Keyed on IDENTIFIERS, never on comments or prose: a reworded comment must
   * not redden this, and a renamed export must.
   */
  // From the vitest root (`clients/mobile`) rather than `import.meta.url`,
  // which is not a `file:` URL under this transform. A wrong path THROWS here
  // rather than reading empty, so these rows cannot pass by matching nothing -
  // and the length assertion below closes the remaining "found but empty" case.
  const mainSource = readFileSync(
    join(process.cwd(), "src", "web", "main.tsx"),
    "utf8",
  );

  it("read the entry point it is asserting about", () => {
    expect(mainSource.length).toBeGreaterThan(1000);
    expect(mainSource).toContain("createRoot");
  });

  it("passes an onTheme handler to initializeTeamsHost", () => {
    expect(mainSource).toMatch(/initializeTeamsHost\(\{[\s\S]*?onTheme:/);
  });

  it("routes the Teams theme through the decoder into the applier seam", () => {
    // Both halves, together: decoding without applying leaves the shipped
    // defect in place, and applying a raw Teams theme name would push
    // "contrast" into a light/dark slot that has no such member.
    expect(mainSource).toMatch(
      /setHostThemeOverride\(\s*teamsThemeToResolved\(/,
    );
  });

  it("imports both from the modules that own them", () => {
    expect(mainSource).toMatch(
      /import\s*\{[^}]*\bsetHostThemeOverride\b[^}]*\}\s*from\s*"@traycer-clients\/gui-app"/,
    );
    expect(mainSource).toMatch(
      /import\s*\{[^}]*\bteamsThemeToResolved\b[^}]*\}\s*from\s*"\.\/teams-host"/,
    );
  });
});
