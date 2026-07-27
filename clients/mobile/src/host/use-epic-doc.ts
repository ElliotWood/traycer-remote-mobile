/**
 * Epic Y.Doc reader + React hook (T5).
 *
 * Opens `epic.subscribe` (via T3's `HostStreamConnection`), applies the snapshot
 * and every incremental update into a local Yjs `Y.Doc`, and projects the ONE
 * slice the phone's epic detail needs: the chat list. This is a deliberately
 * MINIMAL reader — not a port of gui-app's `epic-projector` (which maintains
 * artifacts, tree, tuiAgents, identity-stable byId slices, per-user visibility).
 * We only need `{ chatId, title }` per chat to render rows + open per-chat badge
 * streams.
 *
 * Y.Doc contract (verified against gui-app source of truth):
 *   - root:  `doc.getMap("epic")`                    projection-helpers.ts:59
 *   - chats: `epicMap.get("chats")` — a `Y.Map`      projection-helpers.ts:83
 *            keyed by chatId (the map KEY is the id)  projection-helpers.ts:562
 *   - each entry is a `Y.Map`; title is the `title`  projection-helpers.ts:251
 *            string field (absent/non-string → "")   projection-helpers.ts:120
 *
 * Deviation from gui-app: the full projector drops chats owned by a different
 * user (`isChatVisibleToUser`, projection-helpers.ts:565). This reader does NOT
 * filter by `userId` — it lists every chat in the map. The phone dials the
 * user's own host, so the epic's chats are theirs; threading the signed-in user
 * id into a pure reader would be the projector port the ticket rules out. If a
 * shared/multi-collaborator epic ever surfaces here, this over-lists. Flagged.
 */
import { useEffect, useState } from "react";
import * as Y from "yjs";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import type { HostStreamConnection } from "./stream-connection";
import type { StreamConnectionState } from "./stream-connection";
import { startLivenessRecovery } from "./liveness-recovery";

/** One chat enumerated from the epic doc — the minimum a row + badge needs. */
export interface EpicChatEntry {
  readonly chatId: string;
  readonly title: string;
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
    out.push({
      chatId,
      title: typeof rawTitle === "string" ? rawTitle : "",
    });
  }
  return out;
}

export interface UseEpicDocResult {
  readonly chats: readonly EpicChatEntry[];
  readonly connection: StreamConnectionState;
}

/**
 * Builds the epic-stream callbacks that feed a local `Y.Doc`. Only the snapshot
 * and incremental-update frames carry doc bytes we care about; every other
 * required callback (artifact-room fan-out, migration lifecycle, awareness,
 * permission/deletion, connection status) is a no-op here — the connection
 * state is read off the handle's `StreamConnectionStateStore`, and body/artifact
 * concerns are out of scope for the phone's chat enumeration.
 */
function makeEpicDocCallbacks(
  doc: Y.Doc,
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
    onArtifactRoomSnapshot: () => {},
    onArtifactRoomUpdate: () => {},
    onArtifactRoomAwareness: () => {},
    onArtifactRoomState: () => {},
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
 * Subscribes a component to an epic's chat list + live connection state.
 *
 * Lifecycle: one `epic.subscribe` session is opened per (connection, epicId).
 * Its snapshot/update bytes are applied into a fresh `Y.Doc`, and the chat list
 * is re-derived on every frame. On unmount (or an epicId/connection change) the
 * effect cleanup closes the stream and destroys the doc — no leaked socket, no
 * detached observer. A `null` connection (no host) yields an empty list in the
 * "disconnected" state without opening anything.
 */
export function useEpicDoc(
  streamConnection: HostStreamConnection | null,
  epicId: string,
): UseEpicDocResult {
  const [chats, setChats] = useState<readonly EpicChatEntry[]>([]);
  const [connection, setConnection] =
    useState<StreamConnectionState>("reconnecting");

  useEffect(() => {
    if (streamConnection === null) {
      setChats([]);
      setConnection("disconnected");
      return;
    }

    const doc = new Y.Doc();
    let disposed = false;
    const refresh = (): void => {
      if (disposed) return;
      setChats(readChatsFromEpicDoc(doc));
    };

    const handle = streamConnection.openEpic({
      epicId,
      callbacks: makeEpicDocCallbacks(doc, refresh),
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
    };
  }, [streamConnection, epicId]);

  return { chats, connection };
}
