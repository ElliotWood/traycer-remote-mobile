/**
 * The opener, tested on the one thing it exists to get right: **the same
 * content id means two different things depending on who asked.**
 *
 * A list click means "show me this" and must not make a second tab. A split
 * means "give me another view" and must. `openTile` beneath is dedup-free on
 * purpose, so the policy is here — and a test that only covered one policy
 * would leave the other free to be wrong in either direction.
 */
import { describe, expect, it } from "vitest";
import {
  makeBlankTile,
  openInCanvas,
  type OpenRequest,
} from "@/canvas/opener";
import {
  EMPTY_CANVAS,
  openTile,
  reachableInstanceIds,
  splitPane,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { collectPanes, findPaneById } from "@/canvas/tile-tree";

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

function request(id: string, name: string): OpenRequest {
  return { type: "chat", id, name, hostId: "h1" };
}

describe("minting", () => {
  it("mints a fresh instanceId rather than taking one from the caller", () => {
    /*
     * `OpenRequest` deliberately has no `instanceId` field. A caller
     * supplying one has either invented it (and may reuse it) or lifted it
     * from an existing tab (and will collide). Minting here makes "per open"
     * true by construction.
     *
     * Mutation: use `request.id` as the instanceId. The two opens below
     * collide and `reachableInstanceIds` returns one entry, not two.
     */
    const ids = idSource();
    const first = openInCanvas({
      state: EMPTY_CANVAS,
      request: request("c1", "one"),
      onAlreadyOpen: "always-new",
      preview: false,
      paneId: null,
      ids,
    });
    const second = openInCanvas({
      state: first.state,
      request: request("c1", "one"),
      onAlreadyOpen: "always-new",
      preview: false,
      paneId: null,
      ids,
    });

    expect(second.instanceId).not.toBe(first.instanceId);
    expect(reachableInstanceIds(second.state)).toHaveLength(2);
    expect(second.opened).toBe(true);
  });
});

describe("focus-existing — a list click means 'show me this'", () => {
  it("focuses the open tab instead of opening a second", () => {
    /*
     * Mutation: drop the `findByContentId` branch. `opened` becomes true and
     * the tab count goes 2 → 3 — the behaviour where clicking a list ten
     * times leaves ten identical tabs.
     */
    const ids = idSource();
    let state = openTile({
      state: EMPTY_CANVAS,
      tile: {
        type: "chat",
        id: "c1",
        instanceId: "i1",
        name: "one",
        hostId: "h1",
      },
      ids,
    });
    state = openTile({
      state,
      tile: {
        type: "chat",
        id: "c2",
        instanceId: "i2",
        name: "two",
        hostId: "h1",
      },
      ids,
    });

    const result = openInCanvas({
      state,
      request: request("c1", "one"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });

    expect(result.opened).toBe(false);
    expect(result.instanceId).toBe("i1");
    expect(reachableInstanceIds(result.state)).toHaveLength(2);
    expect(findPaneById(result.state.root, "p1")?.activeTabId).toBe("i1");
  });

  it("finds a tab in ANOTHER pane and focuses that pane", () => {
    // Otherwise a chat open in the right-hand pane opens a duplicate in the
    // left, and the user has the same thing twice with no way to tell why.
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: {
        type: "chat",
        id: "c1",
        instanceId: "i1",
        name: "one",
        hostId: "h1",
      },
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: makeBlankTile("h1"),
      ids,
    });
    expect(split.activePaneId).toBe("p2");

    const result = openInCanvas({
      state: split,
      request: request("c1", "one"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });

    expect(result.opened).toBe(false);
    expect(result.state.activePaneId).toBe("p1");
  });

  it("resolves by TREE order, not by activation order", () => {
    /*
     * Two tabs on the same content, in two panes. The answer must not depend
     * on where the user has been, or clicking the same list row twice in a
     * row focuses two different tabs.
     *
     * Mutation: iterate `activationHistory` instead of `tabInstanceIds`. The
     * second click below lands on the other copy.
     */
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: {
        type: "chat",
        id: "c1",
        instanceId: "left",
        name: "one",
        hostId: "h1",
      },
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: {
        type: "chat",
        id: "c1",
        instanceId: "right",
        name: "one",
        hostId: "h1",
      },
      ids,
    });

    const first = openInCanvas({
      state: split,
      request: request("c1", "one"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });
    const second = openInCanvas({
      state: first.state,
      request: request("c1", "one"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });

    expect(first.instanceId).toBe("left");
    expect(second.instanceId).toBe("left");
  });
});

describe("always-new — a split means 'give me another view'", () => {
  it("opens a second tab on content that is already open", () => {
    // The counterpart of the case above, and the reason the policy is a
    // parameter rather than a default: same content id, opposite intent.
    const ids = idSource();
    const first = openInCanvas({
      state: EMPTY_CANVAS,
      request: request("c1", "one"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });
    const second = openInCanvas({
      state: first.state,
      request: request("c1", "one"),
      onAlreadyOpen: "always-new",
      preview: false,
      paneId: null,
      ids,
    });

    expect(second.opened).toBe(true);
    expect(reachableInstanceIds(second.state)).toHaveLength(2);
  });
});

describe("preview", () => {
  it("opens italic and is replaced by the next preview", () => {
    const ids = idSource();
    let state = EMPTY_CANVAS;
    const kept = openInCanvas({
      state,
      request: request("c1", "kept"),
      onAlreadyOpen: "always-new",
      preview: false,
      paneId: null,
      ids,
    });
    state = kept.state;
    const peeked = openInCanvas({
      state,
      request: request("c2", "peeked"),
      onAlreadyOpen: "always-new",
      preview: true,
      paneId: null,
      ids,
    });
    const next = openInCanvas({
      state: peeked.state,
      request: request("c3", "next"),
      onAlreadyOpen: "always-new",
      preview: true,
      paneId: null,
      ids,
    });

    const pane = findPaneById(next.state.root, "p1");
    expect(pane?.tabInstanceIds).toEqual([kept.instanceId, next.instanceId]);
    expect(pane?.previewTabId).toBe(next.instanceId);
  });

  it("focus-existing on a previewed tab does not promote it by accident", () => {
    // Clicking the list row again is still "show me this", not "keep this".
    // Promotion is a double-click, and conflating them makes preview useless
    // for the second click onward.
    const ids = idSource();
    const peeked = openInCanvas({
      state: EMPTY_CANVAS,
      request: request("c1", "peeked"),
      onAlreadyOpen: "always-new",
      preview: true,
      paneId: null,
      ids,
    });
    const again = openInCanvas({
      state: peeked.state,
      request: request("c1", "peeked"),
      onAlreadyOpen: "focus-existing",
      preview: false,
      paneId: null,
      ids,
    });

    expect(again.opened).toBe(false);
    expect(findPaneById(again.state.root, "p1")?.previewTabId).toBe(
      peeked.instanceId,
    );
  });
});

describe("blank tabs", () => {
  it("gives every blank a unique content id so focus-existing cannot match one to another", () => {
    /*
     * A blank tab has no content, so it has no natural content id. Reusing a
     * constant (say `"blank"`) would make `focus-existing` resolve one empty
     * tab to another — splitting twice would focus the first new pane's tab
     * instead of making a second.
     *
     * Mutation: `id: "blank"` in `makeBlankTile`. This fails on the id
     * comparison, and the split below focuses rather than opens.
     */
    const first = makeBlankTile("h1");
    const second = makeBlankTile("h1");

    expect(first.id).not.toBe(second.id);
    expect(first.id).toBe(first.instanceId);

    const ids = idSource();
    const opened = openTile({ state: EMPTY_CANVAS, tile: first, ids });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: second,
      ids,
    });
    expect(collectPanes(split.root)).toHaveLength(2);
  });
});

describe("target pane", () => {
  it("opens into the named pane rather than the active one", () => {
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: {
        type: "chat",
        id: "c1",
        instanceId: "i1",
        name: "one",
        hostId: "h1",
      },
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: makeBlankTile("h1"),
      ids,
    });
    // p2 is active after a split; ask for p1 explicitly.
    const result = openInCanvas({
      state: split,
      request: request("c9", "elsewhere"),
      onAlreadyOpen: "always-new",
      preview: false,
      paneId: "p1",
      ids,
    });

    const target: CanvasState = result.state;
    expect(findPaneById(target.root, "p1")?.tabInstanceIds).toContain(
      result.instanceId,
    );
    expect(target.activePaneId).toBe("p1");
  });
});
