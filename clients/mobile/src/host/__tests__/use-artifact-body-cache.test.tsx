// @vitest-environment jsdom
/**
 * P0 caching, layer D (artifact bodies): the markdown-string seed cache and
 * the R4 `hasReported` guard. No `y-indexeddb` here (dropped in negotiation
 * round 4 — the string seed already does the whole job); see the caching
 * contract, Layer D.
 */
import { describe, expect, it } from "vitest";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { artifactBodyFragmentName } from "@traycer/protocol/persistence/epic/artifacts";
import { schema } from "@/host/artifact-body/artifact-body-markdown";
import { ArtifactRoomRegistry } from "@/host/artifact-room-registry";
import { readCachedArtifactBody, useArtifactBody } from "@/host/use-artifact-body";
import { CACHE_SCHEMA_VERSION } from "@/host/cache-config";
import { act, renderHook, waitFor } from "@/test-utils/dom";

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

function seedCache(artifactRoomId: string, artifactId: string, markdown: string): void {
  window.localStorage.setItem(
    `artifact-body:v${CACHE_SCHEMA_VERSION}:${artifactRoomId}:${artifactId}`,
    JSON.stringify({ markdown }),
  );
}

describe("readCachedArtifactBody (pure)", () => {
  it("round-trips a written cache", () => {
    seedCache("room-1", "a1", "hello **world**");
    expect(readCachedArtifactBody("room-1", "a1")).toEqual({
      kind: "ready",
      markdown: "hello **world**",
    });
  });

  it("returns null for a missing key, corrupt JSON, or the wrong shape — never throws", () => {
    expect(readCachedArtifactBody("never-seeded", "a1")).toBeNull();
    window.localStorage.setItem(`artifact-body:v${CACHE_SCHEMA_VERSION}:room-1:bad`, "{not json");
    expect(readCachedArtifactBody("room-1", "bad")).toBeNull();
    window.localStorage.setItem(
      `artifact-body:v${CACHE_SCHEMA_VERSION}:room-1:wrong-shape`,
      JSON.stringify({ markdown: 42 }),
    );
    expect(readCachedArtifactBody("room-1", "wrong-shape")).toBeNull();
  });
});

describe("useArtifactBody — R4: hasReported-gated cache seed", () => {
  it("check 25a: no entry for the room (never reported) + seeded cache + no frame ever arrives -> stays ready, never a transient unavailable", async () => {
    seedCache("room-1", "a1", "cached body");
    const registry = new ArtifactRoomRegistry();

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));

    // Synchronous assertion right after mount — the registry has never heard
    // from a host this session, and the guard must not have downgraded it.
    expect(result.current).toEqual({ kind: "ready", markdown: "cached body" });

    // Give any pending microtasks a turn — still nothing changes because no
    // frame was ever dispatched (dead-host simulation).
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "ready", markdown: "cached body" });
  });

  it("check 25b: host already reported unavailable BEFORE mount -> the real determination wins over the stale cache", () => {
    seedCache("room-1", "a1", "stale cached body");
    const registry = new ArtifactRoomRegistry();
    // Simulates the host having settled this room earlier in the session
    // (e.g. the user opened it once already, or another view triggered it).
    act(() => registry.applyState("room-1", "unavailable"));

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));

    expect(result.current).toEqual({ kind: "unavailable" });
  });

  it("a real host frame arriving AFTER mount still invalidates a cache-seeded ready view (genuine invalidation still works)", async () => {
    seedCache("room-1", "a1", "cached body");
    const registry = new ArtifactRoomRegistry();

    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a1"));
    expect(result.current).toEqual({ kind: "ready", markdown: "cached body" });

    act(() => registry.applyState("room-1", "unavailable"));

    await waitFor(() => {
      expect(result.current).toEqual({ kind: "unavailable" });
    });
  });

  it("write-through: a real ready room writes the seed cache after serializing, keyed by (artifactRoomId, artifactId)", async () => {
    const registry = new ArtifactRoomRegistry();
    const bytes = snapshotBytesFor("a1", "fresh live content");
    act(() => {
      registry.applySnapshot("room-1", bytes);
      registry.applyState("room-1", "ready");
    });

    renderHook(() => useArtifactBody(registry, "room-1", "a1"));

    await waitFor(() => {
      expect(readCachedArtifactBody("room-1", "a1")?.kind).toBe("ready");
    });
    const cached = readCachedArtifactBody("room-1", "a1");
    if (cached?.kind === "ready") {
      expect(cached.markdown).toContain("fresh live content");
    }
  });

  it("check 29: a different, never-viewed artifact shows correctly — no cross-artifact cache bleed", () => {
    seedCache("room-1", "a1", "artifact A's body");
    const registry = new ArtifactRoomRegistry();

    // Same room, but artifactId "a2" has never been cached — must not show
    // artifact A's markdown.
    const { result } = renderHook(() => useArtifactBody(registry, "room-1", "a2"));

    expect(result.current.kind).not.toBe("ready");
  });
});
