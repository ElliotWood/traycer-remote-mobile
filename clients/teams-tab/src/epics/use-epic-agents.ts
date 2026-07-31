/**
 * The agents inside one epic, from `epic.subscribe`.
 *
 * A LEAN version of what the phone does. Mobile's `useEpicDoc` also carries
 * IndexedDB persistence, a localStorage projection seed and an artifact-room
 * registry — all of which exist because a phone goes offline mid-session. A
 * Teams tab does not, so this holds a `Y.Doc` for the lifetime of the screen
 * and nothing else. The projection itself is shared, not re-derived.
 *
 * LOADING IS NOT COSMETIC HERE. Mobile measured this epic's snapshot at
 * ~3.2MB and ~8.3s to decode. A surface that renders "no agents" while that
 * is in flight would state something false for eight seconds, which is the
 * whole reason `loading` and `empty` are separate states rather than one
 * "nothing to show".
 */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  buildChatTree,
  readChatsFromEpicDoc,
  type ChatTree,
  type EpicChatEntry,
} from "@traycer-clients/shared/epic/epic-doc-chats";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";

export type EpicAgentsState =
  /** Subscribed, no snapshot yet. NOT "this epic has no agents". */
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly chats: readonly EpicChatEntry[];
      readonly tree: ChatTree;
    }
  | { readonly kind: "error"; readonly detail: string };

export function useEpicAgents(
  streamConnection: HostStreamConnection | null,
  epicId: string,
): EpicAgentsState {
  const [state, setState] = useState<EpicAgentsState>({ kind: "loading" });
  // Serialised comparison, so an update frame that changes an artifact does
  // not hand the agents list a new array identity and re-render every row.
  const lastSerialized = useRef<string | null>(null);

  useEffect(() => {
    if (streamConnection === null) {
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }

    setState({ kind: "loading" });
    lastSerialized.current = null;
    const doc = new Y.Doc();
    let disposed = false;

    const refresh = (): void => {
      if (disposed) return;
      const chats = readChatsFromEpicDoc(doc);
      const serialized = JSON.stringify(chats);
      if (serialized === lastSerialized.current) return;
      lastSerialized.current = serialized;
      setState({ kind: "ready", chats, tree: buildChatTree(chats) });
    };

    // Only snapshot and update frames matter for this screen. The rest are
    // deliberately no-ops rather than unimplemented: artifact rooms, awareness
    // and migration lifecycle are real concerns that this surface does not
    // render, and a silent no-op is honest where a throw would take down a
    // screen over a frame it does not use.
    const callbacks: EpicStreamCallbacks = {
      onSnapshot: (_meta, snapshotBytes) => {
        Y.applyUpdate(doc, snapshotBytes);
        refresh();
      },
      onUpdate: (updateBytes) => {
        Y.applyUpdate(doc, updateBytes);
        refresh();
      },
      onEarlyMeta: () => undefined,
      onAwareness: () => undefined,
      onPermissionChanged: () => undefined,
      onEpicDeleted: () => {
        if (disposed) return;
        // A deleted epic is not an empty one, and must not render as "no
        // agents" — that would state the epic exists and is idle.
        setState({
          kind: "error",
          detail: "This epic was deleted.",
        });
      },
      onArtifactRoomSnapshot: () => undefined,
      onArtifactRoomUpdate: () => undefined,
      onArtifactRoomAwareness: () => undefined,
      onArtifactRoomState: () => undefined,
      onCloudSyncStatus: () => undefined,
      onConnectionStatus: () => undefined,
      onMigrationStarted: () => undefined,
      onMigrationProgress: () => undefined,
      onMigrationFailed: () => undefined,
      onMigrationNotAllowed: () => undefined,
    };

    const handle = streamConnection.openEpic({ epicId, callbacks });
    return () => {
      disposed = true;
      handle.stream.close();
    };
  }, [streamConnection, epicId]);

  return state;
}
