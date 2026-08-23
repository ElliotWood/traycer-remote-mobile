import { describe, expect, it, vi, type Mock } from "vitest";
import {
  applyTeamsDeepLink,
  browserDeepLinkWindow,
  readTeamsDeepLinkRoute,
  type DeepLinkWindow,
} from "./teams-deep-link";

/**
 * A fake window whose three actions are observable.
 *
 * `currentHash` is a plain property rather than a getter because no test here
 * needs it to change mid-call, and a getter would invite a reader to think it
 * does.
 */
interface FakeWindow extends DeepLinkWindow {
  readonly setHash: Mock<(route: string) => void>;
  readonly reload: Mock<() => void>;
  readonly assign: Mock<(route: string) => void>;
}

function fakeWindow(overrides: {
  readonly isSubpath?: boolean;
  readonly currentHash?: string;
}): FakeWindow {
  // The two settable fields are named rather than spread from a
  // `Partial<DeepLinkWindow>`: a spread widens the three mocks back to plain
  // functions, so the test loses the ability to inspect the calls it exists to
  // inspect - and it does so as a type error four lines away from the cause.
  return {
    isSubpath: overrides.isSubpath ?? true,
    currentHash: overrides.currentHash ?? "",
    setHash: vi.fn<(route: string) => void>(),
    reload: vi.fn<() => void>(),
    assign: vi.fn<(route: string) => void>(),
  };
}

/** What `clients/teams-bot` actually puts in `context.subEntityId`. */
const REAL_ROUTE = "/epics/epic-1/epic-1?focusArtifactId=chat-1";

describe("readTeamsDeepLinkRoute", () => {
  it("accepts the route the bot emits, hyphenated ids and all", () => {
    // Not a formality. The first draft of the character check was a regex
    // whose class included a literal hyphen, which rejected every uuid - i.e.
    // every real link - while passing a test written with `a/b` style ids.
    expect(readTeamsDeepLinkRoute(REAL_ROUTE)).toBe(REAL_ROUTE);
    expect(
      readTeamsDeepLinkRoute(
        "/epics/9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef/9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef?focusArtifactId=29feb5f0-b273-4906-a87b-a8a71038952c",
      ),
    ).not.toBeNull();
  });

  it("is null for the absent case, which is most loads", () => {
    // `page.subPageId` is optional in the SDK's own types and absent on every
    // open that is not a deep link.
    expect(readTeamsDeepLinkRoute(undefined)).toBeNull();
    expect(readTeamsDeepLinkRoute(null)).toBeNull();
    expect(readTeamsDeepLinkRoute("")).toBeNull();
    expect(readTeamsDeepLinkRoute("   ")).toBeNull();
  });

  it("rejects a relative route, which would resolve against wherever we are", () => {
    expect(readTeamsDeepLinkRoute("epics/e/e")).toBeNull();
    expect(readTeamsDeepLinkRoute("../settings")).toBeNull();
  });

  it("rejects a protocol-relative path, because that names another origin", () => {
    expect(readTeamsDeepLinkRoute("//evil.invalid/epics/e/e")).toBeNull();
  });

  it("rejects a nested fragment", () => {
    // The route is about to BECOME a fragment. One that carries its own `#`
    // would be truncated by the router at the first one, landing somewhere
    // that is not what the card asked for and is not obviously wrong either.
    expect(readTeamsDeepLinkRoute("/epics/e/e#/settings")).toBeNull();
  });

  it("rejects whitespace and control characters", () => {
    // Built with char codes rather than typed: a control character written
    // into a source file is invisible in review, and writing THIS file put two
    // real ones in it on the first attempt.
    const ctrl = (code: number): string => `/epics/e${String.fromCharCode(code)}e`;
    expect(readTeamsDeepLinkRoute("/epics/e e/e")).toBeNull();
    expect(readTeamsDeepLinkRoute("/epics/e\te")).toBeNull();
    expect(readTeamsDeepLinkRoute(ctrl(0x00))).toBeNull();
    expect(readTeamsDeepLinkRoute(ctrl(0x0a))).toBeNull();
    expect(readTeamsDeepLinkRoute(ctrl(0x1f))).toBeNull();
    expect(readTeamsDeepLinkRoute(ctrl(0x7f))).toBeNull();
    // The control: the same shape with an ordinary character is accepted, so
    // the rows above are about the code point and not about the shape.
    expect(readTeamsDeepLinkRoute(ctrl(0x78))).toBe("/epics/exe");
  });
});

