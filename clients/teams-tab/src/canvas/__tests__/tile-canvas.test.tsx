// @vitest-environment jsdom
/**
 * The canvas as a user meets it. These assert on RENDERED OUTPUT, because the
 * state layer is already proven and what is untested is the gap between a
 * correct model and a screen that shows it.
 *
 * The gap is real and this project has paid for it twice: the transcript
 * renderers were correct about their data and printed markdown as characters;
 * the status row was correct about its state and had nowhere to appear. Both
 * passed every state-level test they had.
 *
 * So: is the preview tab visibly a preview, does only the active tab mount,
 * does closing move focus where the model says, and does a background pane
 * stay un-accented. Each names the mutation that reddens it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { TileCanvas } from "@/canvas/tile-canvas";
import {
  EMPTY_CANVAS,
  openTile,
  setActiveTab,
  splitPane,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { findPaneById } from "@/canvas/tile-tree";
import type { TileRef } from "@/canvas/tile-ref";

afterEach(() => {
  cleanup();
});

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

/** Bodies are distinguishable, so "only the active one mounted" is checkable. */
function renderTile(tile: TileRef): ReactElement {
  return <p>body of {tile.name}</p>;
}

function tabById(instanceId: string): HTMLElement | undefined {
  return screen
    .getAllByTestId("canvas-tab")
    .find((tab) => tab.getAttribute("data-instance-id") === instanceId);
}

/**
 * React maps `onAuxClick` to the native `auxclick` event, which this version
 * of Testing Library has no `fireEvent` shorthand for. Dispatching it by hand
 * is the honest route - a `click` with `button: 1` would NOT exercise the
 * handler under test and would pass for the wrong reason.
 */
function middleClick(element: HTMLElement): void {
  element.dispatchEvent(
    new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
  );
}

/**
 * The spy is typed as the prop it stands in for, not as a bare `vi.fn()`.
 * An untyped mock makes `onChange.mock.calls[0][0]` an `any` that every
 * assertion below silently accepts - so a transition returning the WRONG
 * SHAPE would satisfy tests named after its contents.
 */
type ChangeSpy = Mock<(next: CanvasState) => void>;

function changeSpy(): ChangeSpy {
  return vi.fn<(next: CanvasState) => void>();
}

function draw(state: CanvasState, onChange: ChangeSpy): ChangeSpy {
  render(
    <FluentProvider theme={webLightTheme}>
      <TileCanvas
        state={state}
        onChange={onChange}
        renderTile={renderTile}
        ids={idSource()}
        hostId="host-1"
      />
    </FluentProvider>,
  );
  return onChange;
}

describe("the empty canvas", () => {
  it("says so rather than rendering nothing", () => {
    // A blank region and a broken app are indistinguishable to a user, and
    // this client has shipped an empty frame once already.
    draw(EMPTY_CANVAS, changeSpy());
    expect(screen.getByTestId("canvas-empty")).toBeTruthy();
  });
});

