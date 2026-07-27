// @vitest-environment jsdom
/**
 * `useArtifactBody` state-transition tests (Sprint 3 contract round-2).
 *
 * Drives a REAL `ArtifactRoomRegistry` directly (no stream fake needed --
 * the hook's dependency is the registry, not the transport) and asserts the
 * degraded/ready/error transitions the artifact body view renders from.
 */
import { describe, expect, it } from "vitest";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { schema } from "../artifact-body/artifact-body-markdown";
import { ArtifactRoomRegistry } from "../artifact-room-registry";
import { useArtifactBody } from "../use-artifact-body";
import { act, renderHook, waitFor } from "@/test-utils/dom";

/**
 * Builds a room snapshot whose `artifact-body:{artifactId}` fragment holds
 * valid ProseMirror doc content (a paragraph, not a bare Y.XmlText leaf —
 * the root fragment's children must be block nodes).
 */
function snapshotBytesFor(artifactId: string, text: string): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(artifactBodyFragmentName(artifactId));
  prosemirrorJSONToYXmlFragment(
    schema,
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    fragment,
  );
  return Y.encodeStateAsUpdate(doc);
}

describe("useArtifactBody", () => {
  it("round-2 (b): a room absent from the registry renders unavailable, not stuck loading", async () => {
    const registry = new ArtifactRoomRegistry();
    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));

    await waitFor(() => {
      expect(result.current.kind).toBe("unavailable");
    });
  });

  it("a retrying room renders the retrying state", async () => {
    const registry = new ArtifactRoomRegistry();
    act(() => registry.applyState("room-1", "retrying"));

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));
    await waitFor(() => {
      expect(result.current.kind).toBe("retrying");
    });
  });

  it("a ready room with real content serializes to markdown", async () => {
    const registry = new ArtifactRoomRegistry();
    const bytes = snapshotBytesFor("a1", "plain text body");
    act(() => {
      registry.applySnapshot("room-1", bytes);
      registry.applyState("room-1", "ready");
    });

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
    });
    if (result.current.kind === "ready") {
      expect(result.current.markdown).toContain("plain text body");
    }
  });

  it("round-2 (a): a room transitioning OUT of ready while open flips the view to degraded", async () => {
    const registry = new ArtifactRoomRegistry();
    const bytes = snapshotBytesFor("a1", "body");
    act(() => {
      registry.applySnapshot("room-1", bytes);
      registry.applyState("room-1", "ready");
    });

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));
    await waitFor(() => {
      expect(result.current.kind).toBe("ready");
    });

    act(() => registry.applyState("room-1", "unavailable"));

    await waitFor(() => {
      expect(result.current.kind).toBe("unavailable");
    });
  });

  it("a null registry (disconnected) renders loading, never crashes", () => {
    const { result } = renderHook(() => useArtifactBody(null, "room-1", "a1"));
    expect(result.current.kind).toBe("loading");
  });

  it("switching artifactRoomId resets to a fresh state for the new room", async () => {
    const registry = new ArtifactRoomRegistry();
    act(() => registry.applyState("room-1", "unavailable"));
    act(() => registry.applyState("room-2", "retrying"));

    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) => useArtifactBody(registry, roomId, "a1"),
      { initialProps: { roomId: "room-1" } },
    );
    await waitFor(() => expect(result.current.kind).toBe("unavailable"));

    rerender({ roomId: "room-2" });
    await waitFor(() => expect(result.current.kind).toBe("retrying"));
  });
});
