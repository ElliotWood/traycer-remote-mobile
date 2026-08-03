// @vitest-environment jsdom
/**
 * The controls that make the canvas usable: new tab, split, close pane.
 *
 * Until this, the layout engine was complete and unreachable — `splitPane` was
 * correct, covered, and called by no component. These assert the gestures
 * reach the transitions, which is the gap that made "the canvas is built" and
 * "the canvas does something" two different claims for eleven commits.
 *
 * The canvas is CONTROLLED, so a click produces an `onChange` with the next
 * state rather than a visible change. Every assertion below is therefore on
 * the state handed back — and the last two are on what is drawn, because the
 * depth limit and the empty-canvas recovery are both things a user meets on
 * screen rather than in a reducer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { TileCanvas } from "@/canvas/tile-canvas";
import {
  canSplitPane,
  EMPTY_CANVAS,
  openTile,
  splitPane,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { collectPanes } from "@/canvas/tile-tree";
import { makeBlankTile } from "@/canvas/opener";

afterEach(() => {
  cleanup();
});

const HOST = "host-1";

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

type ChangeSpy = Mock<(next: CanvasState) => void>;

/** One pane, one blank tab — the state right after the first "New tab". */
function oneTab(): CanvasState {
  return openTile({
    state: EMPTY_CANVAS,
    tile: makeBlankTile(HOST),
    preview: false,
    ids: idSource(),
  });
}

function draw(state: CanvasState): ChangeSpy {
  const onChange: ChangeSpy = vi.fn<(next: CanvasState) => void>();
  render(
    <FluentProvider theme={webLightTheme}>
      <TileCanvas
        state={state}
        onChange={onChange}
        renderTile={() => <div />}
        ids={idSource()}
        hostId={HOST}
        onOpenFirst={() => {
          onChange(
            openTile({
              state,
              tile: makeBlankTile(HOST),
              preview: false,
              ids: idSource(),
            }),
          );
        }}
      />
    </FluentProvider>,
  );
  return onChange;
}

/** The single state a spy was called with. Fails loudly on 0 or 2+ calls. */
function onlyCall(spy: ChangeSpy): CanvasState {
  expect(spy.mock.calls.length).toBe(1);
  const next = spy.mock.calls[0]?.[0];
  if (next === undefined) throw new Error("onChange called with nothing");
  return next;
}

describe("new tab", () => {
  it("adds a tab to the pane rather than replacing what is there", () => {
    const state = oneTab();
    const spy = draw(state);
    fireEvent.click(screen.getByTestId("pane-new-tab"));

    const next = onlyCall(spy);
    const pane = collectPanes(next.root)[0];
    // TWO. The obvious defect is opening as a PREVIEW, which replaces the
    // pane's existing preview in place — press "+" twice, get one tab, and the
    // button reads as broken. `oneTab()` opens non-preview, so this only
    // distinguishes the two if the second open is non-preview too.
    expect(pane?.tabInstanceIds.length).toBe(2);
  });

  it("makes the new tab active and permanent, not a preview", () => {
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-new-tab"));

    const pane = collectPanes(onlyCall(spy).root)[0];
    const added = pane?.tabInstanceIds[1];
    expect(pane?.activeTabId).toBe(added);
    // The property the previous test cannot see: a pane can hold two tabs with
    // the second one a preview, and then the THIRD press replaces it. Asserting
    // the tab count alone would pass for that.
    expect(pane?.previewTabId).toBeNull();
  });

  it("binds the configured host onto the tile it mints", () => {
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-new-tab"));

    const next = onlyCall(spy);
    const tiles = Object.values(next.tilesByInstanceId);
    expect(tiles.length).toBe(2);
    // `hostId` is bound at open time and for life. A tile minted with "" would
    // persist and then need a migration to gain a real one — the field looks
    // like dead weight in a single-host client, which is exactly why nothing
    // would have caught this.
    expect(tiles.every((tile) => tile?.hostId === HOST)).toBe(true);
  });
});

describe("split", () => {
  it("splitting right produces two panes in a horizontal group", () => {
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-split-right"));

    const next = onlyCall(spy);
    expect(next.root?.kind).toBe("group");
    expect(collectPanes(next.root).length).toBe(2);
    if (next.root?.kind === "group") {
      expect(next.root.direction).toBe("horizontal");
    }
  });

  it("splitting down produces a VERTICAL group", () => {
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-split-down"));

    const next = onlyCall(spy);
    // The direction is the whole difference between the two buttons. Without
    // this, wiring both controls to the same position passes every other
    // assertion in this file.
    if (next.root?.kind === "group") {
      expect(next.root.direction).toBe("vertical");
    } else {
      throw new Error("expected a group");
    }
  });

  it("puts a BLANK tab in the new pane, not a copy of the current one", () => {
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-split-right"));

    const next = onlyCall(spy);
    const tiles = Object.values(next.tilesByInstanceId);
    expect(tiles.length).toBe(2);
    // Duplicating would give two live views of one thing by default. With two
    // blanks the ids must still differ — `makeBlankTile` uses the instance id
    // AS the content id precisely so focus-if-open can never resolve one blank
    // to another.
    expect(new Set(tiles.map((t) => t?.id)).size).toBe(2);
  });
});

