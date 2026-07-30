/**
 * `localStorage` that cannot take the app down with it.
 *
 * THE BUG THIS EXISTS FOR, measured rather than imagined. Loading the deployed
 * PWA inside a cross-origin iframe whose parent has an opaque origin produced:
 *
 *   SecurityError: Failed to read the 'localStorage' property from 'Window':
 *   Access is denied for this document.
 *
 * thrown during startup, so React never mounted: `<div id="root">` stayed
 * empty, no error UI, a blank white screen with nothing a user could report
 * beyond "it doesn't work". Some browsers deny storage outright rather than
 * partitioning it; Teams on iOS is a plausible candidate and is untested.
 *
 * TWO THINGS MAKE THIS TRICKIER THAN IT LOOKS, and both were live in the code:
 *
 * 1. `"localStorage" in window` DOES NOT WORK as a guard. The property exists
 *    in a denied context — it is reading it that throws. Every call site
 *    guarding with `in` passed the guard and then threw on the next line.
 *
 * 2. The throw is on the PROPERTY ACCESS, not on `getItem`/`setItem`. Call
 *    sites that carefully wrapped their `getItem` in try/catch still crashed,
 *    because obtaining the object threw first.
 *
 * So the access is probed ONCE, inside try/catch, with a real round-trip
 * rather than a truthiness check — a storage that accepts writes and silently
 * discards them is a third failure mode, and it lies to a truthiness test.
 *
 * When storage is unusable this returns an in-memory store with the same
 * shape. The session keeps working; it just does not survive a reload. That
 * is a far better failure than a white screen, and {@link isStorageDurable}
 * lets the UI say so instead of leaving the user wondering why they keep
 * signing in.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Same shape, no persistence. Used when the real one is unusable. */
class InMemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** `null` until first probed. Probed once — the answer cannot change mid-session. */
let resolved: { store: StorageLike; durable: boolean } | null = null;

const PROBE_KEY = "__traycer_storage_probe__";

function probe(): { store: StorageLike; durable: boolean } {
  try {
    // The throwing line, in every environment that denies storage.
    const candidate = globalThis.localStorage;
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate.getItem !== "function"
    ) {
      return { store: new InMemoryStorage(), durable: false };
    }
    // A real round-trip, not a truthiness check: a store that accepts writes
    // and discards them would pass the latter and lose the token silently.
    candidate.setItem(PROBE_KEY, "1");
    const readBack = candidate.getItem(PROBE_KEY);
    candidate.removeItem(PROBE_KEY);
    if (readBack !== "1") {
      return { store: new InMemoryStorage(), durable: false };
    }
    return { store: candidate, durable: true };
  } catch {
    // Denied, quota-exhausted, disabled by policy — all the same to a caller.
    return { store: new InMemoryStorage(), durable: false };
  }
}

/**
 * The app's storage. Always returns something usable — never throws, never
 * returns null, so callers need no guard of their own.
 */
export function safeStorage(): StorageLike {
  resolved ??= probe();
  return resolved.store;
}

/**
 * `false` when storage is unavailable and an in-memory fallback is in use, so
 * the session will not survive a reload. Surfaced in the UI: a user who has
 * to sign in every time deserves to know why.
 */
export function isStorageDurable(): boolean {
  resolved ??= probe();
  return resolved.durable;
}

/** Tests only — the probe result is cached for the process lifetime. */
export function resetStorageProbeForTests(): void {
  resolved = null;
}
