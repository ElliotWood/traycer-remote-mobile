/**
 * Persistence, tested on the inputs a real user actually produces: layouts
 * written by a build that no longer exists.
 *
 * **Every case here is a NEGATIVE one except the round trip**, and that ratio
 * is the point. The happy path is one line of `JSON.parse`; the value of this
 * module is entirely in what it does with input it was not designed for, and
 * a suite that mostly tests the round trip would be testing `JSON`.
 *
 * The bar throughout: **no input throws, and no input yields a canvas that
 * violates an invariant.** A parser that returns a plausible-but-invalid
 * state is worse than one that throws, because the failure surfaces later,
 * somewhere else.
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_STORAGE_VERSION,
  canvasStorageKey,
  loadCanvas,
  parseCanvasState,
  parseTileRef,
  saveCanvas,
  serializeCanvasState,
  type CanvasStorage,
} from "@/canvas/canvas-persistence";
import {
  EMPTY_CANVAS,
  openTile,
  reachableInstanceIds,
  splitPane,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { findPaneById } from "@/canvas/tile-tree";
import type { TileRef } from "@/canvas/tile-ref";

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

function chat(instanceId: string, name: string): TileRef {
  return { type: "chat", id: instanceId, instanceId, name, hostId: "h1" };
}

function memoryStorage(initial: string | null): CanvasStorage & {
  readonly current: () => string | null;
} {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
    current: () => value,
  };
}

/** A two-pane canvas with three tabs — enough shape to notice damage. */
function sample(): CanvasState {
  const ids = idSource();
  let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
  state = openTile({ state, tile: chat("b", "two"), ids });
  state = splitPane({
    state,
    paneId: "p1",
    position: "right",
    tile: chat("c", "three"),
    ids,
  });
  return state;
}

/** I1 — the property every degraded parse must still satisfy. */
function expectInvariantI1(state: CanvasState): void {
  expect([...Object.keys(state.tilesByInstanceId)].sort()).toEqual(
    [...reachableInstanceIds(state)].sort(),
  );
}

describe("round trip", () => {
  it("restores a split canvas exactly", () => {
    const original = sample();
    const restored = parseCanvasState(
      JSON.parse(serializeCanvasState(original)),
    );
    expect(restored).toEqual(original);
  });

  it("survives storage that holds what we wrote", () => {
    const storage = memoryStorage(null);
    saveCanvas(storage, sample());
    expect(loadCanvas(storage)).toEqual(sample());
  });
});

describe("inputs that must not throw", () => {
  const junk: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["a number", 7],
    ["a string", "canvas"],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["a root that is a string", { root: "pane" }],
    ["a pane with no id", { root: { kind: "pane" } }],
    ["a node of unknown kind", { root: { kind: "quantum", id: "p1" } }],
    ["a group with no children key", { root: { kind: "group", id: "g1", direction: "horizontal" } }],
    ["a group with a bad direction", { root: { kind: "group", id: "g1", direction: "sideways", children: [] } }],
  ];

  for (const [label, value] of junk) {
    it(`returns an empty canvas for ${label}`, () => {
      const state = parseCanvasState(value);
      expect(state).toEqual(EMPTY_CANVAS);
    });
  }

  it("returns an empty canvas for text that is not JSON at all", () => {
    // A key collision, a truncated write, a half-synced profile. Rethrowing
    // here is a boot failure over a layout the user never knew existed.
    expect(loadCanvas(memoryStorage("{not json"))).toEqual(EMPTY_CANVAS);
  });

  it("survives storage that throws on read", () => {
    // localStorage ACCESS throws — it does not return null — when an
    // embedding context blocks third-party storage, which is exactly what a
    // Teams iframe may do.
    const hostile: CanvasStorage = {
      read: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      write: () => undefined,
    };
    expect(() => loadCanvas(hostile)).toThrow();
    // ^ loadCanvas does NOT swallow a throwing storage seam, deliberately:
    // `browserCanvasStorage` is where that is handled, so the guard lives in
    // one place. This asserts the division rather than a behaviour, so that
    // moving the try/catch fails a test instead of silently double-guarding.
  });
});

