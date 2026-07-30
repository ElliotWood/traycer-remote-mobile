/**
 * Local read-tracking store (P1 — Epic tree unread markers).
 *
 * Desktop's `unreadFailure`/`unreadDone`/artifact-unread-bar all read a
 * HOST-side `notifications.*` RPC + local unread store — mobile has no
 * client for that surface (see the P1 contract). This is the mobile-local
 * equivalent for a single-device phone client: a plain
 * `epicId:nodeId -> lastSeenAt` map in `localStorage`, bumped when the user
 * actually opens a chat/artifact. It does not sync with desktop's own
 * read-state — acceptable for a client with exactly one reader, not claimed
 * to be anything more.
 *
 * Seeding matters: on a node's FIRST-EVER observation there is no stored
 * mark, and comparing "no mark" to "unread" would paint an entire fresh
 * tree blue on first load (worse than no unread markers at all — Evaluator
 * tighten #1). `seedUnseen` fixes each node's initial mark to its OWN
 * `updatedAt` (not `Date.now()`), so only activity that happens AFTER the
 * seed reads as unread.
 */
import { safeStorage } from "@traycer-clients/shared/platform/safe-storage";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY_PREFIX = "traycer.mobile.lastSeen";

function storageKey(epicId: string, nodeId: string): string {
  return `${KEY_PREFIX}.${epicId}.${nodeId}`;
}

/** Never a bare `globalThis.localStorage` — the access itself throws when storage is denied. */
function defaultStorage(): StorageLike {
  return safeStorage();
}

/** The stored last-seen timestamp for one node, or `null` if never recorded. */
export function getLastSeenAt(
  epicId: string,
  nodeId: string,
  storage: StorageLike = defaultStorage(),
): number | null {
  const raw = storage.getItem(storageKey(epicId, nodeId));
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Seeds every node in `updatedAtById` that has no stored mark yet to its own
 * `updatedAt`. Already-seeded nodes (returning) are left untouched — this is
 * additive per node, not a per-epic one-shot flag, so a node that first
 * appears in a later render (a chat created after the tree was already open)
 * still gets a correct non-retroactive seed instead of reading as
 * permanently unread or being skipped.
 */
export function seedUnseen(
  epicId: string,
  updatedAtById: Readonly<Record<string, number>>,
  storage: StorageLike = defaultStorage(),
): void {
  for (const [nodeId, updatedAt] of Object.entries(updatedAtById)) {
    if (getLastSeenAt(epicId, nodeId, storage) === null) {
      storage.setItem(storageKey(epicId, nodeId), String(updatedAt));
    }
  }
}

/** Marks a node seen right now — call when the user actually opens it. */
export function markSeen(
  epicId: string,
  nodeId: string,
  at: number = Date.now(),
  storage: StorageLike = defaultStorage(),
): void {
  storage.setItem(storageKey(epicId, nodeId), String(at));
}

/**
 * A node reads unread when its `updatedAt` is strictly newer than its
 * last-seen mark. A node with no mark at all reads as NOT unread — callers
 * must run `seedUnseen` first so "never seen" and "seeded, no new activity"
 * are both non-unread, and only genuine post-seed activity flips it.
 */
export function isUnread(
  epicId: string,
  nodeId: string,
  updatedAt: number,
  storage: StorageLike = defaultStorage(),
): boolean {
  const lastSeenAt = getLastSeenAt(epicId, nodeId, storage);
  if (lastSeenAt === null) {
    return false;
  }
  return updatedAt > lastSeenAt;
}