describe("applyTeamsDeepLink", () => {
  it("puts the route in the fragment and reloads, on a subpath deploy", () => {
    // The reload is the feature. @tanstack/history registers a `popstate`
    // listener and NO `hashchange` listener, so setting the hash alone changes
    // the address bar and leaves the view where it was.
    const target = fakeWindow({ isSubpath: true, currentHash: "" });

    expect(applyTeamsDeepLink(REAL_ROUTE, target)).toBe("applied");

    expect(target.setHash).toHaveBeenCalledWith(REAL_ROUTE);
    expect(target.reload).toHaveBeenCalledTimes(1);
    expect(target.assign).not.toHaveBeenCalled();
  });

  it("REGRESSION: does not set the hash WITHOUT reloading", () => {
    // Stated as its own row because "setHash was called" is what a naive
    // implementation also satisfies, and that implementation is a dead link.
    const target = fakeWindow({ isSubpath: true });
    applyTeamsDeepLink(REAL_ROUTE, target);
    expect(target.setHash.mock.calls.length).toBe(target.reload.mock.calls.length);
  });

  /**
   * THE LOOP GUARD. Teams delivers the context to every load of the tab,
   * including the one the reload above causes. Without this comparison the
   * second boot finds the same `subPageId`, reloads again, and the tab spins
   * forever - a failure that would only ever appear in a real Teams client,
   * i.e. in front of the one person nobody can ask.
   */
  it("does nothing when the fragment is already that route", () => {
    const target = fakeWindow({ isSubpath: true, currentHash: `#${REAL_ROUTE}` });

    expect(applyTeamsDeepLink(REAL_ROUTE, target)).toBe("already-there");

    expect(target.setHash).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("still applies when the fragment holds a DIFFERENT route", () => {
    // The control for the row above: a guard that answered "already there" to
    // everything would pass that test and break every deep link.
    const target = fakeWindow({ isSubpath: true, currentHash: "#/epics/other/other" });

    expect(applyTeamsDeepLink(REAL_ROUTE, target)).toBe("applied");
    expect(target.reload).toHaveBeenCalledTimes(1);
  });

  it("navigates by path on a root deploy, with no fragment", () => {
    const target = fakeWindow({ isSubpath: false, currentHash: "" });

    expect(applyTeamsDeepLink(REAL_ROUTE, target)).toBe("applied");

    expect(target.assign).toHaveBeenCalledWith(REAL_ROUTE);
    expect(target.setHash).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("touches NOTHING for a route it rejects", () => {
    // The paired positive assertion matters: "reload was not called" is also
    // true of an implementation that does nothing at all.
    for (const bad of [undefined, "", "epics/e/e", "//evil.invalid"]) {
      const target = fakeWindow({ isSubpath: true });
      expect(applyTeamsDeepLink(bad, target)).toBe("ignored");
      expect(target.setHash).not.toHaveBeenCalled();
      expect(target.reload).not.toHaveBeenCalled();
      expect(target.assign).not.toHaveBeenCalled();
    }
    expect(applyTeamsDeepLink(REAL_ROUTE, fakeWindow({}))).toBe("applied");
  });
});

describe("browserDeepLinkWindow", () => {
  it("reads the vite base the way gui-app's own isSubpathDeploy does", () => {
    // `/next/` is the deployed Teams tab and the one that matters; the rule is
    // "anything but `/`", and it decides hash versus path history on both
    // sides of the link.
    expect(browserDeepLinkWindow("/next/").isSubpath).toBe(true);
    expect(browserDeepLinkWindow("/next").isSubpath).toBe(true);
    expect(browserDeepLinkWindow("/").isSubpath).toBe(false);
    expect(browserDeepLinkWindow("//").isSubpath).toBe(false);
  });
});