describe("a tile kind this build no longer renders", () => {
  it("is rejected by parseTileRef itself, not by something downstream", () => {
    /*
     * THIS TEST EXISTS BECAUSE THE TWO BELOW COULD NOT PIN THE MECHANISM.
     *
     * Disabling the kind guard left both of them green — a *different* check
     * (the key/instanceId agreement in `parseCanvasState`) happened to
     * discard the malformed result anyway. The outcome was right and the
     * reason was gone, which is the same defect as an assertion that cannot
     * discriminate, one layer up: the tests measured a canvas produced by
     * two independent mechanisms and could not say which one was working.
     *
     * So the guard is asserted where it lives. Mutation: make
     * `isKnownTileKind` return true — this returns the raw type string
     * instead of null, and only this test notices.
     */
    expect(
      parseTileRef({
        type: "terminal",
        id: "t",
        instanceId: "x",
        name: "a terminal",
        hostId: "h1",
      }),
    ).toBeNull();

    // The positive control: the same shape with a kind we DO render must
    // parse, or "returns null" would be satisfied by a parser that rejects
    // everything.
    expect(
      parseTileRef({
        type: "chat",
        id: "c",
        instanceId: "x",
        name: "a chat",
        hostId: "h1",
      }),
    ).toEqual({
      type: "chat",
      id: "c",
      instanceId: "x",
      name: "a chat",
      hostId: "h1",
    });
  });

  it("drops the tab and keeps everything around it", () => {
    /*
     * THE case the deferred-kinds decision creates. `tile-ref.ts` defers four
     * of the desktop's eight kinds and that list will move in both
     * directions, so layouts naming a gone kind are not hypothetical.
     *
     * Mutation: accept any `type` string in `parseTileRef`. The terminal tab
     * survives into `tilesByInstanceId` as an unrenderable ref, and the strip
     * draws a tab whose body is nothing.
     */
    const stored = {
      version: CANVAS_STORAGE_VERSION,
      root: {
        kind: "pane",
        id: "p1",
        tabInstanceIds: ["a", "gone", "b"],
        activeTabId: "gone",
        previewTabId: null,
        activationHistory: ["gone", "a"],
      },
      tilesByInstanceId: {
        a: chat("a", "one"),
        gone: {
          type: "terminal",
          id: "t",
          instanceId: "gone",
          name: "a terminal",
          hostId: "h1",
        },
        b: chat("b", "two"),
      },
      sizesByGroupId: {},
      activePaneId: "p1",
    };

    const state = parseCanvasState(stored);
    const pane = findPaneById(state.root, "p1");

    expect(pane?.tabInstanceIds).toEqual(["a", "b"]);
    // The ACTIVE tab was the dropped one, so focus must land somewhere real
    // rather than on a dangling id.
    expect(pane?.activeTabId).toBe("a");
    expectInvariantI1(state);
  });

  it("empties the canvas when EVERY tile is a kind we cannot render", () => {
    // Not an error: a user on an old build sees an empty canvas, not a crash
    // and not a strip of tabs that do nothing.
    const state = parseCanvasState({
      root: {
        kind: "pane",
        id: "p1",
        tabInstanceIds: ["x"],
        activeTabId: "x",
        previewTabId: null,
        activationHistory: ["x"],
      },
      tilesByInstanceId: {
        x: { type: "terminal", id: "t", instanceId: "x", name: "t", hostId: "h1" },
      },
      sizesByGroupId: {},
      activePaneId: "p1",
    });
    expect(state).toEqual(EMPTY_CANVAS);
  });
});

