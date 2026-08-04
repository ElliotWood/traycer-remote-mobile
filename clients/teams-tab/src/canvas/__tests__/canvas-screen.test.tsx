// @vitest-environment jsdom
/**
 * The canvas screen as a user meets it.
 *
 * The previous commit's stated limit was that nothing asserts a `case` returns
 * the RIGHT screen — `case "epic": return <WaitingScreen/>` would have passed
 * every test it added. This closes half of that: the canvas screen renders a
 * canvas, names the epic it belongs to, and offers a way back.
 *
 * The other half stays open and is stated rather than implied: nothing here
 * renders `App`, so the wiring from `route.name === "canvas"` to this
 * component is asserted only by the source-level contract test. A render test
 * over `App` needs auth, config and a host connection stubbed, which is a
 * bigger instrument than this step earns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { CanvasScreen } from "@/canvas/canvas-screen";
import { EMPTY_CANVAS, openTile, type CanvasState, type IdSource } from "@/canvas/canvas-state";
import type { TileRef } from "@/canvas/tile-ref";

afterEach(() => {
  cleanup();
});

const EPIC_ID = "a1000000-0000-4000-8000-000000000e91";

/** Named, so a test that ignores `onBack` says so rather than defaulting it. */
function noop(): void {
  return undefined;
}

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

/*
 * Every argument required — no default for `onBack`. The package's lint bans
 * default parameters and the reason applies here more than most places: a
 * fixture helper with a default is how a test ends up asserting against a
 * value nobody chose for it.
 */
function draw(
  state: CanvasState,
  epicName: string | null,
  onBack: () => void,
): ReactElement {
  return (
    <FluentProvider theme={webLightTheme}>
      <CanvasScreen
        epicId={EPIC_ID}
        epicName={epicName}
        state={state}
        onChange={() => undefined}
        onBack={onBack}
        hostId="host-1"
        ids={idSource()}
        /*
         * NO HOST. A chat tile then reports "no host configured" rather than
         * loading forever, which is the state these tests want: they are about
         * the screen, and a real stream would make every one of them depend on
         * a socket. The chat body's own behaviour is covered in
         * `chat-tile.test.tsx`.
         */
        streamConnection={null}
        diffClient={null}
        now={1_700_000_000_000}
        chatEntry={() => null}
        /*
         * NO EPIC DOC either, and `epicContentReady` is deliberately `true`
         * rather than `false`. These tests are about the SCREEN, and `false`
         * would put every artifact tile into the loading branch — a spinner
         * asserts nothing about the tile it is standing in for. `true` with an
         * empty lookup is the honest "the list arrived and this is not in it"
         * state, which is a real screen with real text.
         */
        artifactEntry={() => null}
        artifactRooms={null}
        epicContentReady
      />
    </FluentProvider>
  );
}

