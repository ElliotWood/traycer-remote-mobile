// @vitest-environment jsdom
/**
 * P0 caching, layer B (epic tree): the projection seed (localStorage,
 * synchronous, covers render #1) and the `y-indexeddb` layer underneath it
 * (authoritative CRDT store, async). See `use-epic-doc.ts`'s module doc and
 * the caching contract's R2 for the guard this file's last two tests prove.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { CACHE_SCHEMA_VERSION } from "@/host/cache-config";
import {
  epicTreeDocName,
  readCachedEpicProjection,
  readChatsFromEpicDoc,
  serializeEpicProjection,
  useEpicDoc,
  writeCachedEpicProjection,
  type EpicArtifactEntry,
  type EpicChatEntry,
} from "@/host/use-epic-doc";
import { act, renderHook, waitFor } from "@/test-utils/dom";
import { createFakeStreamConnection } from "@/test-utils/fakes";

const CHAT: EpicChatEntry = { chatId: "c1", title: "Alpha", parentId: null, createdAt: 1, updatedAt: 1, hostId: null };
const ARTIFACT: EpicArtifactEntry = {
  id: "a1",
  kind: "spec",
  title: "Design",
  parentId: null,
  artifactRoomId: "room-a1",
  status: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("projection cache (pure)", () => {
  it("round-trips chats + artifacts through serialize/write/read", () => {
    const serialized = serializeEpicProjection([CHAT], [ARTIFACT]);
    writeCachedEpicProjection("e1", serialized);
    expect(readCachedEpicProjection("e1")).toEqual({ chats: [CHAT], artifacts: [ARTIFACT] });
  });

  it("returns null for a missing key, corrupt JSON, or the wrong shape — never throws", () => {
    expect(readCachedEpicProjection("never-written")).toBeNull();

    window.localStorage.setItem(`epic-proj:v${CACHE_SCHEMA_VERSION}:bad-json`, "{not json");
    expect(readCachedEpicProjection("bad-json")).toBeNull();

    window.localStorage.setItem(
      `epic-proj:v${CACHE_SCHEMA_VERSION}:wrong-shape`,
      JSON.stringify({ chats: "nope" }),
    );
    expect(readCachedEpicProjection("wrong-shape")).toBeNull();
  });

  it("a cache written under a different schema version is invisible to the current reader", () => {
    // Simulates a prior build's cache surviving a CACHE_SCHEMA_VERSION bump —
    // the reader only ever looks under today's version-namespaced key.
    window.localStorage.setItem(
      `epic-proj:v${CACHE_SCHEMA_VERSION}-stale:e1`,
      serializeEpicProjection([CHAT], []),
    );
    expect(readCachedEpicProjection("e1")).toBeNull();
  });
});

describe("y-indexeddb replay (real IndexedDB via fake-indexeddb)", () => {
  it("a second IndexeddbPersistence over the same doc name replays a destroyed doc's content", async () => {
    const docName = epicTreeDocName("replay-epic");

    const doc1 = new Y.Doc();
    const idb1 = new IndexeddbPersistence(docName, doc1);
    await idb1.whenSynced;
    const chats = doc1.getMap("epic").set("chats", new Y.Map<unknown>());
    const entry = new Y.Map<unknown>();
    chats.set("c1", entry);
    entry.set("title", "Restored chat");
    await idb1.destroy();
    doc1.destroy();

    const doc2 = new Y.Doc();
    const idb2 = new IndexeddbPersistence(docName, doc2);
    await idb2.whenSynced;

    expect(readChatsFromEpicDoc(doc2)).toEqual([
      { chatId: "c1", title: "Restored chat", parentId: null, createdAt: 0, updatedAt: 0, hostId: null },
    ]);

    await idb2.destroy();
    doc2.destroy();
  });
});

describe("useEpicDoc — zero-flash seed + R2 guard", () => {
  it("chats/artifacts are non-empty on the FIRST render when a projection cache exists, before any stream frame", () => {
    writeCachedEpicProjection("e-seeded", serializeEpicProjection([CHAT], [ARTIFACT]));
    const fake = createFakeStreamConnection();

    const { result } = renderHook(() => useEpicDoc(fake.connection, "e-seeded"));

    // Synchronous assertion, right after mount — no stream frame has been
    // dispatched and no `await`/`waitFor` has let any microtask run.
    expect(result.current.chats).toEqual([CHAT]);
    expect(result.current.artifacts).toEqual([ARTIFACT]);
  });

  it("R2: an empty local IndexedDB read never blanks an already-populated seeded view", async () => {
    // A fresh (empty) IndexedDB doc for this epic, mirroring "evicted/never
    // written locally" — while the localStorage projection seed IS populated
    // (e.g. it survived on a different storage layer, or was written by a
    // prior app version this browser's IndexedDB never saw).
    writeCachedEpicProjection("e-r2", serializeEpicProjection([CHAT], [ARTIFACT]));
    const fake = createFakeStreamConnection();

    const { result } = renderHook(() => useEpicDoc(fake.connection, "e-r2"));
    expect(result.current.chats).toEqual([CHAT]);

    // Let the epic-doc effect's own `IndexeddbPersistence` (backed by a
    // genuinely empty doc for this brand-new epicId) actually run its
    // `whenSynced` chain to completion — without this real delay, the
    // assertion below could trivially pass before the guarded code path had
    // even executed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(result.current.chats).toEqual([CHAT]);
    expect(result.current.artifacts).toEqual([ARTIFACT]);
  });

  it("a genuinely empty LIVE frame (host-confirmed) DOES blank a populated seed — only local IDB reads are guarded", async () => {
    writeCachedEpicProjection("e-live-empty", serializeEpicProjection([CHAT], [ARTIFACT]));
    const fake = createFakeStreamConnection();

    const { result } = renderHook(() => useEpicDoc(fake.connection, "e-live-empty"));
    expect(result.current.chats).toEqual([CHAT]);

    // A real host frame reporting a truly-empty epic doc (no chats/artifacts
    // maps at all) is authoritative and must be allowed to blank the view.
    act(() => {
      const doc = new Y.Doc();
      fake.epicSessions[0].callbacks.onSnapshot(
        {} as never,
        Y.encodeStateAsUpdate(doc),
      );
    });

    await waitFor(() => {
      expect(result.current.chats).toEqual([]);
    });
    expect(result.current.artifacts).toEqual([]);
  });
});
