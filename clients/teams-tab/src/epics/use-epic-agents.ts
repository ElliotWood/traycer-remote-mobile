/**
 * The agents inside one epic, from `epic.subscribe`.
 *
 * A LEAN version of what the phone does. Mobile's `useEpicDoc` also carries
 * IndexedDB persistence, a localStorage projection seed and an artifact-room
 * registry — all of which exist because a phone goes offline mid-session. A
 * Teams tab does not, so this holds a `Y.Doc` for the lifetime of the screen
 * and nothing else. The projection itself is shared, not re-derived.
 *
 * WHERE THE TIME ACTUALLY GOES — measured, because the inherited number was
 * from different hardware. Mobile recorded ~8.3s to decode this epic's
 * snapshot, ON A PHONE. Measured here: a 4.02MB update applies in **325ms**,
 * and `applyUpdate` does block the event loop while it does (a timer queued
 * beforehand does not run until it finishes).
 *
 * So the decode is real but not the wait, and designing an eight-second
 * progress experience around it would have been designing for a value that
 * answers a neighbouring question — the neighbour being a device.
 *
 * `loading` and `empty` stay separate regardless: the network legs are still
 * seconds, and rendering "no agents in this epic" before the snapshot lands
 * would state something false while it is in flight. The distinction is
 * justified by the transfer, not by the decode.
 */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  buildChatTree,
  readChatsFromEpicDoc,
  type ChatTree,
  type EpicChatEntry,
} from "@traycer-clients/shared/epic/epic-doc-chats";
import {
  fleetEpicFromLight,
  type FleetEpic,
} from "@traycer-clients/shared/epic/epic-list";
import type { EpicStreamCallbacks } from "@traycer-clients/shared/host-transport/epic-stream-client";
import type { HostStreamConnection } from "@traycer-clients/shared/host-transport/single-host-stream-connection";

/**
 * Named phases of the wait, driven by REAL transport events.
 *
 * No percentages and no timer-driven animation. A bar that advances on a
 * clock rather than on a transition looks like information and carries none —
 * the exact class of thing this project has spent a week removing. Where a
 * duration is unknown, the phase is named and left indeterminate:
 * indeterminate-but-named beats fabricated-but-precise.
 *
 * There is deliberately NO "decoding" phase. Measured at 325ms for 4MB, it is
 * below the threshold anyone perceives, and labelling it would be inventing a
 * stage to make the indicator look thorough.
 */
export type LoadPhase =
  | "connecting"
  | "subscribing"
  | "preparing"
  | "receiving"
  | "retrying";

export const LOAD_PHASE_LABELS: Readonly<Record<LoadPhase, string>> = {
  connecting: "Connecting to your host…",
  subscribing: "Opening the epic…",
  /**
   * The forty seconds. MEASURED from Elliot's frame log, not guessed:
   *
   *   13:36:02.972  subscribe
   *   13:36:03.515  earlyMeta          543ms
   *   13:36:43.299  snapshot meta      39.8s   ← here
   *   13:36:49.155  binary 50.6 MB     +5.9s
   *
   * The host spends ~40s SERIALISING the snapshot before a byte is sent. The
   * copy names that, because "loading" invites the user to blame their
   * connection for something that is not their connection.
   */
  preparing: "Your host is preparing this epic — large epics take a while…",
  receiving: "Downloading the epic…",
  /**
   * The phase that existed as a hole until today.
   *
   * The router's log shows the upstream WebSocket closing before it is
   * established, then re-dialling seconds later. `receiving` was entered on
   * the open-ack and NOTHING walked it back, so the label sat on "Downloading
   * the epic…" straight through a failure and a retry. Elliot watched that
   * for thirty seconds.
   *
   * A progress label that cannot represent "this failed and we are trying
   * again" is the fake-progress problem in a different costume: it is not
   * animating a lie, it is holding a true-once statement long after it stopped
   * being true.
   */
  retrying: "Still waiting on your host — retrying…",
};

/**
 * How long `receiving` may persist with no snapshot before it is no longer an
 * honest description of what is happening.
 *
 * A TIMEOUT rather than only a transport signal, because the drop we actually
 * observed arrives as an upstream close inside the relay — the client may see
 * a silent re-dial and no status transition at all. Reacting only to
 * `onConnectionStatus` would leave the label correct in the cases we already
 * handle and wrong in the case that prompted this.
 */
const RECEIVING_STALL_MS = 12_000;

export type EpicAgentsState =
  /** Subscribed, no snapshot yet. NOT "this epic has no agents". */
  | { readonly kind: "loading"; readonly phase: LoadPhase }
  | {
      readonly kind: "ready";
      readonly chats: readonly EpicChatEntry[];
      readonly tree: ChatTree;
    }
  | { readonly kind: "error"; readonly detail: string };

/**
 * One `Y.Doc` per epic, for the lifetime of the tab.
 *
 * WITHOUT this, every click into an epic opened a fresh subscription and
 * re-downloaded the whole snapshot — 3-4MB — so the second visit cost as much
 * as the first. Elliot reported the epic detail "took ages to load", and he
 * had been in more than once. A repeated multi-second wait is a different
 * problem from a one-time cost, and this is the difference.
 *
 * Module-scoped rather than React state on purpose: it must survive the
 * component unmounting when he navigates back to the list, which is exactly
 * the transition that was paying the cost again.
 *
 * NOT a memory concern at this scale — one doc per epic actually visited, in
 * a tab that is reloaded whenever Teams reloads it. If that changes, an LRU
 * goes here; a cache with no eviction and no bound would be worth flagging,
 * and this one is bounded by "epics the user opened this session".
 */
