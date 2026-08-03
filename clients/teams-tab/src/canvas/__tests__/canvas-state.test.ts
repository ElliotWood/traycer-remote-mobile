/**
 * The canvas transitions, tested on the properties that are easy to break and
 * invisible when broken.
 *
 * Two of these guard behaviours a screenshot cannot show and a type cannot
 * enforce — preview replacement and close-focus ordering. They are the reason
 * the canvas feels like the desktop rather than looking like it, and they are
 * exactly what gets quietly lost in a port.
 *
 * Every case below states the mutation that must redden it, because a test
 * whose failure mode nobody has named is a test nobody has checked.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS,
  activePane,
  closePane,
  closeTab,
  openTile,
  promotePreview,
  reachableInstanceIds,
  reconcile,
  resizeSplit,
  setActiveTab,
  splitPane,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { findPaneById, firstPaneId } from "@/canvas/tile-tree";
import type { TileRef } from "@/canvas/tile-ref";

/** Deterministic ids, so assertions can name the shape they expect. */
function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => {
      panes += 1;
      return `p${panes}`;
    },
    groupId: () => {
      groups += 1;
      return `g${groups}`;
    },
  };
}

/**
 * `id` is explicit at every call site rather than defaulted — the package's
 * `no-restricted-syntax` rule, and it argues for itself here: the whole point
 * of the dedup test below is that `id` and `instanceId` are DIFFERENT things,
 * and a default that quietly makes them equal is the exact confusion under
 * test.
 */
function chat(instanceId: string, id: string): TileRef {
  return {
    type: "chat",
    id,
    instanceId,
    name: `chat ${id}`,
    hostId: "host-1",
  };
}

function blank(instanceId: string): TileRef {
  return {
    type: "blank",
    id: instanceId,
    instanceId,
    name: "",
    hostId: "host-1",
  };
}

/** Open several tabs into one pane, permanently. */
function withTabs(...instanceIds: ReadonlyArray<string>): {
  state: CanvasState;
  ids: IdSource;
} {
  const ids = idSource();
  let state = EMPTY_CANVAS;
  for (const instanceId of instanceIds) {
    state = openTile({ state, tile: chat(instanceId, instanceId), ids });
  }
  return { state, ids };
}

/** I1: the payload key set equals the instanceIds reachable from the tree. */
function expectInvariantI1(state: CanvasState): void {
  expect([...Object.keys(state.tilesByInstanceId)].sort()).toEqual(
    [...reachableInstanceIds(state)].sort(),
  );
}

