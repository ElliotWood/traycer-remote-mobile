/**
 * Epic Y.Doc reader + React hook (T5, extended Sprint 3 / F2).
 *
 * Opens `epic.subscribe` (via T3's `HostStreamConnection`), applies the snapshot
 * and every incremental update into a local Yjs `Y.Doc`, and projects the
 * slices the phone's epic detail needs: the chat list (T5) and, as of Sprint 3,
 * the artifact tree + per-artifact-room replicas. This is a deliberately
 * MINIMAL reader — not a port of gui-app's `epic-projector` (which maintains
 * identity-stable byId slices, per-user visibility, and much more the phone
 * doesn't need).
 *
 * Y.Doc contract (verified against gui-app source of truth):
 *   - root:      `doc.getMap("epic")`                     projection-helpers.ts:59
 *   - chats:     `epicMap.get("chats")` — a `Y.Map`       projection-helpers.ts:83
 *                keyed by chatId (the map KEY is the id)   projection-helpers.ts:562
 *   - artifacts: `epicMap.get("artifacts")` — a `Y.Map`   projection-helpers.ts:12-15
 *                keyed by artifact id, entry fields per
 *                `protocol/src/persistence/epic/artifacts.ts`:
 *                {id, kind, title, artifactRoomId, parentId, createdAt,
 *                updatedAt} + {status, assignee} on ticket/story only.
 *
 * Deviation from gui-app: the full projector drops chats owned by a different
 * user (`isChatVisibleToUser`, projection-helpers.ts:565). This reader does NOT
 * filter by `userId` — it lists every chat in the map. The phone dials the
 * user's own host, so the epic's chats are theirs; threading the signed-in user
 * id into a pure reader would be the projector port the ticket rules out. If a
 * shared/multi-collaborator epic ever surfaces here, this over-lists. Flagged.
 *
 * Artifact-room replicas: `epic.subscribe` has no "open this room" client
 * frame — room frames arrive host-initiated, independent of client intent —
 * so this hook maintains one lightweight `Y.Doc` replica per `artifactRoomId`
 * for the whole session via `ArtifactRoomRegistry` (see that module for the
 * full lifecycle rationale). The expensive XmlFragment→markdown work stays
 * out of this file entirely — `useArtifactBody` does that, lazily, only for
 * the artifact currently open.
 */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  readArtifactsFromEpicDoc,
  type EpicArtifactEntry,
} from "@traycer-clients/shared/epic/epic-doc-artifacts";
import {
  readChatsFromEpicDoc,
  type EpicChatEntry,

} from "@traycer-clients/shared/epic/epic-doc-chats";

export {
  buildArtifactTree,
  readArtifactsFromEpicDoc,
  type ArtifactTree,
  type EpicArtifactEntry,
} from "@traycer-clients/shared/epic/epic-doc-artifacts";

export {
  buildChatTree,
  readChatsFromEpicDoc,
  type ChatTree,
  type EpicChatEntry,
} from "@traycer-clients/shared/epic/epic-doc-chats";
import { IndexeddbPersistence } from "y-indexeddb";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import { ArtifactRoomRegistry } from "./artifact-room-registry";
import { CACHE_SCHEMA_VERSION } from "./cache-config";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import { startLivenessRecovery } from "./liveness-recovery";

/**
 * One chat enumerated from the epic doc — the minimum a row + badge needs.
 * `parentId`/`createdAt`/`updatedAt` (P1) mirror `chatSchema`
 * (persistence/epic/chat.ts:44) and feed the Agents tree's nesting + default
 * sort, exactly as `EpicArtifactEntry`'s equivalents already do below.
 */
// `EpicChatEntry` / `readChatsFromEpicDoc` MOVED to
// `@traycer-clients/shared/epic/epic-doc-chats` when the Teams tab needed the
// same projection. Re-exported below so no call site moved.

// `EpicArtifactEntry`, `readArtifactsFromEpicDoc`, `ArtifactTree` and
// `buildArtifactTree` MOVED to `@traycer-clients/shared/epic/epic-doc-artifacts`.
//
// That move required untangling `CardKind`/`ArtifactStatus` out of
// `@/views/kind-tokens`: a data module cannot import one client's view layer
// and still be shared. The TYPES are data (which kinds exist, which status
// integers exist); the colours, icons and status WORDS stay in kind-tokens
// where they belong.