describe("tabs", () => {
  it("mounts ONLY the active tab's body", () => {
    /*
     * Mutation: render every tab instead of `activeTabId`. "body of two"
     * appears and the assertion below fails.
     *
     * This is not a render-count nicety: a mounted chat tab holds a live epic
     * subscription, so mounting the background ones multiplies subscriptions
     * by the number of open tabs.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
    state = openTile({ state, tile: chat("b", "two"), ids });
    draw(state, changeSpy());

    expect(screen.getByText(/body of two/)).toBeTruthy();
    expect(screen.queryByText(/body of one/)).toBeNull();
    // Both tabs are in the STRIP — the point is that only one body mounted.
    expect(screen.getAllByTestId("canvas-tab")).toHaveLength(2);
  });

  it("marks the preview tab so a user can see which one will be replaced", () => {
    /*
     * The model already replaces preview tabs correctly. A user who cannot
     * TELL which tab is the preview experiences correct replacement as tabs
     * randomly disappearing.
     *
     * Mutation: drop the `preview` class and the aria-label branch. Both
     * assertions fail — deliberately two, because the visual signal and the
     * accessible one are different users, and shipping one is shipping half.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "kept"), ids });
    state = openTile({
      state,
      tile: chat("b", "peeked"),
      preview: true,
      ids,
    });
    draw(state, changeSpy());

    /*
     * `tabById` is narrowed with an explicit assertion rather than read
     * through `?.`. Optional chaining here would turn "the tab is missing"
     * into `undefined !== "Preview: peeked"` — still a failure, but one whose
     * message names the wrong problem, and one line later it becomes
     * `toBeNull()` passing for the wrong reason entirely.
     */
    const previewTab = tabById("b");
    const keptTab = tabById("a");
    expect(previewTab).toBeDefined();
    expect(keptTab).toBeDefined();
    if (previewTab === undefined || keptTab === undefined) return;

    expect(previewTab.getAttribute("data-preview")).toBe("true");
    expect(previewTab.getAttribute("aria-label")).toBe("Preview: peeked");
    expect(keptTab.getAttribute("data-preview")).toBeNull();
    expect(keptTab.getAttribute("aria-label")).toBe("kept");
  });

  it("closes on the close button without first activating the doomed tab", () => {
    /*
     * Mutation: remove `stopPropagation` in the close button. The tab's own
     * onClick also fires, so `onChange` is called TWICE — once to activate a
     * tab that is about to stop existing. Harmless-looking, and it makes the
     * close-focus rule run against stale state.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
    state = openTile({ state, tile: chat("b", "two"), ids });
    const onChange = draw(state, changeSpy());

    fireEvent.click(screen.getByLabelText("Close one"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as CanvasState;
    expect(Object.keys(next.tilesByInstanceId)).toEqual(["b"]);
  });

  it("closes on middle click", () => {
    // The one mouse gesture users bring from every browser; its absence reads
    // as broken rather than as absent.
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
    state = openTile({ state, tile: chat("b", "two"), ids });
    const onChange = draw(state, changeSpy());

    middleClick(tabById("a")!);

    const next = onChange.mock.calls[0][0] as CanvasState;
    expect(Object.keys(next.tilesByInstanceId)).toEqual(["b"]);
  });

  it("closes with the Delete key, because there is no drag fallback here", () => {
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
    state = openTile({ state, tile: chat("b", "two"), ids });
    const onChange = draw(state, changeSpy());

    fireEvent.keyDown(tabById("b")!, { key: "Delete" });

    const next = onChange.mock.calls[0][0] as CanvasState;
    expect(Object.keys(next.tilesByInstanceId)).toEqual(["a"]);
  });

  it("clamps arrow navigation at the ends rather than wrapping", () => {
    /*
     * Wrapping means a held arrow silently cycles and a user scanning a strip
     * loses their place. Mutation: use modulo — the active tab becomes "b".
     *
     * THE FIRST VERSION OF THIS TEST COULD NOT FAIL. It pressed ArrowLeft
     * while "b" was active: clamping targets "a"'s own index and wrapping
     * targets "b", but "b" was ALREADY active, so both produced identical
     * state and the assertion fell back to counting calls — which is 1 either
     * way. Making "a" active first is what gives the two branches different
     * outcomes.
     */
    const ids = idSource();
    let state = openTile({ state: EMPTY_CANVAS, tile: chat("a", "one"), ids });
    state = openTile({ state, tile: chat("b", "two"), ids });
    state = setActiveTab(state, "p1", "a");
    const onChange = draw(state, changeSpy());

    fireEvent.keyDown(tabById("a")!, { key: "ArrowLeft" });

    const next = onChange.mock.calls[0][0] as CanvasState;
    expect(findPaneById(next.root, "p1")?.activeTabId).toBe("a");
  });
});

describe("split panes", () => {
  it("renders one strip per pane and a handle between them", () => {
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: chat("a", "one"),
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: chat("b", "two"),
      ids,
    });
    draw(split, changeSpy());

    expect(screen.getAllByTestId("canvas-pane")).toHaveLength(2);
    expect(screen.getAllByTestId("resize-handle")).toHaveLength(1);
    expect(screen.getByTestId("tile-split").getAttribute("data-axis")).toBe(
      "horizontal",
    );
  });

  it("accents exactly ONE pane — two accents would claim two focuses", () => {
    /*
     * Mutation: pass `paneFocused` as a constant `true`. Both panes carry
     * `data-focused` and the count goes 1 → 2.
     */
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: chat("a", "one"),
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "bottom",
      tile: chat("b", "two"),
      ids,
    });
    draw(split, changeSpy());

    const focused = screen
      .getAllByTestId("canvas-pane")
      .filter((pane) => pane.getAttribute("data-focused") === "true");
    expect(focused).toHaveLength(1);
    expect(focused[0].getAttribute("data-pane-id")).toBe("p2");
  });

  it("focuses a pane on pointer-down, before the click is handled", () => {
    // Capture phase. A bubbling handler sets the active pane AFTER the
    // click's own transition has run against the old one, and the accent
    // trails the user by one interaction.
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: chat("a", "one"),
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: chat("b", "two"),
      ids,
    });
    const onChange = draw(split, changeSpy());

    const firstPane = screen
      .getAllByTestId("canvas-pane")
      .find((pane) => pane.getAttribute("data-pane-id") === "p1");
    fireEvent.pointerDown(firstPane!);

    const next = onChange.mock.calls[0][0] as CanvasState;
    expect(next.activePaneId).toBe("p1");
  });

  it("gives the handle a keyboard path, since the canvas has no drag", () => {
    const ids = idSource();
    const opened = openTile({
      state: EMPTY_CANVAS,
      tile: chat("a", "one"),
      ids,
    });
    const split = splitPane({
      state: opened,
      paneId: "p1",
      position: "right",
      tile: chat("b", "two"),
      ids,
    });
    const onChange = draw(split, changeSpy());

    const handle = screen.getByTestId("resize-handle");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const next = onChange.mock.calls.at(-1)?.[0] as CanvasState;
    expect(next.sizesByGroupId["g1"]?.[0]).toBeCloseTo(0.55, 5);
  });
});
