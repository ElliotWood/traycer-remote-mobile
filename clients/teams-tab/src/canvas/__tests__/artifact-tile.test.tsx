// @vitest-environment jsdom
/**
 * An artifact in a canvas PANE — the composition, not the component.
 *
 * `artifact-viewer.test.tsx` already proves the Y.Doc → markdown pipeline for
 * the full-screen door. Repeating that here would assert the same thing twice.
 * What is unproven, and what this file exists for, is that the pipeline is
 * REACHABLE FROM A TILE: the canvas route held no `epic.subscribe`, so there
 * was no registry to hand a tile, and the four artifact kinds rendered a
 * placeholder saying so.
 *
 * So every test renders `CanvasScreen` with a real `ArtifactRoomRegistry` and
 * opens a real tab through `openTile` — the same path a restored layout takes.
 * Rendering `ArtifactTile` directly would pass with the switch in
 * `canvas-screen.tsx` still returning a placeholder, which is precisely the
 * defect this change fixes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { ArtifactRoomRegistry } from "@traycer-clients/shared/epic/artifact-room-registry";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import { CanvasScreen } from "@/canvas/canvas-screen";
import { EMPTY_CANVAS, openTile, type IdSource } from "@/canvas/canvas-state";
import type { TileRef } from "@/canvas/tile-ref";
import { schema } from "@/artifacts/artifact-body/artifact-body-markdown";

afterEach(() => {
  cleanup();
});

const EPIC_ID = "a1000000-0000-4000-8000-000000000e91";

const ENTRY: EpicArtifactEntry = {
  id: "art-1",
  kind: "spec",
  title: "Parity contract",
  parentId: null,
  artifactRoomId: "room-1",
  status: null,
  createdAt: 0,
  updatedAt: 0,
};

/** The tile's `id` is the artifact's `id` — that is what the lookup keys on. */
const SPEC_TILE: TileRef = {
  type: "spec",
  id: ENTRY.id,
  instanceId: "inst-1",
  name: ENTRY.title,
  hostId: "host-1",
};

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

/**
 * A real Y.Doc snapshot, built the same way the lifted serializer test does —
 * not a markdown string handed in directly, which would prove the renderer and
 * nothing about the bytes reaching it.
 */
function realSnapshotBytes(): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(artifactBodyFragmentName(ENTRY.id));
  prosemirrorJSONToYXmlFragment(
    schema,
    {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "A real rendered heading" }],
        },
      ],
    },
    fragment,
  );
  return Y.encodeStateAsUpdate(doc);
}

/*
 * Every argument explicit — the package's lint bans default parameters, and
 * the reason bites hardest on `listReady`: defaulting it is how a test ends up
 * asserting the loading branch while believing it asserted the loaded one.
 */
function drawCanvas(args: {
  readonly registry: ArtifactRoomRegistry | null;
  readonly entry: EpicArtifactEntry | null;
  readonly contentReady: boolean;
}): void {
  const state = openTile({
    state: EMPTY_CANVAS,
    tile: SPEC_TILE,
    preview: false,
    ids: idSource(),
  });
  render(
    <FluentProvider theme={webLightTheme}>
      <CanvasScreen
        epicId={EPIC_ID}
        epicName="Ship the thing"
        state={state}
        onChange={() => undefined}
        onBack={() => undefined}
        hostId="host-1"
        ids={idSource()}
        streamConnection={null}
        diffClient={null}
        now={1_700_000_000_000}
        chatEntry={() => null}
        artifactEntry={(id) => (args.entry !== null && id === args.entry.id ? args.entry : null)}
        artifactRooms={args.registry}
        epicContentReady={args.contentReady}
      />
    </FluentProvider>,
  );
}

describe("an artifact in a canvas pane", () => {
  it("renders real agent-authored content from a real Y.Doc, inside a tile", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applySnapshot(ENTRY.artifactRoomId, realSnapshotBytes());
    registry.applyState(ENTRY.artifactRoomId, "ready");

    drawCanvas({ registry, entry: ENTRY, contentReady: true });

    /*
     * The assertion that carries the change. A heading element can only exist
     * here if the bytes were decoded, serialized to markdown and rendered —
     * the placeholder this replaces produced plain captions and no heading at
     * any level.
     */
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "A real rendered heading" })).toBeTruthy();
    });
  });

  it("CONTRACT: the pane adds no second breadcrumb and no repeated title", async () => {
    /*
     * `ArtifactViewer` renders both a breadcrumb and the title, correctly, for
     * the full-screen door. A tile must render neither: the canvas owns the
     * only breadcrumb on this screen, and the tab strip already shows the
     * name. Asserted at the COMPOSITION because that is where the two chromes
     * meet — the same reason `chat-tile`'s equivalent test lives here.
     */
    const registry = new ArtifactRoomRegistry();
    registry.applySnapshot(ENTRY.artifactRoomId, realSnapshotBytes());
    registry.applyState(ENTRY.artifactRoomId, "ready");

    drawCanvas({ registry, entry: ENTRY, contentReady: true });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "A real rendered heading" })).toBeTruthy();
    });
    // One: the canvas's own. A second would be the artifact viewer's.
    expect(screen.getAllByLabelText("Location").length).toBe(1);
    // Once: the tab strip. Twice would be the body repeating it.
    expect(screen.getAllByText(ENTRY.title).length).toBe(1);
  });

  it("says the host has no such room, rather than rendering an empty pane", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState(ENTRY.artifactRoomId, "unavailable");

    drawCanvas({ registry, entry: ENTRY, contentReady: true });

    await waitFor(() => {
      expect(screen.getByText(/not available/i)).toBeTruthy();
    });
  });

  it("CONTRACT: before the list lands, a missing row is LOADING, not gone", () => {
    /*
     * The other half of the pair asserted in `canvas-screen.test.tsx`. Both
     * branches are reached with `entry === null`; only `epicContentReady`
     * separates them, and getting it backwards produces a confident "this
     * artifact is no longer in this epic" about an epic doc that simply has
     * not arrived — a wrong answer that reads as a definite one.
     *
     * Paired assertions, so neither can pass on a pane that rendered nothing.
     */
    drawCanvas({ registry: null, entry: null, contentReady: false });

    expect(screen.getByText(/Opening the artifact/)).toBeTruthy();
    expect(screen.queryByText(/no longer in this epic/)).toBeNull();
  });

  it("CONTRACT: once the list has landed, a missing row is GONE, not loading", () => {
    drawCanvas({ registry: null, entry: null, contentReady: true });

    expect(screen.getByText(/no longer in this epic/)).toBeTruthy();
    expect(screen.queryByText(/Opening the artifact/)).toBeNull();
  });
});
