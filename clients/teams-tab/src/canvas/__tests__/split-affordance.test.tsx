// @vitest-environment jsdom
/**
 * The sizing rule: a pane too small to split says so, and the control says
 * why.
 *
 * `MIN_PANE_PX = 240` had a consumer and no behaviour for eleven bundles —
 * `resize-handle.tsx` clamped a live drag against it and NOTHING decided
 * whether a split could happen at all. From the import alone "the sizing rule
 * exists" reads as true, which is why this file asserts the branch rather than
 * the constant.
 *
 * ─── Why the boundary is 488 and not 480 ───
 *
 * A split hands each of the two resulting panes half of the target's extent
 * along the axis, minus the handle: `(extent - SPLIT_HANDLE_PX) / 2`. With
 * `MIN_PANE_PX = 240` and `SPLIT_HANDLE_PX = 8` the smallest splittable extent
 * is 488, not 480. The pair (487, 488) is asserted deliberately — a rule that
 * forgot the handle passes every round-number test and produces two 239.5px
 * panes at exactly one width.
 *
 * ─── The fixtures are hostile on purpose ───
 *
 * No fixture equals `MIN_PANE_PX`, `SPLIT_HANDLE_PX`, `0`, or the value the
 * other axis carries. The wide-and-short case (1000 x 300) is the load-bearing
 * one: it is the only shape that can tell "the rule consults the split AXIS"
 * apart from "the rule reads whichever dimension happens to be to hand", and
 * both readings agree on every square fixture.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import {
  affordsSplit,
  resolveSplitAffordance,
  splitAxisExtentPx,
  SPLIT_HANDLE_PX,
  type PaneExtentPx,
} from "@/canvas/split-affordance";
import { MIN_PANE_PX } from "@/canvas/tile-tree-constants";
import { TileCanvas } from "@/canvas/tile-canvas";
import {
  EMPTY_CANVAS,
  openTile,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { makeBlankTile } from "@/canvas/opener";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The smallest extent that still yields two panes at or above the floor. */
const SPLITTABLE = MIN_PANE_PX * 2 + SPLIT_HANDLE_PX; // 488
const TOO_SMALL = SPLITTABLE - 1; // 487
const ROOMY = 1000;
/** Comfortably over the floor, comfortably under SPLITTABLE, and not 240. */
const SHORT = 300;

function extent(width: number, height: number): PaneExtentPx {
  return { width, height };
}

describe("splitAxisExtentPx", () => {
  it("reads width for a horizontal split and height for a vertical one", () => {
    const box = extent(ROOMY, SHORT);
    expect(splitAxisExtentPx(box, "right")).toBe(ROOMY);
    expect(splitAxisExtentPx(box, "left")).toBe(ROOMY);
    expect(splitAxisExtentPx(box, "bottom")).toBe(SHORT);
    expect(splitAxisExtentPx(box, "top")).toBe(SHORT);
  });

  it("treats null, zero, negative and NaN alike as unmeasured", () => {
    expect(splitAxisExtentPx(null, "right")).toBeNull();
    expect(splitAxisExtentPx(extent(0, 0), "right")).toBeNull();
    expect(splitAxisExtentPx(extent(-5, -5), "right")).toBeNull();
    expect(splitAxisExtentPx(extent(Number.NaN, Number.NaN), "right")).toBeNull();
  });
});

describe("affordsSplit", () => {
  it("refuses one pixel below the threshold and allows it at the threshold", () => {
    // The whole rule in two assertions. If these ever both pass with the
    // handle term deleted, the constants have drifted apart.
    expect(affordsSplit(extent(TOO_SMALL, ROOMY), "right").allowed).toBe(false);
    expect(affordsSplit(extent(SPLITTABLE, ROOMY), "right").allowed).toBe(true);
  });

  it("answers per axis — a wide, short pane splits right but not down", () => {
    const wideAndShort = extent(ROOMY, SHORT);
    expect(affordsSplit(wideAndShort, "right").allowed).toBe(true);
    expect(affordsSplit(wideAndShort, "bottom").allowed).toBe(false);
  });

  it("names the axis in the reason, so the tooltip is not merely 'too small'", () => {
    expect(affordsSplit(extent(TOO_SMALL, ROOMY), "right").reason).toBe(
      "Not enough width to split",
    );
    expect(affordsSplit(extent(ROOMY, SHORT), "bottom").reason).toBe(
      "Not enough height to split",
    );
  });

  it("ALLOWS when unmeasured — refusing would disable the canvas on first paint", () => {
    expect(affordsSplit(null, "right").allowed).toBe(true);
    expect(affordsSplit(extent(0, 0), "bottom").allowed).toBe(true);
    // NaN specifically: `NaN >= 240` is false, so an unguarded comparison
    // would refuse rather than allow, and the failure would look like the
    // rule working.
    expect(affordsSplit(extent(Number.NaN, Number.NaN), "right").allowed).toBe(
      true,
    );
  });

  it("carries no reason when it allows", () => {
    expect(affordsSplit(extent(ROOMY, ROOMY), "right").reason).toBe("");
  });
});