// `buildChatTree` moved with the projection — re-exported below.
/**
 * P0 caching, layer B: the epic tree's `Y.Doc` is the authoritative CRDT
 * store, persisted via `y-indexeddb`. IndexedDB has no synchronous
 * main-thread read API, so that store alone still leaves `chats`/`artifacts`
 * empty on the very first render — this doc name plus the projection cache
 * below are the two halves of the fix (see `useEpicDoc`'s effect).
 */
export function epicTreeDocName(epicId: string): string {
  return `epic-tree:v${CACHE_SCHEMA_VERSION}:${epicId}`;
}

function epicProjectionStorageKey(epicId: string): string {
  return `epic-proj:v${CACHE_SCHEMA_VERSION}:${epicId}`;
}

interface EpicProjection {
  readonly chats: readonly EpicChatEntry[];
  readonly artifacts: readonly EpicArtifactEntry[];
}

/** Pure serialize/parse pair, kept separate from storage I/O for testability. */
export function serializeEpicProjection(
  chats: readonly EpicChatEntry[],
  artifacts: readonly EpicArtifactEntry[],
): string {
  return JSON.stringify({ chats, artifacts });
}

function parseEpicProjection(raw: string): EpicProjection | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { chats?: unknown }).chats) ||
      !Array.isArray((parsed as { artifacts?: unknown }).artifacts)
    ) {
      return null;
    }
    return parsed as EpicProjection;
  } catch {
    return null;
  }
}

/**
 * Synchronous localStorage read for the epic-tree seed. Used as `useState`'s
 * lazy initializer (never inside an effect) so a warm reload's render #1
 * already holds last-known rows — no gap for `y-indexeddb`'s async IndexedDB
 * open to fill. Corrupt JSON / wrong schema version / no `window` all
 * degrade to "no cache", never throw.
 */
export function readCachedEpicProjection(epicId: string): EpicProjection | null {
  if (typeof window === "undefined" || !("localStorage" in window)) return null;
  try {
    const raw = window.localStorage.getItem(epicProjectionStorageKey(epicId));
    return raw === null ? null : parseEpicProjection(raw);
  } catch {
    return null;
  }
}

/**
 * Writes the projected (small JSON) tree, NOT the Yjs binary, so the next
 * cold mount has something to seed from synchronously. Only ever called from
 * a LIVE `epic.subscribe` frame (see `refresh` in `useEpicDoc`) — an
 * IndexedDB-sync-triggered read must never become the next seed (R2: a
 * transiently-empty local IDB read is not authoritative).
 */
export function writeCachedEpicProjection(epicId: string, serialized: string): void {
  if (typeof window === "undefined" || !("localStorage" in window)) return;
  try {
    window.localStorage.setItem(epicProjectionStorageKey(epicId), serialized);
  } catch {
    // Quota exceeded / private-mode write rejection — degrade to "no cache
    // written this time", never throw.
  }
}

export interface UseEpicDocResult {
  readonly chats: readonly EpicChatEntry[];
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly connection: StreamConnectionState;
  /** `null` when disconnected (no host / no session open). */
  readonly artifactRooms: ArtifactRoomRegistry | null;
  /**
   * UX fix: `false` until the epic's first `epic.subscribe` snapshot has
   * decoded into the Y.Doc — lets callers show a loading skeleton instead of
   * misreading "haven't heard from the host yet" as "genuinely empty".
   * `true` immediately when there's no connection at all (nothing pending).
   */
  readonly docLoaded: boolean;
}

/**
 * Builds the epic-stream callbacks that feed a local `Y.Doc` plus the
 * artifact-room registry. Snapshot/update frames carry root-doc bytes;
 * artifact-room frames route to `artifactRooms` (see that module for the
 * full lifecycle — this is just the fan-out point). Every other required
 * callback (migration lifecycle, awareness, permission/deletion, connection
 * status) is a no-op here — the connection state is read off the handle's
 * `StreamConnectionStateStore`, and those concerns are out of scope for the
 * phone's epic detail.
 */
