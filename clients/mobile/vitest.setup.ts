/**
 * P0 caching: `y-indexeddb` (used by `use-epic-doc.ts`) opens IndexedDB from
 * inside its own internal async chain — a missing `indexedDB` global surfaces
 * as an unhandled rejection there, not as a catchable synchronous throw at
 * the `new IndexeddbPersistence(...)` call site (verified: wrapping that
 * call in try/catch does not suppress it). Polyfilling a real (fake)
 * `indexedDB` here is simpler and more realistic than trying to special-case
 * "no IndexedDB" behavior across every jsdom test — it also means the tests
 * that specifically exercise the y-indexeddb layer (see
 * `use-epic-doc-idb.test.tsx`) get a working IndexedDB to assert against.
 * Harmless under the default `node` test environment too — this only adds
 * globals, it doesn't require a DOM.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach } from "vitest";

/**
 * P0 caching leaks real state across tests otherwise: `use-epic-doc.ts` /
 * `use-chat.ts` / `use-artifact-body.ts` all read/write `localStorage`, and
 * `use-epic-doc.ts` opens `IndexedDB` — both are real jsdom globals that
 * persist across `it()` blocks within one test FILE (only reset between
 * files/workers). Several existing fixtures reuse the same epicId (`"e1"`)
 * across multiple tests in the same `describe`, so a write from test N would
 * otherwise silently seed test N+1's mount. Reset both after every test.
 */
afterEach(() => {
  if (typeof window !== "undefined" && "localStorage" in window) {
    window.localStorage.clear();
  }
  if (typeof globalThis.indexedDB !== "undefined") {
    globalThis.indexedDB = new IDBFactory();
  }
});