describe("resolveSplitAffordance", () => {
  it("reports the depth reason when the structure refuses, whatever the size", () => {
    const roomy = resolveSplitAffordance(false, extent(ROOMY, ROOMY), "right");
    expect(roomy).toEqual({ allowed: false, reason: "Nesting limit reached" });
    // Both refusals at once: the actionable one wins. A user can close a pane;
    // they cannot widen their phone.
    const neither = resolveSplitAffordance(false, extent(TOO_SMALL, SHORT), "right");
    expect(neither.reason).toBe("Nesting limit reached");
  });

  it("defers to the size rule when the structure allows", () => {
    expect(resolveSplitAffordance(true, extent(TOO_SMALL, ROOMY), "right")).toEqual(
      { allowed: false, reason: "Not enough width to split" },
    );
    expect(resolveSplitAffordance(true, extent(ROOMY, ROOMY), "right").allowed).toBe(
      true,
    );
  });
});

/**
 * ─── The wiring, which the pure tests above cannot reach ───
 *
 * jsdom lays nothing out: `getBoundingClientRect` returns zeroes, which this
 * rule reads as unmeasured and therefore ALLOWS. So the rule is inert in every
 * other test in this suite by construction — that is deliberate (see
 * `split-affordance.ts`) and it means a component test has to inject a
 * measurement or it asserts nothing.
 *
 * Stubbing `getBoundingClientRect` is the injection, and it exercises the real
 * path: the hook measures through exactly that call.
 */
function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

function oneTab(): CanvasState {
  return openTile({
    state: EMPTY_CANVAS,
    tile: makeBlankTile("host-1"),
    preview: false,
    ids: idSource(),
  });
}

function measureEveryElementAs(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
}

function drawCanvas(state: CanvasState): void {
  render(
    <FluentProvider theme={webLightTheme}>
      <TileCanvas
        state={state}
        onChange={() => {}}
        renderTile={() => <div />}
        ids={idSource()}
        hostId="host-1"
        onOpenFirst={() => {}}
      />
    </FluentProvider>,
  );
}

/**
 * Both controls' enabled state as ONE object, asserted with `toEqual`.
 *
 * Two separate boolean assertions would let the second silently not run once
 * the first fails, and would report "expected true, got false" without saying
 * which control. The object names both in the failure message.
 */
function bothEnabled(): { right: boolean; down: boolean } {
  const right = screen.getByTestId("pane-split-right") as HTMLButtonElement;
  const down = screen.getByTestId("pane-split-down") as HTMLButtonElement;
  return { right: !right.disabled, down: !down.disabled };
}

describe("the split controls, against a measured pane", () => {
  it("disables split-right and gives the WIDTH reason on a narrow pane", () => {
    measureEveryElementAs(TOO_SMALL, ROOMY);
    drawCanvas(oneTab());

    const right = screen.getByTestId("pane-split-right") as HTMLButtonElement;
    expect(right.disabled).toBe(true);
    // The tooltip is the point. Before this rule the string was hardcoded to
    // "Nesting limit reached", which is false here and sends the user off to
    // close panes that are not the problem.
    expect(right.getAttribute("title")).toBe("Not enough width to split");
  });

  it("leaves split-down enabled on that same pane — the axes are independent", () => {
    measureEveryElementAs(TOO_SMALL, ROOMY);
    drawCanvas(oneTab());

    const down = screen.getByTestId("pane-split-down") as HTMLButtonElement;
    expect(down.disabled).toBe(false);
    expect(down.getAttribute("title")).toBe("Split down");
  });

  it("enables both on a roomy pane", () => {
    measureEveryElementAs(ROOMY, ROOMY);
    drawCanvas(oneTab());

    expect(bothEnabled()).toEqual({ right: true, down: true });
  });

  it("enables both when nothing is measured, which is the jsdom default", () => {
    // No stub. This is the state every other canvas test runs in, asserted
    // once here so that "the rest of the suite is unaffected" is a checked
    // claim rather than an assumption.
    drawCanvas(oneTab());

    expect(bothEnabled()).toEqual({ right: true, down: true });
  });
});
