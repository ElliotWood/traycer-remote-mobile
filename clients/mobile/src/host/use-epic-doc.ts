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
import { useEffect, useState } from "react";
import * as Y from "yjs";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import type { CardKind, ArtifactStatus } from "@/views/kind-tokens";
import { ArtifactRoomRegistry } from "./artifact-room-registry";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import { startLivenessRecovery } from "./liveness-recovery";

/**
 * One chat enumerated from the epic doc — the minimum a row + badge needs.
 * `parentId`/`createdAt`/`updatedAt` (P1) mirror `chatSchema`
 * (persistence/epic/chat.ts:44) and feed the Agents tree's nesting + default
 * sort, exactly as `EpicArtifactEntry`'s equivalents already do below.
 */
export interface EpicChatEntry {
  readonly chatId: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Pure projection of the chats slice from an epic `Y.Doc`. Independently
 * unit-testable: build a `Y.Doc`, populate `epic → chats`, assert the output.
 * Mirrors `projectChatsSlice` (projection-helpers.ts:560) minus visibility
 * filtering and the extra projected fields.
 */
export function readChatsFromEpicDoc(doc: Y.Doc): readonly EpicChatEntry[] {
  const chatsValue = doc.getMap("epic").get("chats");
  if (!(chatsValue instanceof Y.Map)) {
    return [];
  }
  const out: EpicChatEntry[] = [];
  for (const [chatId, entry] of chatsValue.entries()) {
    // A well-formed chat record is a nested Y.Map. Anything else (a stray
    // primitive, a partially-replicated entry) is skipped rather than crashing
    // the whole list — exactly how `projectChatsSlice` guards each entry.
    if (!(entry instanceof Y.Map)) {
      continue;
    }
    const rawTitle = entry.get("title");
    const rawParentId = entry.get("parentId");
    out.push({
      chatId,
      title: typeof rawTitle === "string" ? rawTitle : "",
      parentId: typeof rawParentId === "string" ? rawParentId : null,
      createdAt: readMaybeNumber(entry.get("createdAt"), 0),
      updatedAt: readMaybeNumber(entry.get("updatedAt"), 0),
    });
  }
  return out;
}

/** One artifact enumerated from the epic doc's `artifacts` Y.Map. */
export interface EpicArtifactEntry {
  readonly id: string;
  readonly kind: CardKind;
  readonly title: string;
  readonly parentId: string | null;
  readonly artifactRoomId: string;
  /** `null` for spec/review (they never carry a status). */
  readonly status: ArtifactStatus | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const CARD_KINDS: ReadonlySet<string> = new Set(["spec", "ticket", "story", "review"]);

function isCardKindValue(value: unknown): value is CardKind {
  return typeof value === "string" && CARD_KINDS.has(value);
}

function readMaybeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readMaybeStatus(value: unknown): ArtifactStatus | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

/**
 * Pure projection of the artifacts slice from an epic `Y.Doc` (mirrors
 * `readChatsFromEpicDoc`). Tolerant of malformed entries — a stray
 * primitive, an unrecognized `kind`, or a partially-replicated record is
 * skipped rather than crashing the whole tree.
 */
export function readArtifactsFromEpicDoc(doc: Y.Doc): readonly EpicArtifactEntry[] {
  const artifactsValue = doc.getMap("epic").get("artifacts");
  if (!(artifactsValue instanceof Y.Map)) {
    return [];
  }
  const out: EpicArtifactEntry[] = [];
  for (const [id, entry] of artifactsValue.entries()) {
    if (!(entry instanceof Y.Map)) continue;
    const kind = entry.get("kind");
    if (!isCardKindValue(kind)) continue;
    const rawTitle = entry.get("title");
    const rawParentId = entry.get("parentId");
    const rawArtifactRoomId = entry.get("artifactRoomId");
    out.push({
      id,
      kind,
      title: typeof rawTitle === "string" ? rawTitle : "",
      parentId: typeof rawParentId === "string" ? rawParentId : null,
      artifactRoomId: typeof rawArtifactRoomId === "string" ? rawArtifactRoomId : "",
      status: kind === "ticket" || kind === "story" ? readMaybeStatus(entry.get("status")) : null,
      createdAt: readMaybeNumber(entry.get("createdAt"), 0),
      updatedAt: readMaybeNumber(entry.get("updatedAt"), 0),
    });
  }
  return out;
}

export interface ArtifactTree {
  readonly roots: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly byId: Readonly<Record<string, EpicArtifactEntry>>;
}

export interface ChatTree {
  readonly roots: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly byId: Readonly<Record<string, EpicChatEntry>>;
}

interface ParentedNode {
  readonly parentId: string | null;
  readonly updatedAt: number;
}

/**
 * Sibling comparator mirroring desktop's `DEFAULT_SORT_MODE` (`updatedAt`
 * DESC, id ASC tie-break) — `epic-sort.ts`'s `makeNodeComparator`, scoped
 * down to the two fields this tree needs rather than porting the full
 * multi-field module. Shared by the chat and artifact trees (P1) since both
 * nest by `parentId` under the identical desktop default-sort rule.
 */
function compareParentedNodes(aId: string, a: ParentedNode, bId: string, b: ParentedNode): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * Nests entries by `parentId`. A `parentId` that points at an id not present
 * in `entries` (deleted parent, stale reference) promotes the child to root
 * rather than dropping it — mirrors `resolveEffectiveParent`'s "unknown id ->
 * null (orphan promotion)" rule. Generic over chats and artifacts (P1) — both
 * families nest by `parentId` within their own map, never across families;
 * `keyOf` supplies each family's identity field (`id` vs `chatId`).
 */
function buildParentedTree<T extends ParentedNode>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): {
  readonly roots: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly byId: Readonly<Record<string, T>>;
} {
  const byId: Record<string, T> = {};
  for (const entry of entries) byId[keyOf(entry)] = entry;

  const rootsUnsorted: T[] = [];
  const childrenUnsorted: Record<string, T[]> = {};
  for (const entry of entries) {
    const effectiveParentId =
      entry.parentId !== null && Object.hasOwn(byId, entry.parentId) ? entry.parentId : null;
    if (effectiveParentId === null) {
      rootsUnsorted.push(entry);
      continue;
    }
    (childrenUnsorted[effectiveParentId] ??= []).push(entry);
  }

  const sortIds = (nodes: readonly T[]): readonly string[] =>
    [...nodes].sort((a, b) => compareParentedNodes(keyOf(a), a, keyOf(b), b)).map(keyOf);

  const childrenByParent: Record<string, readonly string[]> = {};
  for (const [parentId, children] of Object.entries(childrenUnsorted)) {
    childrenByParent[parentId] = sortIds(children);
  }

  return { roots: sortIds(rootsUnsorted), childrenByParent, byId };
}

export function buildArtifactTree(entries: readonly EpicArtifactEntry[]): ArtifactTree {
  return buildParentedTree(entries, (e) => e.id);
}

/** Chat-tree equivalent of {@link buildArtifactTree}, keyed by `chatId`. */
export function buildChatTree(entries: readonly EpicChatEntry[]): ChatTree {
  return buildParentedTree(entries, (e) => e.chatId);
}

export interface UseEpicDocResult {
  readonly chats: readonly EpicChatEntry[];
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly connection: StreamConnectionState;
  /** `null` when disconnected (no host / no session open). */
  readonly artifactRooms: ArtifactRoomRegistry | null;
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
): EpicStreamCallbacks {
  return {
    onSnapshot: (_meta, snapshotBytes) => {
      Y.applyUpdate(doc, snapshotBytes);
      onDocChanged();
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
  const [chats, setChats] = useState<readonly EpicChatEntry[]>([]);
  const [artifacts, setArtifacts] = useState<readonly EpicArtifactEntry[]>([]);
  const [connection, setConnection] =
    useState<StreamConnectionState>("reconnecting");
  const [artifactRooms, setArtifactRooms] = useState<ArtifactRoomRegistry | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setChats([]);
      setArtifacts([]);
      setArtifactRooms(null);
      setConnection("disconnected");
      return;
    }

    const doc = new Y.Doc();
    const registry = new ArtifactRoomRegistry();
    setArtifactRooms(registry);
    let disposed = false;
    const refresh = (): void => {
      if (disposed) return;
      setChats(readChatsFromEpicDoc(doc));
      setArtifacts(readArtifactsFromEpicDoc(doc));
    };

    const handle = streamConnection.openEpic({
      epicId,
      callbacks: makeEpicDocCallbacks(doc, registry, refresh),
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
      doc.destroy();
      registry.destroy();
    };
  }, [streamConnection, epicId]);

  return { chats, artifacts, connection, artifactRooms };
}
