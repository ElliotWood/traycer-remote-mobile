/**
 * Turning `unknown` from storage back into a canvas, and never throwing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY EVERY READER HERE TAKES `unknown`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A stored layout is **user data written by an older build**. Not a fixture,
 * not a wire message with a schema either end agrees on — a snapshot that may
 * predate every change since. The failure mode of getting this wrong is the
 * worst one available: a user opens the tab and it throws on boot, with a
 * layout they cannot see, cannot clear, and did not know existed.
 *
 * So: drop malformed entries, keep what parses, and let `reconcile()` restore
 * the invariants. **There is no error path, only a smaller canvas.**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A TILE KIND WE NO LONGER RENDER MUST DEGRADE, NOT THROW
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `tile-ref.ts` defers four of the desktop's eight kinds, and that list will
 * move in both directions — a kind added and later removed leaves layouts
 * naming it. `parseTileRef` returns null for a type it does not know, the tab
 * disappears, and everything around it survives.
 *
 * This is the same shape as `splitPane` declining past `MAX_TREE_DEPTH`:
 * **refusing an operation is a behaviour; crashing is not.** Stored state is
 * where "it worked when I wrote it" ages worst, because the writer and the
 * reader are different versions of the program by construction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE VERSION FIELD DOES SOMETHING, OR IT WOULD NOT BE HERE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A version nobody branches on is cargo cult. This one has exactly one job:
 * **refuse a layout written by a NEWER build than this one.** That case is
 * real in this client — the tab is served from a CDN-cached bundle and a user
 * can hold an older `index-*.js` than the one that wrote their localStorage,
 * on the same machine, in another tab.
 *
 * Older versions are NOT refused. The parser is total, so an older shape
 * degrades on its own; refusing it would discard a layout we can mostly read.
 */
import type { TileRef, TileKind } from "./tile-ref";
import type { SizesByGroupId, TileLayoutNode } from "./tile-tree";
import { EMPTY_CANVAS, reconcile, type CanvasState } from "./canvas-state";

/** Bump when a stored shape changes meaning, not when a field is added. */
export const CANVAS_STORAGE_VERSION = 1;

export const CANVAS_STORAGE_KEY = "traycer.teams-tab.canvas";

/**
 * The kinds this build can restore.
 *
 * Bound to the union via `Record<TileKind, true>`, so a kind added to
 * `TileRef` without a decision here is a COMPILE error rather than a tab that
 * silently fails to restore.
 *
 * ─── This started as a guard that could not fail ───
 *
 * The first version checked `KNOWN_TILE_KINDS` and then fell through to a
 * second, narrower check for artifact kinds — which already returned null for
 * anything unknown. So the first check was dead: **mutating it away changed
 * no test**, while the comment above it called it "the degrade point".
 *
 * The mutation run found it; reading did not. Kept as one check that the
 * whole parse narrows through, so the runtime guard and the compile-time
 * exhaustiveness are the same line rather than two rules that agree by
 * coincidence.
 */
const KNOWN_TILE_KINDS: Readonly<Record<TileKind, true>> = {
  chat: true,
  spec: true,
  ticket: true,
  story: true,
  review: true,
  blank: true,
};