describe("close pane", () => {
  it("removes the pane and everything in it", () => {
    const state = splitPane({
      state: oneTab(),
      paneId: collectPanes(oneTab().root)[0]?.id ?? "",
      position: "right",
      tile: makeBlankTile(HOST),
      ids: idSource(),
    });
    // Guard the fixture: if the split silently declined, the assertions below
    // would be about a one-pane canvas and would pass for the wrong reason.
    expect(collectPanes(state.root).length).toBe(2);

    const spy = draw(state);
    fireEvent.click(screen.getAllByTestId("pane-close")[0] as HTMLElement);

    const next = onlyCall(spy);
    expect(collectPanes(next.root).length).toBe(1);
  });

  it("CONTRACT: closing the LAST pane leaves a way back in", () => {
    /*
     * The one-way door. `closePane` documents that "the last pane leaves an
     * empty canvas" — and an empty canvas has no pane, so no tab strip, so no
     * "+". Before the recovery button the only exit was a page reload, and
     * nothing about the screen said so.
     *
     * Asserted by RENDERING the empty state rather than by reading the model,
     * because the model was always right about this and the screen is where
     * the user is stuck.
     */
    const spy = draw(oneTab());
    fireEvent.click(screen.getByTestId("pane-close"));
    expect(onlyCall(spy).root).toBeNull();

    cleanup();
    const recovered = draw(EMPTY_CANVAS);
    fireEvent.click(screen.getByTestId("canvas-open-first"));
    expect(onlyCall(recovered).root?.kind).toBe("pane");
  });
});

describe("the depth limit is shown, not just enforced", () => {
  /**
   * Splits in ALTERNATING directions until one is refused — alternating,
   * because a same-direction split merges into the parent group instead of
   * deepening, so splitting right forever never reaches the limit.
   *
   * Derived rather than hand-built: a literal four-deep tree in this file
   * would be a fixture that agrees with `MAX_TREE_DEPTH` on the day it was
   * typed and never again.
   */
  function deepenUntilRefused(): { state: CanvasState; paneId: string } {
    let state = oneTab();
    const ids = idSource();
    for (let step = 0; step < 20; step += 1) {
      const paneId = collectPanes(state.root).at(-1)?.id ?? "";
      const position = step % 2 === 0 ? "right" : "bottom";
      if (!canSplitPane(state, paneId, position)) return { state, paneId };
      state = splitPane({
        state,
        paneId,
        position,
        tile: makeBlankTile(HOST),
        ids,
      });
    }
    // NOT a silent give-up. If twenty alternating splits never hit the limit,
    // the premise of this whole describe is wrong and the test must say so
    // rather than assert against a tree that can still split.
    throw new Error("20 alternating splits never reached MAX_TREE_DEPTH");
  }

  it("disables the refused direction and leaves the other one alone", () => {
    const { state, paneId } = deepenUntilRefused();

    // The two answers must actually DIFFER, or this test would pass against a
    // UI that disables both buttons whenever either is refused — which is the
    // single-boolean implementation the props deliberately avoid.
    const right = canSplitPane(state, paneId, "right");
    const down = canSplitPane(state, paneId, "bottom");
    expect(right).not.toBe(down);

    draw(state);
    const panes = screen.getAllByTestId("canvas-pane");
    const deepest = panes.find(
      (pane) => pane.getAttribute("data-pane-id") === paneId,
    );
    if (deepest === undefined) throw new Error("deepest pane not rendered");

    const rightButton = deepest.querySelector('[data-testid="pane-split-right"]');
    const downButton = deepest.querySelector('[data-testid="pane-split-down"]');
    expect((rightButton as HTMLButtonElement | null)?.disabled).toBe(!right);
    expect((downButton as HTMLButtonElement | null)?.disabled).toBe(!down);
  });

  it("says WHY the control is disabled", () => {
    const { state, paneId } = deepenUntilRefused();
    draw(state);
    const deepest = screen
      .getAllByTestId("canvas-pane")
      .find((pane) => pane.getAttribute("data-pane-id") === paneId);
    const disabled = deepest?.querySelector("button[disabled]");
    // A disabled control with no explanation reads as a bug. The title is the
    // only thing carrying the reason.
    expect(disabled?.getAttribute("title")).toBe("Nesting limit reached");
  });
});
