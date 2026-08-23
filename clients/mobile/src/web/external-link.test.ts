/**
 * Every assertion here is about WHAT WAS REPORTED and WHAT THE USER CAN SEE,
 * never about a function having been called - because the defect this module
 * exists for is a call that was made, succeeded or failed, and reported
 * nothing either way.
 *
 * The load-bearing case is `does not treat window.open's null as a failure`.
 * That is the one that fails if a later reader "fixes" the discarded return
 * value, which is the single most plausible edit to this module and the one the
 * browser probe exists to forbid.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_LINK_NOTE_TESTID,
  EXTERNAL_LINK_NOTE_TEXT,
  openExternalUrl,
  resetTeamsLinkOpenerForTests,
  setTeamsLinkOpener,
  type ExternalLinkOutcome,
} from "./external-link";

const URL_A = "https://platform.traycer.test/device?user_code=ABCD-1234";
const URL_B = "https://example.test/second";

function harness() {
  const reported: ExternalLinkOutcome[] = [];
  const windowCalls: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  return {
    reported,
    windowCalls,
    container,
    report: (outcome: ExternalLinkOutcome): void => {
      reported.push(outcome);
    },
    attemptWindow: (url: string): boolean => {
      windowCalls.push(url);
      return true;
    },
  };
}

function noteText(): string | null {
  const note = document.querySelector(
    `[data-testid="${EXTERNAL_LINK_NOTE_TESTID}"]`,
  );
  return note === null ? null : (note.textContent ?? "");
}

function noteUrl(): string | null {
  const el = document.querySelector(
    `[data-testid="${EXTERNAL_LINK_NOTE_TESTID}-url"]`,
  );
  return el === null ? null : (el.textContent ?? "");
}

afterEach(() => {
  resetTeamsLinkOpenerForTests();
  document.body.replaceChildren();
  delete document.documentElement.dataset.externalOpen;
  vi.restoreAllMocks();
});

describe("openExternalUrl - the Teams path", () => {
  it("uses the Teams opener when one is registered, and does not touch window.open", async () => {
    const h = harness();
    const teamsOpen = vi.fn(async () => undefined);

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("teams");
    expect(h.reported).toEqual(["teams"]);
    expect(teamsOpen).toHaveBeenCalledWith(URL_A);
    // Positive AND negative: a success that also fired the window path would
    // open the link twice, which is a real user-visible defect and not a
    // stylistic one.
    expect(h.windowCalls).toEqual([]);
    expect(noteText()).toBeNull();
  });

  it("reports teams-refused - NOT unavailable - when the Teams host rejects", async () => {
    const h = harness();

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen: async () => {
        throw new Error("host refused");
      },
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("teams-refused");
    // The distinction the whole outcome union exists for: a refusal by a host
    // that answered is a different fact from having nowhere to send the link,
    // and they want different advice.
    expect(h.reported).toEqual(["teams-refused"]);
  });

  it("still attempts the window fallback after a Teams refusal, without changing the reported fact", async () => {
    const h = harness();

    await openExternalUrl({
      url: URL_A,
      teamsOpen: async () => {
        throw new Error("host refused");
      },
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(h.windowCalls).toEqual([URL_A]);
    // The fallback is unverifiable, so it must not be allowed to overwrite a
    // measured fact with a guess. Asserted as the WHOLE report sequence, so a
    // later `report("window-unverified")` appended after it fails here.
    expect(h.reported).toEqual(["teams-refused"]);
  });

  it("shows the user the URL when Teams refuses, because a Teams tab has no address bar", async () => {
    const h = harness();

    await openExternalUrl({
      url: URL_A,
      teamsOpen: async () => {
        throw new Error("host refused");
      },
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(noteText()).toContain(EXTERNAL_LINK_NOTE_TEXT);
    // The actual address, not a placeholder and not a truncation: the note's
    // entire purpose is that it can be copied.
    expect(noteUrl()).toBe(URL_A);
  });

  it("replaces a stale note rather than stacking, so the URL shown is the one just clicked", async () => {
    const h = harness();
    const refuse = async (): Promise<void> => {
      throw new Error("host refused");
    };

    await openExternalUrl({
      url: URL_A,
      teamsOpen: refuse,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });
    await openExternalUrl({
      url: URL_B,
      teamsOpen: refuse,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(
      document.querySelectorAll(`[data-testid="${EXTERNAL_LINK_NOTE_TESTID}"]`),
    ).toHaveLength(1);
    expect(noteUrl()).toBe(URL_B);
  });

  it("renders no note on the ordinary window path - a note on every PWA click would be noise", async () => {
    const h = harness();

    await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(noteText()).toBeNull();
  });
});

describe("openExternalUrl - the window path", () => {
  it("reports window-unverified, and the name is the point", async () => {
    const h = harness();

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("window-unverified");
    expect(h.reported).toEqual(["window-unverified"]);
    expect(h.windowCalls).toEqual([URL_A]);
  });

  it("DOES NOT treat window.open's null return as a failure", async () => {
    // THE REGRESSION GUARD. Measured in Chromium: with `noopener` the call
    // returns `null` when it opens a page AND when it is refused - three arms,
    // one of which opened nothing. So a `w === null` check would report failure
    // on every successful open on every surface. This asserts the module never
    // acquires one.
    const h = harness();
    const openSpy = vi.fn(() => null);
    vi.stubGlobal("window", { ...globalThis.window, open: openSpy });

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      report: h.report,
      container: h.container,
    });

    expect(openSpy).toHaveBeenCalledWith(URL_A, "_blank", "noopener,noreferrer");
    // `null` came back, and the outcome is still the handed-over state.
    expect(outcome).toBe("window-unverified");
    expect(h.reported).toEqual(["window-unverified"]);
    expect(noteText()).toBeNull();
  });

  it("keeps noopener,noreferrer - the opened page must not get a handle back into a signed-in app", async () => {
    const h = harness();
    const openSpy = vi.fn(() => null);
    vi.stubGlobal("window", { ...globalThis.window, open: openSpy });

    await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      report: h.report,
      container: h.container,
    });

    // Asserted as the whole argument list rather than `toHaveBeenCalled`: the
    // features string is the security property, and it is exactly the thing a
    // reader trying to recover a usable return value would delete.
    expect(openSpy.mock.calls).toEqual([
      [URL_A, "_blank", "noopener,noreferrer"],
    ]);
  });

  it("reports unavailable when there is no window.open at all", async () => {
    const h = harness();

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      attemptWindow: () => false,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("unavailable");
    expect(h.reported).toEqual(["unavailable"]);
  });

  it("reports unavailable when window.open throws rather than returning", async () => {
    const h = harness();
    vi.stubGlobal("window", {
      ...globalThis.window,
      open: () => {
        throw new Error("blocked by embedder");
      },
    });

    const outcome = await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("unavailable");
  });
});

describe("registration", () => {
  it("routes through a registered opener without it being passed in", async () => {
    const h = harness();
    const teamsOpen = vi.fn(async () => undefined);
    setTeamsLinkOpener(teamsOpen);

    const outcome = await openExternalUrl({
      url: URL_A,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("teams");
    expect(teamsOpen).toHaveBeenCalledWith(URL_A);
  });

  it("falls back to the window path once the opener is cleared", async () => {
    const h = harness();
    setTeamsLinkOpener(vi.fn(async () => undefined));
    setTeamsLinkOpener(null);

    const outcome = await openExternalUrl({
      url: URL_A,
      attemptWindow: h.attemptWindow,
      report: h.report,
      container: h.container,
    });

    expect(outcome).toBe("window-unverified");
    expect(h.windowCalls).toEqual([URL_A]);
  });
});

describe("reporting", () => {
  it("stamps <html data-external-open> by default, so a probe can read it", async () => {
    const h = harness();

    await openExternalUrl({
      url: URL_A,
      teamsOpen: null,
      attemptWindow: h.attemptWindow,
      container: h.container,
    });

    expect(document.documentElement.dataset.externalOpen).toBe(
      "window-unverified",
    );
    // The ATTRIBUTE name, not the dataset key. A probe reads
    // `[data-external-open]` from outside; `dataset.externalOpen` is the
    // camel-cased view of it, and asserting only the latter would leave the
    // name the probe depends on unpinned by anything.
    expect(
      document.documentElement.getAttribute("data-external-open"),
    ).toBe("window-unverified");
  });

  it("stamps the refusal, which is the reading a probe on a real tab needs", async () => {
    const h = harness();

    await openExternalUrl({
      url: URL_A,
      teamsOpen: async () => {
        throw new Error("host refused");
      },
      attemptWindow: h.attemptWindow,
      container: h.container,
    });

    expect(document.documentElement.dataset.externalOpen).toBe("teams-refused");
  });
});

/**
 * SOURCE contracts, in this package's existing idiom (`teams-theme-param.test.ts`,
 * `teams-host.test.ts`), and they exist because of a defect this shell shipped
 * one module over: `data-push` was absent on the Teams tab for weeks while every
 * function-level test of `push-subscription.ts` stayed green, because the bug
 * was not in the function - it was in whether the caller ever called it.
 *
 * Exactly the same failure is available here twice over. A perfect
 * `external-link.ts` that `Browser.open` does not delegate to, or a
 * `setTeamsLinkOpener` that `main.tsx` never registers, leaves every assertion
 * above passing and the Teams tab behaving precisely as it does today.
 */
