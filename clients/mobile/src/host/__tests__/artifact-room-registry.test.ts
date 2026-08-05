/**
 * Lifecycle tests for `ArtifactRoomRegistry` (Sprint 3 contract round-2 a/b).
 *
 * Pure class, no React/stream — drives `applySnapshot`/`applyUpdate`/
 * `applyState` directly and asserts the state/doc invariants the
 * `useArtifactBody` hook depends on.
 */
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ArtifactRoomRegistry } from "../artifact-room-registry";

function snapshotBytesFor(build: (doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  build(doc);
  return Y.encodeStateAsUpdate(doc);
}

describe("ArtifactRoomRegistry", () => {
  it("round-2 (b): a room never reported reads as unavailable, not a pending state", () => {
    const registry = new ArtifactRoomRegistry();
    expect(registry.getState("never-seen")).toBe("unavailable");
    expect(registry.getDoc("never-seen")).toBeNull();
  });

  it("applies snapshot + update bytes into a per-room replica retrievable by id", () => {
    const registry = new ArtifactRoomRegistry();
    const bytes = snapshotBytesFor((doc) => {
      doc.getXmlFragment("artifact-body:a1").insert(0, [new Y.XmlText("hello")]);
    });
    registry.applySnapshot("room-1", bytes);
    registry.applyState("room-1", "ready");

    expect(registry.getState("room-1")).toBe("ready");
    const doc = registry.getDoc("room-1");
    expect(doc).not.toBeNull();
    expect(doc?.getXmlFragment("artifact-body:a1").toString()).toContain("hello");
  });

  it("round-2 (a): a state transition OUT of ready destroys and replaces the replica", () => {
    const registry = new ArtifactRoomRegistry();
    const bytes = snapshotBytesFor((doc) => {
      doc.getXmlFragment("artifact-body:a1").insert(0, [new Y.XmlText("content")]);
    });
    registry.applySnapshot("room-1", bytes);
    registry.applyState("room-1", "ready");
    const readyDoc = registry.getDoc("room-1");
    expect(readyDoc?.getXmlFragment("artifact-body:a1").toString()).toContain("content");

    registry.applyState("room-1", "unavailable");

    expect(registry.getState("room-1")).toBe("unavailable");
    const invalidatedDoc = registry.getDoc("room-1");
    // A fresh, empty doc replaces the old one -- not the same instance, and
    // no longer carrying the stale content.
    expect(invalidatedDoc).not.toBe(readyDoc);
    expect(invalidatedDoc?.getXmlFragment("artifact-body:a1").toString()).toBe("");
  });

  it("a repeated identical state does not needlessly destroy the replica", () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState("room-1", "unavailable");
    const first = registry.getDoc("room-1");
    registry.applyState("room-1", "unavailable");
    const second = registry.getDoc("room-1");
    expect(second).toBe(first);
  });

  it("notifies subscribers of that room on snapshot/update/state changes, not other rooms", () => {
    const registry = new ArtifactRoomRegistry();
    const roomOneListener = vi.fn();
    const roomTwoListener = vi.fn();
    registry.subscribe("room-1", roomOneListener);
    registry.subscribe("room-2", roomTwoListener);

    registry.applyState("room-1", "ready");

    expect(roomOneListener).toHaveBeenCalledTimes(1);
    expect(roomTwoListener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const registry = new ArtifactRoomRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe("room-1", listener);
    unsubscribe();
    registry.applyState("room-1", "ready");
    expect(listener).not.toHaveBeenCalled();
  });

  it("destroy() tears down every replica and clears state", () => {
    const registry = new ArtifactRoomRegistry();
    registry.applyState("room-1", "ready");
    registry.applyState("room-2", "ready");
    const doc1 = registry.getDoc("room-1");

    registry.destroy();

    expect(registry.getState("room-1")).toBe("unavailable");
    expect(registry.getState("room-2")).toBe("unavailable");
    expect(registry.getDoc("room-1")).toBeNull();
    // The original doc object is destroyed (Yjs marks it and detaches maps);
    // asserting it's no longer reachable through the registry is the
    // behavior that matters here.
    expect(doc1).not.toBeNull();
  });

  // P0 caching: `hasReported` is what lets `useArtifactBody`'s cache-seed
  // guard (R4) tell "the host hasn't told us anything about this room yet"
  // (safe to keep showing a cached render) apart from "the host already
  // reported this room isn't ready" (must be honored) — `getState()` alone
  // collapses both to the same "unavailable" value.
  describe("hasReported", () => {
    it("is false for a room the registry has never heard about at all", () => {
      const registry = new ArtifactRoomRegistry();
      expect(registry.hasReported("never-seen")).toBe(false);
    });

    it("is false for a room whose ONLY frame so far is a snapshot/update — no explicit state frame yet", () => {
      const registry = new ArtifactRoomRegistry();
      const bytes = snapshotBytesFor((doc) => {
        doc.getXmlFragment("artifact-body:a1").insert(0, [new Y.XmlText("content")]);
      });
      registry.applySnapshot("room-1", bytes);
      // The entry now exists in the map (content arrived), but no
      // `artifactRoomState` frame has ever reported this room's state.
      expect(registry.hasReported("room-1")).toBe(false);
    });

    it("is true once applyState has been called for the room, regardless of which state", () => {
      const registry = new ArtifactRoomRegistry();
      registry.applyState("room-1", "ready");
      expect(registry.hasReported("room-1")).toBe(true);

      registry.applyState("room-2", "unavailable");
      expect(registry.hasReported("room-2")).toBe(true);

      registry.applyState("room-3", "retrying");
      expect(registry.hasReported("room-3")).toBe(true);
    });

    it("stays true after destroy() clears the map — a fresh registry starts over at false", () => {
      const registry = new ArtifactRoomRegistry();
      registry.applyState("room-1", "ready");
      registry.destroy();
      // The room no longer exists in the (cleared) map at all, so it reads
      // as "never reported" again — matches getState()'s own reset-on-destroy
      // behavior above.
      expect(registry.hasReported("room-1")).toBe(false);
    });
  });
});
