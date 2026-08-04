/**
 * @vitest-environment jsdom
 *
 * `parity-contract` named the old state "two renderers with no door" —
 * a renderer that works against a fixture proves nothing about whether a
 * real artifact reaches it. This drives the SAME registry
 * `use-epic-agents.ts` feeds in production (`applySnapshot` with real Y.Doc
 * bytes, not a markdown string handed in directly), through the real
 * `useArtifactBody` hook, into the real `ArtifactMarkdown` renderer — the
 * door, not just the room behind it.
 *
 * These two cover the BODY half. `client={null}` puts the comments section in
 * its no-host state deliberately — the threads have their own door and their
 * own tests in `comments/__tests__/`, and mixing them here would make a body
 * assertion depend on an unrelated RPC.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { ArtifactRoomRegistry } from "@traycer-clients/shared/epic/artifact-room-registry";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import { ArtifactViewer } from "../artifact-viewer";
import { schema } from "../artifact-body/artifact-body-markdown";

afterEach(() => {
  cleanup();
});

const ENTRY: EpicArtifactEntry = {
  id: "artifact-1",
  kind: "spec",
  title: "Rollout plan",
  parentId: null,
  artifactRoomId: "room-1",
  status: null,
  createdAt: 0,
  updatedAt: 0,
};

/** A real Y.Doc snapshot, built the same way the lifted serializer test does. */
function realSnapshotBytes(): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(artifactBodyFragmentName(ENTRY.id));
  prosemirrorJSONToYXmlFragment(schema, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "A real rendered heading" }],
      },
    ],
  }, fragment);
  return Y.encodeStateAsUpdate(doc);
}

describe("ArtifactViewer — the door, not just the room", () => {
  it("renders real agent-authored content from a real Y.Doc snapshot", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applySnapshot(ENTRY.artifactRoomId, realSnapshotBytes());
    registry.applyState(ENTRY.artifactRoomId, "ready");

    render(
      <FluentProvider theme={webLightTheme}>
        <ArtifactViewer
          entry={ENTRY}
          registry={registry}
          epicId="epic-1"
          client={null}
          now={0}
          onBack={() => undefined}
        />
      </FluentProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "A real rendered heading" })).toBeTruthy();
    });
  });

  it("says so, rather than rendering nothing, when the host has no such room", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState(ENTRY.artifactRoomId, "unavailable");

    render(
      <FluentProvider theme={webLightTheme}>
        <ArtifactViewer
          entry={ENTRY}
          registry={registry}
          epicId="epic-1"
          client={null}
          now={0}
          onBack={() => undefined}
        />
      </FluentProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/not available/i)).toBeTruthy();
    });
  });
});
