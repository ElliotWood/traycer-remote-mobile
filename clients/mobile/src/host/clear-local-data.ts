/**
 * "Clear local data" recovery action (account sheet). Manual escape hatch for
 * a phone stuck on stale cached app state (an old service worker, stale
 * Cache Storage entries, a stale localStorage projection, or a stale
 * epic-tree IndexedDB doc) — the user previously had to clear site data from
 * OS Settings to recover from exactly this.
 *
 * Scope, deliberately narrow: clears the CLIENT-SIDE CACHE layers only.
 * `traycer.mobile.auth` (the session token, see `auth-service.ts`) is never
 * touched — the user stays signed in. Host configuration
 * (`VITE_HOST_ID`/`VITE_HOST_WS_URL`) is build-time env, not storage, so it's
 * unaffected by definition — nothing to preserve there.
 *
 * The `LOCAL_STORAGE_PREFIXES` below match by PREFIX, not by the full
 * versioned key (`chat-cache:v1:...`). `CACHE_SCHEMA_VERSION`
 * (`cache-config.ts`) bumps by hand whenever a persisted shape changes; a
 * hardcoded version number here would silently stop clearing the OLD
 * version's keys the next time it bumps, defeating the point of a "clear
 * everything stale" button. A prefix match keeps working across every future
 * version without a code change.
 *
 * IMPORTANT CAVEAT: this is a recovery tool for a FUTURE stuck state, not a
 * fix for the incident that prompted it. If the app is already wedged badly
 * enough that this screen can't be reached (a white screen, a crash loop),
 * the button itself is unreachable — that's still an OS Settings → clear
 * site data job. This helps the milder, more common case: the app loads and
 * responds, but something (an old service worker, a stale cached chunk) is
 * behaving wrong.
 */

const LOCAL_STORAGE_PREFIXES = [
  "chat-cache:",
  "epic-proj:",
  "artifact-body:",
  "traycer.mobile.lastSeen",
  "traycer-remote:query-cache",
] as const;

/** Never removed, even if a future prefix were to accidentally overlap it. */
const PRESERVED_LOCAL_STORAGE_KEY = "traycer.mobile.auth";

const INDEXED_DB_PREFIX = "epic-tree:";

/** `indexedDB.deleteDatabase` can hang if a connection is somehow still open elsewhere — bound it so one stuck database can't stall the whole sweep. */
const INDEXED_DB_DELETE_TIMEOUT_MS = 3_000;

type LayerStatus = "ok" | "unavailable" | "error";

export interface ClearLocalDataResult {
  readonly serviceWorker: LayerStatus;
  readonly caches: LayerStatus;
  readonly localStorage: LayerStatus;
  readonly localStorageKeysRemoved: number;
  readonly indexedDb: LayerStatus;
  readonly indexedDbNamesRemoved: readonly string[];
}

async function clearServiceWorkers(): Promise<LayerStatus> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return "unavailable";
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    return "ok";
  } catch {
    return "error";
  }
}

async function clearCacheStorage(): Promise<LayerStatus> {
  if (typeof caches === "undefined") {
    return "unavailable";
  }
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    return "ok";
  } catch {
    return "error";
  }
}

function clearLocalStorageKeys(): { readonly status: LayerStatus; readonly removed: number } {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return { status: "unavailable", removed: 0 };
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null || key === PRESERVED_LOCAL_STORAGE_KEY) continue;
      if (LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      window.localStorage.removeItem(key);
    }
    return { status: "ok", removed: toRemove.length };
  } catch {
    return { status: "error", removed: 0 };
  }
}

function deleteIndexedDbWithTimeout(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(false);
    }, INDEXED_DB_DELETE_TIMEOUT_MS);
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => {
        if (settled) return;
        clearTimeout(timer);
        resolve(true);
      };
      request.onerror = () => {
        if (settled) return;
        clearTimeout(timer);
        resolve(false);
      };
      request.onblocked = () => {
        if (settled) return;
        clearTimeout(timer);
        resolve(false);
      };
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function clearIndexedDb(): Promise<{
  readonly status: LayerStatus;
  readonly removed: readonly string[];
}> {
  if (typeof indexedDB === "undefined") {
    return { status: "unavailable", removed: [] };
  }
  // `indexedDB.databases()` isn't universally available (older Safari) —
  // degrade to a no-op for just this layer rather than throwing; the other
  // three layers still run regardless.
  if (typeof indexedDB.databases !== "function") {
    return { status: "unavailable", removed: [] };
  }
  try {
    const databases = await indexedDB.databases();
    const names = databases
      .map((db) => db.name)
      .filter((name): name is string => name !== undefined && name.startsWith(INDEXED_DB_PREFIX));
    const outcomes = await Promise.all(names.map((name) => deleteIndexedDbWithTimeout(name)));
    const removed = names.filter((_, index) => outcomes[index]);
    return { status: removed.length === names.length ? "ok" : "error", removed };
  } catch {
    return { status: "error", removed: [] };
  }
}

/**
 * Runs all four layers independently (`Promise.all`, each internally
 * try/catch-guarded) — one layer throwing, timing out, or being unsupported
 * must never stop the others from running. Returns a per-layer summary so
 * the UI can report honestly instead of a blanket "done".
 */
export async function clearLocalData(): Promise<ClearLocalDataResult> {
  const [serviceWorker, cacheStorageStatus, localStorageResult, indexedDbResult] = await Promise.all([
    clearServiceWorkers(),
    clearCacheStorage(),
    Promise.resolve().then(clearLocalStorageKeys),
    clearIndexedDb(),
  ]);

  return {
    serviceWorker,
    caches: cacheStorageStatus,
    localStorage: localStorageResult.status,
    localStorageKeysRemoved: localStorageResult.removed,
    indexedDb: indexedDbResult.status,
    indexedDbNamesRemoved: indexedDbResult.removed,
  };
}
