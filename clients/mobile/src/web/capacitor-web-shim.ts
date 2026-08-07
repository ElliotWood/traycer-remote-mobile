/**
 * BROWSER-PROOF SCAFFOLDING ONLY.
 *
 * `mobile-runner-host.ts` is the single file in the whole mobile web entry
 * that imports Capacitor (`@capacitor/browser`, `capacitor-secure-storage-
 * plugin`). Both are aliased to this module by `vite.config.web.ts` so the
 * bundle carries no Capacitor runtime at all - the point of the exercise is
 * to show gui-app itself runs in a plain browser.
 *
 * These are deliberately the laziest correct substitutes:
 *   Browser.open  -> window.open (device-flow sign-in opens a tab)
 *   SecureStorage -> safe-storage (NOT secure - see below)
 *
 * STORAGE GOES THROUGH `safe-storage.ts`, NOT `window.localStorage`.
 * That file is a verbatim copy of `clients/shared/platform/safe-storage.ts`
 * on `main` - the same 112 self-contained lines with zero imports, moved here
 * rather than reached across lineages. It exists because READING the
 * `localStorage` PROPERTY throws in a context that denies storage, and this
 * bundle's one deployment target is a Teams personal tab: a third-party
 * frame, where storage is normally partitioned (fine) and under stricter
 * configurations denied outright (not fine). Under denial the four methods
 * below used to throw on their first line.
 *
 * WHAT IS STILL NOT SECURE, stated because the name invites the opposite
 * reading: `safe-storage` is CRASH-safety, not encryption. A refresh token
 * still sits in plaintext `localStorage`. Encrypting it is a separate design
 * question and is deliberately not answered here.
 */

import { isStorageDurable, safeStorage } from "./safe-storage";

export const Browser = {
  async open(options: { url: string }): Promise<void> {
    window.open(options.url, "_blank", "noopener,noreferrer");
  },
  async close(): Promise<void> {
    // Nothing to close: `open` handed the URL to a separate tab the page
    // does not own.
  },
};

const PREFIX = "traycer.secure.";

/**
 * Keys written through this shim in THIS session. Only ever consulted when
 * the store cannot be enumerated - see {@link storedKeys} for why that is
 * safe there and would be a sign-out bug anywhere else.
 */
const trackedKeys = new Set<string>();

/**
 * THE ENUMERATION HAS TO READ THE REAL STORE, and this is the whole subtlety
 * of the port.
 *
 * `mobile-runner-host.ts:488,501` calls `keys()` as an existence pre-check
 * before BOTH `get` and `delete` - a key it does not list is reported absent
 * without ever being read. So an under-reporting `keys()` does not degrade
 * gracefully: it signs the user out and looks like an expired session.
 *
 * `StorageLike` exposes only `getItem`/`setItem`/`removeItem` - no `length`,
 * no `key(i)`. The durable store IS `globalThis.localStorage` (safe-storage
 * hands the real object back untouched), so it carries both; the in-memory
 * fallback does not. Hence: enumerate when the store can be enumerated, and
 * fall back to the tracked set only when it cannot.
 *
 * The fallback is correct ONLY because it is unreachable except behind the
 * in-memory store, which starts EMPTY - there are no pre-existing keys for it
 * to miss. Tracking an index on the durable path instead would report an
 * empty set to a returning user whose keys predate the index.
 */
function storedKeys(): string[] {
  const store = safeStorage();
  // Duck-typed rather than gated on `isStorageDurable()`: the question here
  // is "can this object be enumerated", which is what the answer depends on.
  const enumerable = store as Partial<Storage>;
  if (
    typeof enumerable.key === "function" &&
    typeof enumerable.length === "number"
  ) {
    const found: string[] = [];
    for (let index = 0; index < enumerable.length; index += 1) {
      const key = enumerable.key(index);
      if (key !== null && key.startsWith(PREFIX)) {
        found.push(key.slice(PREFIX.length));
      }
    }
    return found;
  }
  return [...trackedKeys];
}

export const SecureStoragePlugin = {
  async keys(): Promise<{ value: string[] }> {
    return { value: storedKeys() };
  },
  async get(options: { key: string }): Promise<{ value: string }> {
    const stored = safeStorage().getItem(`${PREFIX}${options.key}`);
    if (stored === null) {
      // The exact message `mobile-runner-host.ts` pattern-matches on to map a
      // miss to `null` (`isMissingStorageItem`).
      throw new Error("Item with given key does not exist");
    }
    return { value: stored };
  },
  async set(options: { key: string; value: string }): Promise<{
    value: boolean;
  }> {
    safeStorage().setItem(`${PREFIX}${options.key}`, options.value);
    trackedKeys.add(options.key);
    return { value: true };
  },
  async remove(options: { key: string }): Promise<{ value: boolean }> {
    safeStorage().removeItem(`${PREFIX}${options.key}`);
    trackedKeys.delete(options.key);
    return { value: true };
  },
};

/**
 * `false` when credentials are held in memory only, so this session will not
 * survive a reload. Re-exported from here because this module is what the
 * bundle actually aliases - a caller that wants to say "you will have to sign
 * in again" should not have to know `safe-storage.ts` exists.
 */
export { isStorageDurable, safeStorage };

/** Tests only. The shim's own session state, separate from the storage probe. */
export function resetTrackedKeysForTests(): void {
  trackedKeys.clear();
}