function makeEpicDocCallbacks(
  doc: Y.Doc,
  artifactRooms: ArtifactRoomRegistry,
  onDocChanged: () => void,
  onSnapshotArrived: () => void,
): EpicStreamCallbacks {
  return {
    onSnapshot: (_meta, snapshotBytes) => {
      Y.applyUpdate(doc, snapshotBytes);
      onDocChanged();
      onSnapshotArrived();
    },
    onUpdate: (updateBytes) => {
      Y.applyUpdate(doc, updateBytes);
      onDocChanged();
    },
    onEarlyMeta: () => {},
    onAwareness: () => {},
    onPermissionChanged: () => {},
    onEpicDeleted: () => {},
    onArtifactRoomSnapshot: (artifactRoomId, snapshotBytes) => {
      artifactRooms.applySnapshot(artifactRoomId, snapshotBytes);
    },
    onArtifactRoomUpdate: (artifactRoomId, updateBytes) => {
      artifactRooms.applyUpdate(artifactRoomId, updateBytes);
    },
    onArtifactRoomAwareness: () => {},
    onArtifactRoomState: (artifactRoomId, state) => {
      artifactRooms.applyState(artifactRoomId, state);
    },
    onCloudSyncStatus: () => {},
    onMigrationStarted: () => {},
    onMigrationProgress: () => {},
    onMigrationFailed: () => {},
    onMigrationNotAllowed: () => {},
    // Connection state is surfaced via the handle's connection store, not here.
    onConnectionStatus: () => {},
    // Dirty-state tracking (unsaved-changes indicator) has no surface in the
    // phone's epic detail yet - no-op like the other out-of-scope callbacks
    // above.
    onArtifactRoomDirty: () => {},
    onRootDirty: () => {},
    onDirtySnapshot: () => {},
  };
}

/**
 * Subscribes a component to an epic's chat list, artifact tree, and live
 * connection state.
 *
 * Lifecycle: one `epic.subscribe` session is opened per (connection, epicId).
 * Its snapshot/update bytes are applied into a fresh `Y.Doc`, the chat list
 * and artifact tree are re-derived on every frame, and artifact-room bytes
 * feed a fresh `ArtifactRoomRegistry` for the session's lifetime. On unmount
 * (or an epicId/connection change) the effect cleanup closes the stream,
 * destroys the root doc, AND destroys the registry (tearing down every room
 * replica at once) — no leaked socket, no detached observer. A `null`
 * connection (no host) yields empty lists in the "disconnected" state
 * without opening anything.
 */