describe("canvas screen", () => {
  it("renders the canvas, not a placeholder for one", () => {
    render(draw(EMPTY_CANVAS, "Ship the thing", noop));
    expect(screen.getByTestId("tile-canvas")).toBeTruthy();
  });

  it("CONTRACT: the empty state says WHY it is empty", () => {
    render(draw(EMPTY_CANVAS, "Ship the thing", noop));
    const empty = screen.getByTestId("canvas-empty");
    // "Nothing open" is true and useless: a user who just navigated here needs
    // to know the screen is unfinished, not that it is working as intended.
    // The assertion is on the attribution, which is the part that carries the
    // information — mutate the label to a bare "Nothing open" and this fails.
    expect(empty.textContent ?? "").toMatch(/lands next/);
  });

  it("names the epic it belongs to", () => {
    render(draw(EMPTY_CANVAS, "Ship the thing", noop));
    expect(screen.getByText("Ship the thing")).toBeTruthy();
  });

  it("CONTRACT: a deep link with no epic name shows a short id, never an empty crumb", () => {
    // `epicName` is null on a reload or a link from Teams — the same case the
    // detail screen handles. A breadcrumb rendering "" is indistinguishable
    // from a broken layout, and it is the state a user reaching this screen by
    // URL is MOST likely to see.
    render(draw(EMPTY_CANVAS, null, noop));
    expect(screen.getByText(`Epic ${EPIC_ID.slice(0, 8)}`)).toBeTruthy();
  });

  it("offers a way back to the epic", () => {
    const onBack = vi.fn<() => void>();
    render(draw(EMPTY_CANVAS, "Ship the thing", onBack));
    fireEvent.click(screen.getByText("Ship the thing"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws a restored tile's title, so a persisted layout is not silently blank", () => {
    /*
     * Reachable ONLY from storage today — no UI opens a tab — which is exactly
     * why it is asserted now. The next commit turns persistence on, and a
     * restored layout that renders empty panes would look identical to a
     * layout that failed to restore. The fixture carries a real tile rather
     * than an empty canvas for the same reason the transcript fixtures had to
     * carry a fenced code block: a specimen without the property under test
     * cannot fail on it.
     */
    const tile: TileRef = {
      type: "spec",
      id: "art-1",
      instanceId: "inst-1",
      name: "Parity contract",
      hostId: "host-1",
    };
    const state = openTile({
      state: EMPTY_CANVAS,
      tile,
      preview: false,
      ids: idSource(),
    });

    render(draw(state, "Ship the thing", noop));
    /*
     * ONCE, and this count changed from 2 deliberately — read before
     * "correcting" it back.
     *
     * The old body was a placeholder that repeated the tile's title, so the
     * title appeared in the tab strip AND in the body. The real artifact body
     * renders no title at all (`artifact-tile.tsx`: a pane's tab strip already
     * carries the name, so repeating it is chrome duplicated where space is
     * scarcest). The strip is now the only place it appears.
     *
     * The original comment's warning still applies and is why the second
     * assertion is here: narrowing a query until it matches once is how a
     * render leak gets hidden. So this pins the count AND pins that the body
     * rendered something of its own — 1 with an empty pane would otherwise
     * pass.
     */
    expect(screen.getAllByText("Parity contract").length).toBe(1);
    expect(screen.getByText(/no longer in this epic/)).toBeTruthy();
  });
});

/**
 * The tile body switch.
 *
 * Every case here opens a tab through `openTile` rather than hand-building a
 * `CanvasState`, so these also cover the path a restored layout takes.
 */
describe("tile bodies", () => {
  function withTile(tile: TileRef): CanvasState {
    return openTile({ state: EMPTY_CANVAS, tile, preview: false, ids: idSource() });
  }

  const CHAT_TILE: TileRef = {
    type: "chat",
    id: "c-1",
    instanceId: "inst-1",
    name: "Migrate config loader",
    hostId: "host-1",
  };

  const SPEC_TILE: TileRef = {
    type: "spec",
    id: "art-1",
    instanceId: "inst-2",
    name: "Parity contract",
    hostId: "host-1",
  };

  it("CONTRACT: a chat tile renders a CHAT, not a placeholder", () => {
    /*
     * The assertion that carries the change. `streamConnection` is null here,
     * so the chat reports having no host — which is the chat surface's OWN
     * error state and is reachable only by having actually rendered
     * `ChatScreen`. A placeholder body cannot produce it.
     *
     * Asserting on the error rather than on a transcript is deliberate: a
     * transcript needs a live subscription, and a test that stubs one deep
     * enough to produce messages stops being a test of this switch.
     */
    render(draw(withTile(CHAT_TILE), "Ship the thing", noop));
    expect(screen.getByText(/Couldn’t open this chat/)).toBeTruthy();
  });

  it("CONTRACT: a chat tile draws no second breadcrumb inside the pane", () => {
    /*
     * The canvas screen owns the only breadcrumb on this screen. One is the
     * canvas's; a second would be the chat's, and that is the defect
     * `ChatChrome` exists to prevent — asserted here at the composition, not
     * only at `ChatScreen` in isolation, because this is where the two meet.
     */
    render(draw(withTile(CHAT_TILE), "Ship the thing", noop));
    expect(screen.getAllByLabelText("Location").length).toBe(1);
  });

  it("CONTRACT: an artifact tile no longer sends the user somewhere else", () => {
    /*
     * REPLACES an assertion on the old placeholder's wording ("Open this from
     * the epic's Artifacts list for now"). That string was the blocker being
     * named honestly while a pane genuinely could not reach an artifact's
     * document; a pane can now, so the sentence would be a false instruction
     * rather than a stale one.
     *
     * Kept as a NEGATIVE here, and the positive — a real Y.Doc rendering as
     * real markdown inside a pane — lives in `artifact-tile.test.tsx`, where
     * the registry fixture belongs. This one guards the direction of travel:
     * if the tile ever regresses to a redirect, this fails.
     */
    render(draw(withTile(SPEC_TILE), "Ship the thing", noop));
    expect(screen.queryByText(/epic's Artifacts list/)).toBeNull();
  });

  it("CONTRACT: with the list in, a missing artifact says GONE, not 'loading'", () => {
    /*
     * `draw` passes `epicContentReady` true with an empty lookup, which is the
     * state where the doc has arrived and this artifact is not in it. The two
     * `null`-entry branches must not collapse: a deleted artifact that spins
     * forever is indistinguishable from a slow one, and only one of them is
     * worth waiting on.
     *
     * Paired with a positive so it cannot pass on a tile that rendered
     * nothing — `queryByText` returning null describes an empty pane equally
     * well.
     */
    render(draw(withTile(SPEC_TILE), "Ship the thing", noop));
    expect(screen.getByText(/no longer in this epic/)).toBeTruthy();
    expect(screen.queryByText(/Opening the artifact/)).toBeNull();
  });

  it("a blank tab invites content rather than reporting a blocker", () => {
    // The two placeholders must not collapse into one message: "nothing is
    // here yet" and "this cannot be built yet" are different facts and a
    // shared string would make the artifact one unfalsifiable.
    render(draw(EMPTY_CANVAS, "Ship the thing", noop));
    expect(screen.queryByText(/ProseMirror/)).toBeNull();
  });
});
