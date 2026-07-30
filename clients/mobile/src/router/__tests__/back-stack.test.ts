/**
 * The arithmetic of "back pops ONE level of the app's own stack".
 *
 * These are the cases the user named, expressed against the pure planner rather
 * than a DOM: back must not close the app except at the true root, must not
 * jump to root from a deep screen, and must close a modal before popping the
 * screen under it. `nav-host.test.tsx` covers the same contract end-to-end
 * through a real `popstate`; this file is where the edge arithmetic lives.
 */
import { describe, expect, it } from "vitest";
import {
  depthStamp,
  DEPTH_STATE_KEY,
  planBackConsumption,
  planDepthSync,
  readDepthStamp,
  readForeignDepth,
  SESSION_STATE_KEY,
  unitsToConsume,
} from "../back-stack";

const OURS = "session-a";
const THEIRS = "session-b";

describe("readDepthStamp", () => {
  it("reads a depth this page load stamped", () => {
    expect(readDepthStamp(depthStamp(3, OURS), OURS)).toBe(3);
  });

  it("reads through unrelated state left by another replaceState caller", () => {
    expect(readDepthStamp({ somethingElse: "x", ...depthStamp(2, OURS) }, OURS)).toBe(2);
  });

  it("ignores a DEEPER stamp from a previous page load — the stale-reload trap", () => {
    // The bug this guards: reading 2 here while committed depth is 1 makes
    // `unitsToConsume` clamp to zero, and back silently does nothing.
    expect(readDepthStamp(depthStamp(2, THEIRS), OURS)).toBe(0);
  });

  it.each([
    ["null (a fresh load)", null],
    ["undefined", undefined],
    ["an unstamped object (another replaceState caller won)", { other: 1 }],
    ["a string", "2"],
    ["a depth with no session", { [DEPTH_STATE_KEY]: 2 }],
    ["a session with no depth", { [SESSION_STATE_KEY]: OURS }],
    ["a non-integer depth", { ...depthStamp(0, OURS), [DEPTH_STATE_KEY]: 1.5 }],
    ["a negative depth", { ...depthStamp(0, OURS), [DEPTH_STATE_KEY]: -1 }],
    ["NaN", { ...depthStamp(0, OURS), [DEPTH_STATE_KEY]: Number.NaN }],
    ["an empty session id", { ...depthStamp(2, OURS), [SESSION_STATE_KEY]: "" }],
  ])("treats %s as the root entry", (_label, state) => {
    expect(readDepthStamp(state, OURS)).toBe(0);
  });
});

describe("readForeignDepth", () => {
  it("reports how deep a PREVIOUS page load was, so boot can tidy the stale entries", () => {
    expect(readForeignDepth(depthStamp(2, THEIRS), OURS)).toBe(2);
  });

  it("reports nothing for our own entries — an ordinary render must not look like a reload", () => {
    expect(readForeignDepth(depthStamp(2, OURS), OURS)).toBe(0);
  });

  it("reports nothing on a genuinely fresh load", () => {
    expect(readForeignDepth(null, OURS)).toBe(0);
  });
});

describe("planDepthSync", () => {
  it("pushes nothing when depth is unchanged — this is why an every-render call is safe", () => {
    expect(planDepthSync(2, 2)).toEqual({ push: [], go: 0 });
  });

  it("pushes one stamped entry per new level, in ascending order", () => {
    expect(planDepthSync(0, 3)).toEqual({ push: [1, 2, 3], go: 0 });
  });

  it("pushes a single entry for a single drill-in", () => {
    expect(planDepthSync(1, 2)).toEqual({ push: [2], go: 0 });
  });

  it("sheds the surplus when a nav action makes the app shallower (goto-chat over a deeper stack)", () => {
    expect(planDepthSync(3, 2)).toEqual({ push: [], go: -1 });
  });

  it("sheds several at once", () => {
    expect(planDepthSync(4, 1)).toEqual({ push: [], go: -3 });
  });
});

describe("unitsToConsume", () => {
  it("consumes one level for an ordinary single back", () => {
    expect(unitsToConsume(2, 1)).toBe(1);
  });

  it("consumes several when the user traverses several entries at once (long-press back)", () => {
    expect(unitsToConsume(3, 0)).toBe(3);
  });

  it("consumes nothing when the app itself issued the traversal (committed depth already updated)", () => {
    expect(unitsToConsume(2, 2)).toBe(0);
  });

  it("clamps rather than going negative on a FORWARD traversal", () => {
    expect(unitsToConsume(1, 3)).toBe(0);
  });
});

describe("planBackConsumption", () => {
  it("pops exactly one route frame from a deep screen — never jumping to root", () => {
    // chat (routeDepth 2) → epic. `popRoutes: 1`, emphatically not 2.
    expect(planBackConsumption(1, 0, 2)).toEqual({
      dismissLayers: 0,
      popRoutes: 1,
      allowExit: false,
    });
  });

  it("closes an open modal BEFORE its parent screen pops", () => {
    expect(planBackConsumption(1, 1, 2)).toEqual({
      dismissLayers: 1,
      popRoutes: 0,
      allowExit: false,
    });
  });

  it("closes the newest of two nested layers only", () => {
    expect(planBackConsumption(1, 2, 1)).toEqual({
      dismissLayers: 1,
      popRoutes: 0,
      allowExit: false,
    });
  });

  it("allows the platform default ONLY at the true root with nothing open", () => {
    expect(planBackConsumption(1, 0, 0)).toEqual({
      dismissLayers: 0,
      popRoutes: 0,
      allowExit: true,
    });
  });

  it("never reports allowExit while a layer is open at the root — a form on Fleet must not close the app", () => {
    // The create-epic screen: routeDepth 0, but a layer is open. This is the
    // exact case that closed the PWA and destroyed typed text.
    expect(planBackConsumption(1, 1, 0)).toEqual({
      dismissLayers: 1,
      popRoutes: 0,
      allowExit: false,
    });
  });

  it("spends layers first, then routes, on a multi-entry traversal", () => {
    expect(planBackConsumption(3, 1, 2)).toEqual({
      dismissLayers: 1,
      popRoutes: 2,
      allowExit: false,
    });
  });

  it("never tries to pop the fleet root, even when handed more units than there is depth", () => {
    expect(planBackConsumption(9, 1, 2)).toEqual({
      dismissLayers: 1,
      popRoutes: 2,
      allowExit: false,
    });
  });

  it("consumes nothing for zero units, and does not misreport that as an exit", () => {
    expect(planBackConsumption(0, 1, 2)).toEqual({
      dismissLayers: 0,
      popRoutes: 0,
      allowExit: false,
    });
  });
});
