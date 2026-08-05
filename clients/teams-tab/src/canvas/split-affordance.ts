/**
 * Whether a pane is physically big enough to split — the pixel half of the
 * split decision, alongside `canSplitPane`'s structural half.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: `MIN_PANE_PX` had a consumer and no behaviour
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `tile-tree-constants.ts` exports `MIN_PANE_PX = 240` and `resize-handle.tsx`
 * applies it while a drag is in flight. **Nothing branched on it to decide
 * whether the canvas may split at all.** From the import alone, "the sizing
 * rule exists" reads as true — the same shape as a renderer with no producer.
 *
 * Splitting a 300px pane produced two 146px panes and no code objected. The
 * resize clamp cannot undo that: `computeResizeHandleSizes` takes
 * `adjacentMinSize = min(minSize, pairSize / 2)`, so on a container too small
 * to honour the floor it deliberately degrades to equal halves rather than
 * refusing. **The clamp is a drag constraint, not an invariant.**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE MEASURES. IT DOES NOT ASSUME A WIDTH.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This is deliberately NOT the breakpoint table the canvas audit sketched
 * (`>=720 -> 3 panes`, `480-719 -> 2`, `<480 -> 1`). Those are fixed numbers,
 * they need viewport readings nobody has taken inside Teams, and
 * `viewport-readout.tsx` is right that picking them from an assumed width
 * would be "a decision wearing a measurement's clothes".
 *
 * A rule that DIVIDES needs no such reading. Both of `insertPaneAtEdge`'s
 * branches halve the target pane's own extent along the split axis — the
 * merge branch splices `targetSize / 2` in twice, the wrap branch creates
 * `[0.5, 0.5]` over the target's box. So the question is exactly:
 *
 *     does half of THIS pane, minus the handle, still clear MIN_PANE_PX?
 *
 * Every term is measured from the live element. No viewport constant appears
 * anywhere in this file, which is why it did not have to wait for the
 * readings. The readings are still wanted — they answer "does it read right",
 * which is a different question and still Elliot's.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS DIVERGES FROM gui-app, ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The canvas core is lifted verbatim from `clients/gui-app` and guarded by
 * `tools/check-canvas-core.mjs`. **gui-app has no split-affordance rule
 * either** — measured, not assumed: `MIN_PANE_PX` appears there only in
 * `resize-handle-sizes.ts`, `resize-handle.tsx` and `split-container.tsx`,
 * all resize clamping. So this is a divergence from the reference, and the
 * usual verdict on those is "don't — it makes the port drift".
 *
 * Taken anyway, because the environments genuinely differ: gui-app is a
 * desktop window, and this renders inside a Teams personal-tab iframe that on
 * Teams mobile can be narrower than `2 * MIN_PANE_PX` outright. The rule is
 * inert on any surface wide enough not to need it, so gui-app would observe
 * no behaviour change if it ever adopted it.
 *
 * **The divergence is confined to files the drift gate does not cover.** This
 * module is new, and nothing here edits any of the four locked pairs — which
 * is also why `SPLIT_HANDLE_PX` is defined below rather than added to
 * `tile-tree-constants.ts`, where it would otherwise belong.
 */
import type { EdgeDropPosition } from "./tile-tree";
import { MIN_PANE_PX } from "./tile-tree-constants";

/**
 * The resize handle's own thickness, subtracted before halving because it is
 * taken out of the pair's shared extent.
 *
 * Lives here rather than in `tile-tree-constants.ts` — its natural home, per
 * that file's own docblock about shared geometry — because that file is byte-
 * locked against gui-app by `tools/check-canvas-core.mjs`. Adding a constant
 * to it would redden the drift gate, and "fixing" that by editing gui-app's
 * copy to match would be the tail wagging the dog. `resize-handle.tsx` imports
 * this so there is still exactly one source of truth for the number.
 */
export const SPLIT_HANDLE_PX = 8;

/** A measured pane box. Both fields are CSS pixels. */
export interface PaneExtentPx {
  readonly width: number;
  readonly height: number;
}

/**
 * Why a split is unavailable, or the empty string when it is available.
 *
 * A boolean would be enough to disable the button and would make the tooltip
 * lie: `tab-strip.tsx` already renders "Nesting limit reached" whenever a
 * split is refused, which is simply untrue when the reason is width. A
 * control that gives the wrong reason is worse than one that gives none —
 * the user acts on it.
 */
export interface SplitAffordance {
  readonly allowed: boolean;
  readonly reason: string;
}

export const SPLIT_ALLOWED: SplitAffordance = { allowed: true, reason: "" };

/**
 * The extent along the axis a split at `position` would divide, or `null`
 * when it has not been measured.
 *
 * ⚠️ `null` AND ZERO BOTH MEAN "UNKNOWN", AND BOTH MUST ALLOW THE SPLIT.
 *
 * An unmeasured pane is the state on first paint, before layout, and in every
 * jsdom test — `getBoundingClientRect` returns zeroes there. Treating unknown
 * as "too small" would disable splitting on the real first render and across
 * the whole existing suite, i.e. it would look like the rule working while
 * actually being a bug that never measured anything. Unknown means allow, and
 * the rule engages the moment a real number arrives.
 *
 * The cost of that choice is stated rather than hidden: **this rule is inert
 * in jsdom.** A component test cannot observe it without injecting an extent,
 * so the tests drive `affordsSplit` directly with real numbers and inject a
 * measurement where they exercise the wiring.
 */
export function splitAxisExtentPx(
  extent: PaneExtentPx | null,
  position: EdgeDropPosition,
): number | null {
  if (extent === null) return null;
  const along =
    position === "left" || position === "right" ? extent.width : extent.height;
  // `> 0` rather than `!== 0`: a negative or NaN rect is as unmeasured as a
  // zero one, and `NaN >= x` is false, so an un-guarded NaN would silently
  // refuse every split instead of allowing it.
  return Number.isFinite(along) && along > 0 ? along : null;
}

/**
 * Would the two panes resulting from this split each still clear
 * `MIN_PANE_PX`?
 */
export function affordsSplit(
  extent: PaneExtentPx | null,
  position: EdgeDropPosition,
): SplitAffordance {
  const along = splitAxisExtentPx(extent, position);
  if (along === null) return SPLIT_ALLOWED;
  if ((along - SPLIT_HANDLE_PX) / 2 >= MIN_PANE_PX) return SPLIT_ALLOWED;
  return {
    allowed: false,
    reason:
      position === "left" || position === "right"
        ? "Not enough width to split"
        : "Not enough height to split",
  };
}

/**
 * Combine the structural answer (`canSplitPane`) with the pixel one.
 *
 * Order matters for the MESSAGE, not the result: when a pane is both nested
 * to the limit and too narrow, the depth reason is reported. It is the one
 * the user can act on by closing a pane, whereas the width is a property of
 * their screen.
 */
export function resolveSplitAffordance(
  structurallyAllowed: boolean,
  extent: PaneExtentPx | null,
  position: EdgeDropPosition,
): SplitAffordance {
  if (!structurallyAllowed) {
    return { allowed: false, reason: "Nesting limit reached" };
  }
  return affordsSplit(extent, position);
}