describe("damaged structure", () => {
  it("promotes a lone survivor rather than discarding a live pane", () => {
    /*
     * A group whose second child is malformed. Dropping the GROUP would
     * discard a working pane because its sibling was corrupt — a much bigger
     * loss than a lost split.
     *
     * Mutation: `if (children.length < 2) return null`. The canvas comes back
     * empty and this fails on the pane id.
     */
    const state = parseCanvasState({
      root: {
        kind: "group",
        id: "g1",
        direction: "horizontal",
        children: [
          {
            kind: "pane",
            id: "p1",
            tabInstanceIds: ["a"],
            activeTabId: "a",
            previewTabId: null,
            activationHistory: ["a"],
          },
          { kind: "pane" },
        ],
      },
      tilesByInstanceId: { a: chat("a", "one") },
      sizesByGroupId: {},
      activePaneId: "p1",
    });

    expect(state.root?.kind).toBe("pane");
    expect(findPaneById(state.root, "p1")?.tabInstanceIds).toEqual(["a"]);
  });

  it("drops a payload whose key disagrees with its own instanceId", () => {
    /*
     * Worse than a missing tab: the tree's reference resolves to a tile
     * describing something ELSE, and it renders confidently.
     *
     * Mutation: drop the `tile.instanceId === instanceId` check. The tab
     * survives under the wrong key and the title shown belongs to another
     * artifact.
     */
    const state = parseCanvasState({
      root: {
        kind: "pane",
        id: "p1",
        tabInstanceIds: ["a", "b"],
        activeTabId: "a",
        previewTabId: null,
        activationHistory: ["a"],
      },
      tilesByInstanceId: {
        a: chat("a", "one"),
        b: chat("SOMETHING-ELSE", "two"),
      },
      sizesByGroupId: {},
      activePaneId: "p1",
    });

    expect(findPaneById(state.root, "p1")?.tabInstanceIds).toEqual(["a"]);
    expectInvariantI1(state);
  });

  it("drops a partially-numeric size list rather than repairing it", () => {
    // Two readable fractions for three children restores the wrong
    // proportions; `sizesForGroup` already falls back to even sizes when the
    // count does not match, so dropping is both simpler and more correct.
    const state = parseCanvasState({
      ...JSON.parse(serializeCanvasState(sample())),
      sizesByGroupId: { g1: [0.5, "wide"] },
    });
    expect(state.sizesByGroupId["g1"]).toBeUndefined();
    expect(state.root?.kind).toBe("group");
  });
});

describe("version", () => {
  it("refuses a layout written by a NEWER build", () => {
    /*
     * Real in this client: the tab is served from a cached bundle, so a user
     * can hold an older index-*.js than the one that wrote their storage, in
     * another tab on the same machine. Reading a shape whose MEANING changed
     * is the one thing this parser cannot recover from, because it looks
     * valid.
     *
     * Mutation: delete the version branch. The stored canvas restores and the
     * assertion fails — which is the point: without the branch it parses
     * happily, which is exactly the danger.
     */
    const future = {
      ...JSON.parse(serializeCanvasState(sample())),
      version: CANVAS_STORAGE_VERSION + 1,
    };
    expect(parseCanvasState(future)).toEqual(EMPTY_CANVAS);
  });

  it("accepts a layout with NO version, from before the field existed", () => {
    const legacy = JSON.parse(serializeCanvasState(sample())) as Record<
      string,
      unknown
    >;
    delete legacy.version;
    const state = parseCanvasState(legacy);
    expect(state.root?.kind).toBe("group");
    expectInvariantI1(state);
  });

  it("accepts an OLDER version rather than discarding what it can read", () => {
    const older = {
      ...JSON.parse(serializeCanvasState(sample())),
      version: CANVAS_STORAGE_VERSION - 1,
    };
    expect(parseCanvasState(older).root?.kind).toBe("group");
  });
});

describe("one canvas per epic", () => {
  it("gives two epics two different keys", () => {
    /*
     * THE decision that had to be made before the first byte was written.
     *
     * A single global key was fine while nothing called `loadCanvas`, and
     * stops being fine the instant the canvas is reachable — that is when it
     * starts holding real user data. Two epics sharing a key would merge
     * their layouts, and splitting them later is a migration over data a user
     * cannot see.
     *
     * Mutation: return a constant. Both keys become equal and this fails.
     */
    expect(canvasStorageKey("epic-a")).not.toBe(canvasStorageKey("epic-b"));
  });

  it("puts the epic id in the key, so a stray key is attributable", () => {
    // Not just "different" — a hash would satisfy the case above while
    // leaving an operator unable to tell whose layout a key holds.
    expect(canvasStorageKey("epic-a")).toContain("epic-a");
  });

  it("is stable for the same epic across calls", () => {
    // A key that varied per call would silently orphan every previous save.
    expect(canvasStorageKey("epic-a")).toBe(canvasStorageKey("epic-a"));
  });
});