function isKnownTileKind(value: string): value is TileKind {
  return Object.hasOwn(KNOWN_TILE_KINDS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseTileRef(value: unknown): TileRef | null {
  if (!isRecord(value)) return null;
  const type = str(value.type);
  const id = str(value.id);
  const instanceId = str(value.instanceId);
  const hostId = str(value.hostId);
  const name = str(value.name);
  if (
    type === null ||
    id === null ||
    instanceId === null ||
    hostId === null ||
    name === null
  ) {
    return null;
  }
  // THE degrade point, and the only one. A kind this build does not render is
  // dropped here; the rest of the layout is unaffected.
  if (!isKnownTileKind(type)) return null;

  // Every variant of `TileRef` carries exactly these fields and differs only
  // in `type`, so the switch is over the narrowed literal rather than a
  // per-variant constructor. `never` in the default makes a new kind that
  // reaches here a compile error instead of a silent drop.
  switch (type) {
    case "chat":
    case "blank":
      return { type, id, instanceId, name, hostId };
    case "spec":
    case "ticket":
    case "story":
    case "review":
      return { type, id, instanceId, name, hostId };
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function parseStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseNode(value: unknown): TileLayoutNode | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (id === null) return null;

  if (value.kind === "pane") {
    const tabInstanceIds = parseStringArray(value.tabInstanceIds);
    const activeTabId = str(value.activeTabId);
    const previewTabId = str(value.previewTabId);
    return {
      kind: "pane",
      id,
      tabInstanceIds,
      // Membership is NOT checked here — `reconcile` owns that, and doing it
      // in two places is how the two rules drift apart.
      activeTabId,
      previewTabId,
      activationHistory: parseStringArray(value.activationHistory),
    };
  }

  if (value.kind === "group") {
    const direction =
      value.direction === "horizontal" || value.direction === "vertical"
        ? value.direction
        : null;
    if (direction === null || !Array.isArray(value.children)) return null;
    const children = value.children.flatMap((child) => {
      const node = parseNode(child);
      return node === null ? [] : [node];
    });
    // A group needs two children to mean anything. One survivor is PROMOTED
    // rather than dropped — the alternative discards a live pane because its
    // sibling was malformed, which is a much bigger loss than a lost split.
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { kind: "group", id, direction, children };
  }

  return null;
}

function parseSizes(value: unknown): SizesByGroupId {
  if (!isRecord(value)) return {};
  const out: Record<string, ReadonlyArray<number>> = {};
  for (const [groupId, sizes] of Object.entries(value)) {
    if (!Array.isArray(sizes)) continue;
    const numbers = sizes.filter(
      (entry): entry is number => typeof entry === "number" && Number.isFinite(entry) && entry > 0,
    );
    // A partially-numeric list is dropped rather than repaired: a group with
    // three children and two readable fractions would restore with the wrong
    // proportions, and `sizesForGroup` already falls back to even sizes when
    // the count does not match.
    if (numbers.length === sizes.length && numbers.length > 0) {
      out[groupId] = numbers;
    }
  }
  return out;
}

export function parseCanvasState(value: unknown): CanvasState {
  if (!isRecord(value)) return EMPTY_CANVAS;

  const version = value.version;
  if (typeof version === "number" && version > CANVAS_STORAGE_VERSION) {
    // Written by a newer build. Reading it would be guessing at a shape that
    // has changed meaning — the one thing this parser cannot recover from,
    // because it looks valid.
    return EMPTY_CANVAS;
  }

  const root = parseNode(value.root);
  if (root === null) return EMPTY_CANVAS;

  const tiles = isRecord(value.tilesByInstanceId) ? value.tilesByInstanceId : {};
  const tilesByInstanceId: Record<string, TileRef> = {};
  for (const [instanceId, raw] of Object.entries(tiles)) {
    const tile = parseTileRef(raw);
    // The key must agree with the payload. A mismatch means the tree's
    // reference resolves to a tile describing something else — worse than a
    // missing tab, because it renders confidently.
    if (tile !== null && tile.instanceId === instanceId) {
      tilesByInstanceId[instanceId] = tile;
    }
  }

  return reconcile({
    root,
    activePaneId: str(value.activePaneId),
    tilesByInstanceId,
    sizesByGroupId: parseSizes(value.sizesByGroupId),
  });
}

export function serializeCanvasState(state: CanvasState): string {
  return JSON.stringify({ version: CANVAS_STORAGE_VERSION, ...state });
}

/**
 * The storage seam, injected rather than reaching for `window.localStorage`.
 *
 * Not for testability alone: **this tab runs inside a Teams iframe, and
 * `localStorage` access THROWS** — not returns null — when the embedding
 * context blocks third-party storage. A module-level `window.localStorage`
 * reference turns that into a boot failure on exactly the platform this
 * client exists for.
 */
export interface CanvasStorage {
  readonly read: () => string | null;
  readonly write: (value: string) => void;
}

/**
 * `localStorage` if it is usable, otherwise a no-op that reports nothing
 * stored. Silent by design: a user who cannot persist a layout is better
 * served by a canvas that resets than by an error about a storage policy they
 * do not control and cannot change from here.
 */
export function browserCanvasStorage(key: string): CanvasStorage {
  return {
    read: () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Quota exceeded or storage blocked. The canvas keeps working; only
        // its survival across reload is lost.
      }
    },
  };
}

export function loadCanvas(storage: CanvasStorage): CanvasState {
  const raw = storage.read();
  if (raw === null) return EMPTY_CANVAS;
  try {
    return parseCanvasState(JSON.parse(raw));
  } catch {
    // Not JSON at all. Another script's key collision, a truncated write, a
    // half-synced profile — all of which a user experiences as "the tab is
    // broken" if this rethrows.
    return EMPTY_CANVAS;
  }
}

export function saveCanvas(storage: CanvasStorage, state: CanvasState): void {
  storage.write(serializeCanvasState(state));
}