describe("opening", () => {
  it("seeds a root pane from an empty canvas and focuses it", () => {
    const ids = idSource();
    const state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "a"), ids });

    expect(state.root?.kind).toBe("pane");
    expect(state.activePaneId).toBe("p1");
    expect(activePane(state)?.activeTabId).toBe("a");
    expectInvariantI1(state);
  });

  it("does NOT dedup two tabs on the same content", () => {
    /*
     * The defect this guards presents as "the second copy won't open", not as
     * an error. Both tabs carry the same content `id` and different
     * `instanceId`s — keying identity on `id` would silently collapse them.
     *
     * Mutation: make `openTile` return `state` when a tile with the same `id`
     * is already open. Length goes 2 → 1.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("i1", "same"), ids });
    state = openTile({ state, tile: chat("i2", "same"), ids });

    expect(activePane(state)?.tabInstanceIds).toEqual(["i1", "i2"]);
    expect(Object.keys(state.tilesByInstanceId)).toHaveLength(2);
  });
});

describe("preview tabs", () => {
  it("replaces the previous preview in place instead of accumulating", () => {
    /*
     * Browsing three artifacts must cost ONE tab. Mutation: drop the
     * `replacedId` removal in `openTile` — the strip grows to three and the
     * user starts closing things instead of looking at them.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "a"), ids });
    state = openTile({ state, tile: chat("b", "b"), preview: true, ids });
    state = openTile({ state, tile: chat("c", "c"), preview: true, ids });

    expect(activePane(state)?.tabInstanceIds).toEqual(["a", "c"]);
    expect(activePane(state)?.previewTabId).toBe("c");
    // The replaced preview's PAYLOAD must go too, or it leaks — invisibly,
    // because nothing renders it.
    expect(state.tilesByInstanceId["b"]).toBeUndefined();
    expectInvariantI1(state);
  });

  it("keeps a promoted tab when the next preview arrives", () => {
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "a"), preview: true, ids });
    state = promotePreview(state, "p1");
    state = openTile({ state, tile: chat("b", "b"), preview: true, ids });

    expect(activePane(state)?.tabInstanceIds).toEqual(["a", "b"]);
    expect(activePane(state)?.previewTabId).toBe("b");
  });

  it("promoting is a no-op when there is no preview", () => {
    // Guards a double-click on an already-permanent tab from clearing state.
    const { state } = withTabs("a", "b");
    expect(promotePreview(state, "p1")).toBe(state);
  });
});

describe("closing focuses by activation history, not by position", () => {
  it("returns to the previously active tab rather than the left neighbour", () => {
    /*
     * THE case this file exists for. Open a, b, c; visit a; then close a.
     * Position says focus `b` (index 0 after removal). History says `c` — the
     * tab the user was on before they came back to `a`.
     *
     * Mutation: replace `byHistory ?? byPosition` with `byPosition` in
     * `removeFromPane`. This flips to "b" and the two cases below stay green,
     * which is why this one is separate from them.
     */
    const { state: opened } = withTabs("a", "b", "c");
    const visited = setActiveTab(opened, "p1", "a");
    const closed = closeTab(visited, "p1", "a");

    expect(findPaneById(closed.root, "p1")?.activeTabId).toBe("c");
  });

  it("falls back to the tab that took the closed one's index", () => {
    /*
     * With no surviving history the fallback must be positional and LOCAL —
     * "the list closed up under my cursor", not "jump to the far left".
     * Mutation: use `tabInstanceIds[0]`. Expected flips "c" → "a".
     */
    const { state } = withTabs("a", "b", "c");
    // `withTabs` activates each in turn, so history is c, b, a. Closing `c`
    // (the active one) leaves history [b, a] — so force the bare case by
    // closing a pane-final tab instead: build a fresh pane with no history
    // beyond the active tab.
    const bare: CanvasState = {
      ...state,
      root: {
        kind: "pane",
        id: "p1",
        tabInstanceIds: ["a", "b", "c"],
        activeTabId: "b",
        previewTabId: null,
        activationHistory: ["b"],
      },
    };
    const closed = closeTab(bare, "p1", "b");
    expect(findPaneById(closed.root, "p1")?.activeTabId).toBe("c");
  });

  it("closing a non-active tab leaves focus alone", () => {
    const { state } = withTabs("a", "b", "c");
    const closed = closeTab(state, "p1", "a");
    expect(findPaneById(closed.root, "p1")?.activeTabId).toBe("c");
    expectInvariantI1(closed);
  });

  it("closing the last tab closes the pane", () => {
    const ids = idSource();
    const state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "a"), ids });
    const closed = closeTab(state, "p1", "a");

    expect(closed.root).toBeNull();
    expect(closed.activePaneId).toBeNull();
    expect(closed.tilesByInstanceId).toEqual({});
  });
});

describe("splitting", () => {
  it("wraps the target in a group and focuses the new pane", () => {
    const { state, ids } = withTabs("a");
    const split = splitPane({
      state,
      paneId: "p1",
      position: "right",
      tile: blank("n1"),
      ids,
    });

    expect(split.root?.kind).toBe("group");
    expect(split.activePaneId).toBe("p2");
    expect(split.sizesByGroupId["g1"]).toEqual([0.5, 0.5]);
    expectInvariantI1(split);
  });

  it("REFUSES rather than throws past the depth limit", () => {
    /*
     * MAX_TREE_DEPTH is 4. Alternating directions deepens on every split, so
     * this walks past the limit and asserts the state is returned unchanged.
     * A depth limit that crashes is worse than one that declines — and
     * `insertPaneAtEdge` returning null is easy to propagate as a throw by
     * accident.
     */
    const { state, ids } = withTabs("a");
    let current = state;
    let lastPaneId = "p1";
    const positions = ["right", "bottom", "right", "bottom", "right"] as const;
    let refused = false;
    for (const [index, position] of positions.entries()) {
      const next = splitPane({
        state: current,
        paneId: lastPaneId,
        position,
        tile: blank(`n${index}`),
        ids,
      });
      if (next === current) {
        refused = true;
        break;
      }
      current = next;
      lastPaneId = current.activePaneId ?? lastPaneId;
    }
    expect(refused).toBe(true);
  });

  it("closing one side of a split dissolves the group", () => {
    const { state, ids } = withTabs("a");
    const split = splitPane({
      state,
      paneId: "p1",
      position: "right",
      tile: blank("n1"),
      ids,
    });
    const closed = closePane(split, "p2");

    expect(closed.root?.kind).toBe("pane");
    expect(closed.activePaneId).toBe("p1");
    // The dissolved group's sizes entry must go with it.
    expect(closed.sizesByGroupId["g1"]).toBeUndefined();
    expectInvariantI1(closed);
  });

  it("re-resolves the active pane when the ACTIVE pane is the one removed", () => {
    // I2. Closing the focused pane must leave `activePaneId` naming a pane
    // that exists — a dangling id renders nothing and looks like a blank app.
    const { state, ids } = withTabs("a");
    const split = splitPane({
      state,
      paneId: "p1",
      position: "right",
      tile: blank("n1"),
      ids,
    });
    expect(split.activePaneId).toBe("p2");
    const closed = closePane(split, "p2");
    expect(findPaneById(closed.root, closed.activePaneId ?? "")).not.toBeNull();
  });
});

