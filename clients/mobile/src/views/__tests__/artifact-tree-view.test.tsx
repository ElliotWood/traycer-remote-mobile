// @vitest-environment jsdom
/**
 * Render test for the artifact browse tree + body drill-in (Sprint 3 / M5+M6).
 *
 * `ArtifactTreeView` takes `artifacts`/`artifactRooms`/`connection` as PROPS
 * (post eval-round-1 fix: it no longer opens its own `epic.subscribe` — see
 * `artifact-tree-view.tsx`'s module doc and `epic-view.test.tsx`'s
 * "exactly one epic.subscribe" regression test for the other half of that
 * fix). So this file drives a REAL `ArtifactRoomRegistry` directly and
 * passes a literal artifact list — no stream fake needed for these cases.
 */
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { schema } from "@/host/artifact-body/artifact-body-markdown";
import { ArtifactRoomRegistry } from "@/host/artifact-room-registry";
import type { EpicArtifactEntry } from "@/host/use-epic-doc";
import { ArtifactTreeView } from "@/views/artifact-tree-view";
import { act, render, screen } from "@/test-utils/dom";

function artifact(overrides: Partial<EpicArtifactEntry> & { readonly id: string }): EpicArtifactEntry {
  return {
    kind: "spec",
    title: overrides.id,
    parentId: null,
    artifactRoomId: `room-${overrides.id}`,
    status: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * Builds a room snapshot whose `artifact-body:{artifactId}` fragment holds
 * valid ProseMirror doc content (a paragraph, not a bare Y.XmlText leaf —
 * the root fragment's children must be block nodes).
 */
function applyReadyRoom(registry: ArtifactRoomRegistry, roomId: string, artifactId: string, text: string): void {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(artifactBodyFragmentName(artifactId));
  prosemirrorJSONToYXmlFragment(
    schema,
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    fragment,
  );
  registry.applySnapshot(roomId, Y.encodeStateAsUpdate(doc));
  registry.applyState(roomId, "ready");
}

function renderTree(
  artifacts: readonly EpicArtifactEntry[],
  opts: { readonly artifactRooms?: ArtifactRoomRegistry | null; readonly onBack?: () => void } = {},
) {
  return render(
    <ArtifactTreeView
      epicId="e1"
      artifacts={artifacts}
      artifactRooms={opts.artifactRooms ?? new ArtifactRoomRegistry()}
      connection="live"
      onBack={opts.onBack ?? (() => {})}
    />,
  );
}

describe("ArtifactTreeView", () => {
  it("renders the tree nested by parentId, children collapsed by default", async () => {
    renderTree([
      artifact({ id: "spec-1", kind: "spec", title: "Design doc", updatedAt: 1 }),
      artifact({ id: "ticket-1", kind: "ticket", title: "Child ticket", parentId: "spec-1", status: 1, updatedAt: 2 }),
    ]);

    expect(await screen.findByText("Design doc")).toBeTruthy();
    expect(screen.queryByText("Child ticket")).toBeNull();

    await userEvent.setup().click(screen.getByTestId("artifact-chevron-spec-1"));
    expect(await screen.findByText("Child ticket")).toBeTruthy();
  });

  it("empty-title artifact falls back to a per-kind 'Untitled' label, never a blank row", async () => {
    renderTree([artifact({ id: "s1", kind: "story", title: "" })]);
    expect(await screen.findByText("Untitled Story")).toBeTruthy();
  });

  it("round-2 MUST-3: chevron toggles children WITHOUT opening the body; row tap opens it (including a parent's own body)", async () => {
    const registry = new ArtifactRoomRegistry();
    applyReadyRoom(registry, "room-spec-1", "spec-1", "parent body text");
    renderTree(
      [
        artifact({ id: "spec-1", kind: "spec", title: "Parent spec", updatedAt: 1 }),
        artifact({ id: "ticket-1", kind: "ticket", title: "Child", parentId: "spec-1", updatedAt: 2 }),
      ],
      { artifactRooms: registry },
    );
    const user = userEvent.setup();
    await screen.findByText("Parent spec");

    await user.click(screen.getByTestId("artifact-chevron-spec-1"));
    expect(await screen.findByText("Child")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Parent spec" })).toBeNull();

    await user.click(screen.getByTestId("artifact-row-spec-1"));
    expect(await screen.findByRole("heading", { name: "Parent spec" })).toBeTruthy();
  });

  it("an unavailable room shows a clear degraded message, never blank", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState("room-spec-1", "unavailable");
    renderTree([artifact({ id: "spec-1", kind: "spec", title: "Unsynced spec" })], {
      artifactRooms: registry,
    });
    const user = userEvent.setup();
    await screen.findByText("Unsynced spec");

    await user.click(screen.getByTestId("artifact-row-spec-1"));
    expect(await screen.findByText("Not synced on this host.")).toBeTruthy();
  });

  it("a ready room with real content renders the body markdown", async () => {
    const registry = new ArtifactRoomRegistry();
    applyReadyRoom(registry, "room-spec-1", "spec-1", "the real body text");
    renderTree([artifact({ id: "spec-1", kind: "spec", title: "Real spec" })], {
      artifactRooms: registry,
    });
    const user = userEvent.setup();
    await screen.findByText("Real spec");

    await user.click(screen.getByTestId("artifact-row-spec-1"));
    expect(await screen.findByText(/the real body text/)).toBeTruthy();
  });

  it("Back from a body returns to the tree; Back from the tree calls onBack", async () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState("room-spec-1", "unavailable");
    let backCalls = 0;
    renderTree([artifact({ id: "spec-1", kind: "spec", title: "A spec" })], {
      artifactRooms: registry,
      onBack: () => { backCalls += 1; },
    });
    const user = userEvent.setup();
    await screen.findByText("A spec");
    await user.click(screen.getByTestId("artifact-row-spec-1"));
    await screen.findByText("Not synced on this host.");

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("A spec")).toBeTruthy();
    expect(backCalls).toBe(0);

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(backCalls).toBe(1);
  });

  it("re-renders live once a snapshot for the artifact's room lands mid-view", async () => {
    // Regresses eval-round-1 finding 1's symptom at the unit level: the tree
    // must reflect a registry that's already populated by the time it mounts
    // (the shared-session case) without any extra fetch of its own.
    const registry = new ArtifactRoomRegistry();
    renderTree([artifact({ id: "spec-1", kind: "spec", title: "Spec" })], {
      artifactRooms: registry,
    });
    const user = userEvent.setup();
    await screen.findByText("Spec");
    await user.click(screen.getByTestId("artifact-row-spec-1"));
    expect(await screen.findByText("Not synced on this host.")).toBeTruthy();

    act(() => applyReadyRoom(registry, "room-spec-1", "spec-1", "arrived later"));

    expect(await screen.findByText(/arrived later/)).toBeTruthy();
  });
});