describe("the callers actually call it", () => {
  const read = (file: string): string =>
    readFileSync(join(process.cwd(), "src", "web", file), "utf8");
  const shimSource = read("capacitor-web-shim.ts");
  const mainSource = read("main.tsx");

  it("read the two files it is asserting about", () => {
    // Closes the "found but empty" case, so no row below can pass by matching
    // nothing. A wrong path throws above.
    expect(shimSource.length).toBeGreaterThan(1000);
    expect(mainSource.length).toBeGreaterThan(1000);
    expect(shimSource).toContain("SecureStoragePlugin");
    expect(mainSource).toContain("createRoot");
  });

  it("Browser.open delegates to this module", () => {
    expect(shimSource).toContain("openExternalUrl");
    expect(shimSource).toContain('from "./external-link"');
  });

  it("the shim no longer calls window.open itself - THE SHIPPED DEFECT", () => {
    // The bare call is the whole bug: it cannot report a refusal, and sign-in
    // goes through it. Asserted as absence in the shim specifically, not
    // repo-wide - `external-link.ts` is where that call now legitimately lives.
    expect(shimSource).not.toContain("window.open(");
  });

  it("main.tsx registers the Teams opener with the handshake", () => {
    expect(mainSource).toContain("onLinkOpener: setTeamsLinkOpener");
    expect(mainSource).toContain('from "./external-link"');
  });

  it("registers it on the SAME handshake call that carries the theme", () => {
    // A second `initializeTeamsHost(...)` would load the SDK twice and race two
    // handshakes; the assertion pins the registration inside the existing call
    // rather than merely somewhere in the file.
    const call = mainSource.slice(mainSource.indexOf("initializeTeamsHost({"));
    expect(call).toContain("onTheme:");
    expect(call).toContain("onLinkOpener:");
    expect(mainSource.split("initializeTeamsHost({")).toHaveLength(2);
  });
});