describe("resize", () => {
  it("keeps the SAME root reference so layout does not re-render", () => {
    /*
     * The performance invariant, asserted as identity because that is the only
     * form it can be checked in. Mutation: store sizes on the group node —
     * `root` becomes a new object and every tile re-renders on every drag
     * frame, which presents as "the canvas is sluggish" and is untraceable
     * later.
     */
    const { state, ids } = withTabs("a");
    const split = splitPane({
      state,
      paneId: "p1",
      position: "right",
      tile: blank("n1"),
      ids,
    });
    const resized = resizeSplit(split, "g1", [0.7, 0.3]);

    expect(resized.root).toBe(split.root);
    expect(resized.sizesByGroupId["g1"]).toEqual([0.7, 0.3]);
  });

  it("normalizes what it is given", () => {
    const { state, ids } = withTabs("a");
    const split = splitPane({
      state,
      paneId: "p1",
      position: "right",
      tile: blank("n1"),
      ids,
    });
    const resized = resizeSplit(split, "g1", [3, 1]);
    expect(resized.sizesByGroupId["g1"]).toEqual([0.75, 0.25]);
  });
});

describe("reconcile drops rather than throws", () => {
  it("drops a tab whose payload is missing and keeps the rest", () => {
    const { state } = withTabs("a", "b");
    const damaged: CanvasState = {
      ...state,
      tilesByInstanceId: { a: chat("a", "a") },
    };
    const fixed = reconcile(damaged);

    expect(findPaneById(fixed.root, "p1")?.tabInstanceIds).toEqual(["a"]);
    expect(findPaneById(fixed.root, "p1")?.activeTabId).toBe("a");
    expectInvariantI1(fixed);
  });

  it("drops a payload with no tab", () => {
    const { state } = withTabs("a");
    const damaged: CanvasState = {
      ...state,
      tilesByInstanceId: { ...state.tilesByInstanceId, ghost: chat("ghost", "ghost") },
    };
    expect(Object.keys(reconcile(damaged).tilesByInstanceId)).toEqual(["a"]);
  });

  it("empties the canvas when every payload is gone", () => {
    const { state } = withTabs("a", "b");
    const fixed = reconcile({ ...state, tilesByInstanceId: {} });
    expect(fixed).toEqual(EMPTY_CANVAS);
  });

  it("repairs a dangling activePaneId", () => {
    const { state } = withTabs("a");
    const fixed = reconcile({ ...state, activePaneId: "nope" });
    expect(fixed.activePaneId).toBe(firstPaneId(state.root!));
  });

  it("clears a previewTabId that no longer names a tab", () => {
    /*
     * The damaged pane is BUILT, not spread from `state.root` with a cast.
     * The first version wrote `{ ...(state.root as never), previewTabId }`,
     * which does not compile — and the tempting repair (`as TilePane`) would
     * have compiled while silently accepting any shape, which is how a fixture
     * ends up polite. Constructing the pane makes the damage explicit and
     * type-checked: the ONLY invalid thing here is `previewTabId`.
     */
    const { state } = withTabs("a");
    const damaged: CanvasState = {
      ...state,
      root: {
        kind: "pane",
        id: "p1",
        tabInstanceIds: ["a"],
        activeTabId: "a",
        previewTabId: "gone",
        activationHistory: ["a"],
      },
    };
    const repaired = findPaneById(reconcile(damaged).root, "p1");
    /*
     * Narrowed with a real guard, not `?.` and not `??`.
     *
     * `repaired?.previewTabId` against `toBeNull()` PASSES when the pane
     * vanished entirely — the opposite of what this test claims. The first
     * repair reached for `?? "MISSING PANE"` and was WORSE: `null ?? x` is
     * `x`, so a correctly-null previewTabId became a string and the
     * assertion failed on the passing case. The nullish operator cannot
     * distinguish "absent" from "legitimately null", which is exactly the
     * distinction being made here.
     */
    expect(repaired).not.toBeNull();
    if (repaired === null) return;
    expect(repaired.previewTabId).toBeNull();
  });
});
