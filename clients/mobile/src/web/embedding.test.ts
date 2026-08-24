import { describe, expect, it } from "vitest";
import {
  currentWindow,
  type FrameWindow,
  isCrossOriginFramed,
} from "./embedding";

/**
 * The three arms mirror the browser probe that established this module's
 * premise, so a reader can see the unit test and the measurement are about the
 * same three states. The same-origin arm is the one that matters: it is the
 * control that stops "framed" being used as a synonym for "cross-origin".
 */
function topLevel(): FrameWindow {
  const win = { location: { origin: "https://app.example" } } as {
    location: { origin: string };
    parent?: FrameWindow;
  };
  win.parent = win as FrameWindow;
  return win as FrameWindow;
}

function sameOriginFrame(): FrameWindow {
  return {
    location: { origin: "https://app.example" },
    parent: { location: { origin: "https://app.example" } } as FrameWindow,
  };
}

function crossOriginFrame(): FrameWindow {
  return {
    location: { origin: "https://app.example" },
    // Reading `location` throws, which is what the browser does across origins.
    get parent(): FrameWindow {
      return {
        get location(): { origin: string } {
          throw new DOMException("Blocked a frame", "SecurityError");
        },
      } as FrameWindow;
    },
  };
}

describe("isCrossOriginFramed", () => {
  it("is false at the top level", () => {
    expect(isCrossOriginFramed(topLevel())).toBe(false);
  });

  it("is FALSE in a same-origin frame - framed is not the question", () => {
    // The control. If this ever returns true the module has silently become
    // `window !== window.parent`, which is the thing it exists not to be.
    expect(isCrossOriginFramed(sameOriginFrame())).toBe(false);
  });

  it("is true in a cross-origin frame", () => {
    expect(isCrossOriginFramed(crossOriginFrame())).toBe(true);
  });

  it("resolves true when even reading `parent` throws", () => {
    const hostile = {
      location: { origin: "https://app.example" },
      get parent(): FrameWindow {
        throw new DOMException("Blocked", "SecurityError");
      },
    } as FrameWindow;
    expect(isCrossOriginFramed(hostile)).toBe(true);
  });

  it("is false when there is no window at all", () => {
    // Node/SSR. Asserted positively so the absence of a window cannot be the
    // reason a later "not embedded" reading looks correct.
    expect(isCrossOriginFramed(null)).toBe(false);
  });

  it("currentWindow finds jsdom's window, so the null case above is not the norm", () => {
    // The control on the control. Without this, `isCrossOriginFramed(null)`
    // returning false would be indistinguishable from a lookup that never finds
    // a window anywhere - and every production call would take the null path.
    expect(currentWindow()).not.toBeNull();
    expect(isCrossOriginFramed(currentWindow())).toBe(false);
  });
});