const DOC_CACHE = new Map<string, { doc: Y.Doc; loaded: boolean }>();

export interface EpicScreenData {
  readonly agents: EpicAgentsState;
  /**
   * The epic itself, from `earlyMeta` — available ~90x sooner than the
   * agents. `null` until that frame lands.
   */
  readonly header: FleetEpic | null;
}

export function useEpicAgents(
  streamConnection: HostStreamConnection | null,
  epicId: string,
): EpicScreenData {
  const [state, setState] = useState<EpicAgentsState>({
    kind: "loading",
    phase: "connecting",
  });
  const [header, setHeader] = useState<FleetEpic | null>(null);
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

    // A cached doc renders IMMEDIATELY on re-entry, before the stream has
    // even dialled. The subscription still opens underneath to pick up
    // changes since — showing known-good rows while refreshing beats a
    // skeleton over data we already hold.
    const cached = DOC_CACHE.get(epicId);
    const doc = cached?.doc ?? new Y.Doc();
    if (cached === undefined) {
      DOC_CACHE.set(epicId, { doc, loaded: false });
    }
    lastSerialized.current = null;
    if (cached?.loaded === true) {
      const chats = readChatsFromEpicDoc(doc);
      lastSerialized.current = JSON.stringify(chats);
      setState({ kind: "ready", chats, tree: buildChatTree(chats) });
    } else {
      setState({ kind: "loading", phase: "connecting" });
    }
    let disposed = false;

    /**
     * Phase timings, logged once per load.
     *
     * The wait Elliot reported has not been attributed yet, and the pieces
     * measured so far do not account for it: dial+upgrade 197ms,
     * permessage-deflate negotiated, decode 325ms for 4MB. Rather than ship
     * against a suspect — this project's plausible hypotheses have a poor
     * record — the real legs are recorded so the next slow load says where
     * the time went instead of inviting another guess.
     */
    const t0 = Date.now();
    const marks: string[] = [];
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallWatchdog = (): void => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (disposed) return;
        setState((prev) =>
          prev.kind === "loading" ? { kind: "loading", phase: "retrying" } : prev,
        );
      }, RECEIVING_STALL_MS);
    };
    const mark = (name: string): void => {
      marks.push(`${name}=${String(Date.now() - t0)}ms`);
    };

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
        mark("snapshot-arrived");
        clearTimeout(stallTimer);
        const decodeStart = Date.now();
        Y.applyUpdate(doc, snapshotBytes);
        marks.push(`bytes=${String(snapshotBytes.byteLength)}`);
        marks.push(`decode=${String(Date.now() - decodeStart)}ms`);
        // eslint-disable-next-line no-console -- the only channel a Teams tab
        // has for this; there is no devtools timeline anyone will open in there.
        console.info(`[epic ${epicId.slice(0, 8)}] ${marks.join(" ")}`);
        // Only NOW is the cache entry worth reusing. Marking it loaded at
        // creation would let a later visit render an empty doc we made
        // ourselves as though it were a confirmed-empty epic.
        DOC_CACHE.set(epicId, { doc, loaded: true });
        refresh();
      },
      onUpdate: (updateBytes) => {
        Y.applyUpdate(doc, updateBytes);
        refresh();
      },
      /**
       * THE FAST PATH WE WERE THROWING AWAY.
       *
       * `earlyMeta` lands in ~543ms carrying the epic's title, all four
       * artifact counts and its status — everything the header needs — while
       * the full snapshot takes ~47s. The screen rendered a skeleton for the
       * whole 47s with that in hand at half a second.
       *
       * Its existence suggests the host already knows the snapshot is slow:
       * this is a deliberate fast path, and we simply were not consuming it.
       */
      onEarlyMeta: (meta) => {
        mark("early-meta");
        if (disposed) return;
        if (meta.epicLight !== null) {
          setHeader(fleetEpicFromLight(meta.epicLight));
        }
        armStallWatchdog();
        setState((prev) =>
          prev.kind === "loading" ? { kind: "loading", phase: "preparing" } : prev,
        );
      },
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
      onConnectionStatus: (status) => {
        if (disposed) return;
        if (status === "open") mark("socket-open");
        setState((prev) => {
          if (prev.kind !== "loading") return prev;
          // Only ever advances toward the snapshot; a reconnect mid-load must
          // not report "downloading" when the socket just dropped.
          if (status === "open") return { kind: "loading", phase: "subscribing" };
          return { kind: "loading", phase: "connecting" };
        });
      },
      onMigrationStarted: () => undefined,
      onMigrationProgress: () => undefined,
      onMigrationFailed: () => undefined,
      onMigrationNotAllowed: () => undefined,
    };

    const handle = streamConnection.openEpic({ epicId, callbacks });
    return () => {
      disposed = true;
      clearTimeout(stallTimer);
      handle.stream.close();
    };
  }, [streamConnection, epicId]);

  return { agents: state, header };
}