export function useEpicDoc(
  streamConnection: HostStreamConnection | null,
  epicId: string,
): UseEpicDocResult {
  // P0 caching: seeded synchronously from the last live-confirmed projection
  // (see `readCachedEpicProjection`) so a warm mount's FIRST render already
  // shows last-known rows — `agents-section.tsx`/`artifacts-section.tsx`'s
  // existing `tree.roots.length === 0` empty-state gate never sees an
  // artificially-empty array. Safe as a lazy initializer (not re-read on
  // every render) because every epic open is a fresh mount of this hook
  // (`app-shell.tsx`'s route switch never transitions epic→epic in place).
  const [chats, setChats] = useState<readonly EpicChatEntry[]>(
    () => readCachedEpicProjection(epicId)?.chats ?? [],
  );
  const [artifacts, setArtifacts] = useState<readonly EpicArtifactEntry[]>(
    () => readCachedEpicProjection(epicId)?.artifacts ?? [],
  );
  const [connection, setConnection] =
    useState<StreamConnectionState>("reconnecting");
  const [artifactRooms, setArtifactRooms] = useState<ArtifactRoomRegistry | null>(null);
  const [docLoaded, setDocLoaded] = useState(false);
  // Dedupes the projection write against a burst of live frames (S1) — only
  // re-serializes/writes when the projected shape actually changed.
  const lastWrittenProjectionRef = useRef<string | null>(null);
  // Perf fix: every Y.Doc update/snapshot re-derives BOTH `chats` AND
  // `artifacts` from the whole doc, even when the delta only touched one of
  // them (or neither, e.g. an artifact-room frame that doesn't change the
  // tree at all) — calling `setChats`/`setArtifacts` with a NEW array every
  // time forces the Agents/Artifacts sections to re-render on every frame
  // regardless of whether their own slice actually changed. These track the
  // last-applied serialization per collection so `refresh()` can skip the
  // `setState` (and the array-identity churn that comes with it) when a
  // frame didn't actually change that half of the tree.
  const lastChatsRef = useRef<string | null>(null);
  const lastArtifactsRef = useRef<string | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setChats([]);
      setArtifacts([]);
      setArtifactRooms(null);
      setConnection("disconnected");
      setDocLoaded(true);
      return;
    }

    setDocLoaded(false);
    // Fresh mount (new epicId/connection) — the compare-refs must not carry
    // over a previous epic's serialization, or a coincidental content match
    // could wrongly skip this epic's first live `setChats`/`setArtifacts`.
    lastChatsRef.current = null;
    lastArtifactsRef.current = null;
    const doc = new Y.Doc();
    const registry = new ArtifactRoomRegistry();
    setArtifactRooms(registry);
    let disposed = false;

    // Live-frame refresh (`onSnapshot`/`onUpdate`): the ONLY authoritative
    // source. A genuinely empty result here is a real confirmed-empty epic,
    // free to blank the view — and the only path allowed to update the
    // projection seed for the next cold mount (R2).
    const refresh = (): void => {
      if (disposed) return;
      const nextChats = readChatsFromEpicDoc(doc);
      const nextArtifacts = readArtifactsFromEpicDoc(doc);
      const chatsSerialized = JSON.stringify(nextChats);
      const artifactsSerialized = JSON.stringify(nextArtifacts);
      // Only the collection that actually changed gets a new array identity
      // — a delta touching just the artifacts tree never re-renders the
      // Agents section, and vice versa.
      if (chatsSerialized !== lastChatsRef.current) {
        lastChatsRef.current = chatsSerialized;
        setChats(nextChats);
      }
      if (artifactsSerialized !== lastArtifactsRef.current) {
        lastArtifactsRef.current = artifactsSerialized;
        setArtifacts(nextArtifacts);
      }
      const serialized = serializeEpicProjection(nextChats, nextArtifacts);
      if (serialized !== lastWrittenProjectionRef.current) {
        lastWrittenProjectionRef.current = serialized;
        writeCachedEpicProjection(epicId, serialized);
      }
    };
    const markLoaded = (): void => {
      if (disposed) return;
      setDocLoaded(true);
    };

    const handle = streamConnection.openEpic({
      epicId,
      callbacks: makeEpicDocCallbacks(doc, registry, refresh, markLoaded),
    });

    // R2: `y-indexeddb` is the authoritative CRDT store, layered UNDER the
    // synchronous projection seed above (which only ever covers render #1).
    // IndexedDB's own load is inherently async, and — unlike a live frame —
    // an empty local IDB read is NOT authoritative: the doc for this epic may
    // simply be missing/evicted from IndexedDB while the localStorage seed is
    // still good. So this path may enrich or correct the current view, but
    // may never regress a populated view back to empty; only `refresh()`
    // above (a real host frame) may do that. Never writes the projection seed
    // itself — only live-confirmed data becomes the next seed.
    //
    // The constructor itself (not just `whenSynced`) can throw synchronously
    // when `indexedDB` is unavailable (private-mode Safari, storage disabled,
    // a test environment with no IndexedDB polyfill) — guarded the same way
    // as the async rejection below: degrade to "no y-indexeddb layer this
    // session", never crash the epic view.
    let idb: IndexeddbPersistence | null = null;
    try {
      idb = new IndexeddbPersistence(epicTreeDocName(epicId), doc);
    } catch {
      idb = null;
    }
    idb?.whenSynced
      .then(() => {
        if (disposed) return;
        const nextChats = readChatsFromEpicDoc(doc);
        const nextArtifacts = readArtifactsFromEpicDoc(doc);
        setChats((prev) => (nextChats.length === 0 && prev.length > 0 ? prev : nextChats));
        setArtifacts((prev) =>
          nextArtifacts.length === 0 && prev.length > 0 ? prev : nextArtifacts,
        );
      })
      .catch(() => {
        // IndexedDB unavailable/blocked (private mode, storage disabled) —
        // the doc simply stays whatever the localStorage seed + live stream
        // give it; no different than never having a y-indexeddb layer.
      });

    let currentState = handle.connection.getState();
    setConnection(currentState);
    const unsubscribe = handle.connection.subscribe(() => {
      currentState = handle.connection.getState();
      setConnection(currentState);
    });

    // S5 (A): force a fast reconnect on wake signals instead of waiting out
    // the raw backoff ceiling. One instance per mounted epic view — never
    // per-badge-stream (see liveness-recovery.ts's module doc).
    const stopLivenessRecovery = startLivenessRecovery({
      reconnect: (reason) => streamConnection.reconnectAll(reason),
      isLive: () => currentState === "live",
    });

    return () => {
      disposed = true;
      stopLivenessRecovery();
      unsubscribe();
      handle.stream.close();
      // y-indexeddb's own README teardown order: its provider unsubscribes
      // the doc's `update` listener as part of `destroy()`, so it must go
      // before `doc.destroy()` — otherwise a late in-flight update could try
      // to persist against an already-destroyed doc.
      void idb?.destroy();
      doc.destroy();
      registry.destroy();
    };
  }, [streamConnection, epicId]);

  return { chats, artifacts, connection, artifactRooms, docLoaded };
}
