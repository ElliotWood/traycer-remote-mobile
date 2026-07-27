/**
 * Per-artifact-room Y.Doc replica registry (Mobile v2, Sprint 3 / F2).
 *
 * `epic.subscribe` has no "open this room" client frame (verified against
 * `protocol/src/host/epic/subscribe.ts`): `artifactRoomSnapshot`/`Update`/
 * `State` frames arrive for a room whenever the host's artifact-room manager
 * observes it, independent of client intent, and a snapshot fires only ONCE
 * per `ready` transition per session. Discarding bytes for a room the user
 * hasn't opened yet risks permanently missing that one snapshot. So this
 * registry keeps one lightweight `Y.Doc` per `artifactRoomId` alive for the
 * whole `epic.subscribe` session — cheap `Y.applyUpdate` calls only, no
 * rendering, no markdown serialization. The EXPENSIVE work (XmlFragment →
 * markdown) is deferred entirely to `useArtifactBody`, which only runs it
 * for the currently-open artifact.
 *
 * Framework-agnostic (no React import) so it is unit-testable directly, same
 * pattern as `StreamConnectionStateStore`.
 */
import * as Y from "yjs";
import type { EpicArtifactRoomAvailability } from "@traycer/protocol/host/epic/subscribe";

interface RoomEntry {
  doc: Y.Doc;
  /** `null` = never reported by the host yet. */
  state: EpicArtifactRoomAvailability | null;
}

export class ArtifactRoomRegistry {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();

  private getOrCreate(artifactRoomId: string): RoomEntry {
    let entry = this.rooms.get(artifactRoomId);
    if (entry === undefined) {
      entry = { doc: new Y.Doc(), state: null };
      this.rooms.set(artifactRoomId, entry);
    }
    return entry;
  }

  applySnapshot(artifactRoomId: string, snapshotBytes: Uint8Array): void {
    const entry = this.getOrCreate(artifactRoomId);
    Y.applyUpdate(entry.doc, snapshotBytes);
    this.notify(artifactRoomId);
  }

  applyUpdate(artifactRoomId: string, updateBytes: Uint8Array): void {
    const entry = this.getOrCreate(artifactRoomId);
    Y.applyUpdate(entry.doc, updateBytes);
    this.notify(artifactRoomId);
  }

  /**
   * Round-2 (a): a room transitioning OUT of `ready` invalidates the local
   * replica immediately — the next `artifactRoomSnapshot` rebuilds it from
   * scratch (mirrors gui-app `store.ts:1250-1256`). A body currently open on
   * this room must see the state flip on the same tick via `subscribe`, not
   * keep rendering now-stale content as if it were still live.
   */
  applyState(artifactRoomId: string, state: EpicArtifactRoomAvailability): void {
    const entry = this.getOrCreate(artifactRoomId);
    const previous = entry.state;
    entry.state = state;
    if (state !== "ready" && previous !== state) {
      entry.doc.destroy();
      entry.doc = new Y.Doc();
    }
    this.notify(artifactRoomId);
  }

  /**
   * Round-2 (b): a room absent from the state map (the host has never
   * reported on it at all this session) reads as `unavailable`, not an
   * indefinite pending state (mirrors gui-app `store.ts:272-276`).
   */
  getState(artifactRoomId: string): EpicArtifactRoomAvailability {
    return this.rooms.get(artifactRoomId)?.state ?? "unavailable";
  }

  getDoc(artifactRoomId: string): Y.Doc | null {
    return this.rooms.get(artifactRoomId)?.doc ?? null;
  }

  subscribe(artifactRoomId: string, listener: () => void): () => void {
    let set = this.listeners.get(artifactRoomId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(artifactRoomId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private notify(artifactRoomId: string): void {
    const set = this.listeners.get(artifactRoomId);
    if (set === undefined) return;
    for (const listener of [...set]) listener();
  }

  /**
   * Tears down every room replica at once — called from `useEpicDoc`'s
   * effect cleanup (the epic view unmounting), mirroring today's single-
   * root-doc teardown. Idempotent.
   */
  destroy(): void {
    for (const entry of this.rooms.values()) {
      entry.doc.destroy();
    }
    this.rooms.clear();
    this.listeners.clear();
  }
}
