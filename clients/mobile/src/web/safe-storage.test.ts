import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isStorageDurable,
  resetStorageProbeForTests,
  safeStorage,
} from "./safe-storage";

/**
 * The measured failure this guards, verbatim from a real run of the deployed
 * PWA inside a cross-origin iframe:
 *
 *   SecurityError: Failed to read the 'localStorage' property from 'Window':
 *   Access is denied for this document.
 *
 * thrown at startup, so React never mounted and the page was blank.
 *
 * The two properties worth pinning are (a) the throw is on the PROPERTY
 * ACCESS, not on `getItem` — so a getter is used to reproduce it faithfully —
 * and (b) nothing here may throw out of `safeStorage()`, because a throw is
 * the whole defect.
 */
function withLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    ...descriptor,
  });
}

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  resetStorageProbeForTests();
  if (original === undefined) {
    // @ts-expect-error -- removing a global the test added
    delete globalThis.localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", original);
  }
  vi.restoreAllMocks();
});

function workingStore(): Storage {
  const map = new Map<string, string>();
  // A REAL `Storage`, not a cast through `unknown`. The cast said "trust me"
  // about a shape the compiler could have checked — and `length`/`key` are
  // exactly the members a partial fake omits, so the assertion was hiding the
  // one thing worth verifying about the fake.
  const store: Storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
  return store;
}

describe("host/safe-storage", () => {
  it("uses the real store, and reports durable, when storage works", () => {
    withLocalStorage({ value: workingStore() });

    expect(isStorageDurable()).toBe(true);
    safeStorage().setItem("k", "v");
    expect(safeStorage().getItem("k")).toBe("v");
  });

  it("CONTRACT: a throwing property access does NOT propagate", () => {
    // The exact shape of the real failure: reading the property throws.
    withLocalStorage({
      get() {
        throw new DOMException(
          "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
          "SecurityError",
        );
      },
    });

    // If this throws, the app is back to a blank screen.
    expect(() => safeStorage()).not.toThrow();
    expect(isStorageDurable()).toBe(false);
    // And the fallback is a working store, so the session still functions.
    safeStorage().setItem("k", "v");
    expect(safeStorage().getItem("k")).toBe("v");
  });

  it("survives a throwing setItem, not just a throwing property access", () => {
    // Quota-exceeded and some private modes fail here instead.
    withLocalStorage({
      value: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        },
        removeItem: () => {},
      },
    });

    expect(() => safeStorage()).not.toThrow();
    expect(isStorageDurable()).toBe(false);
  });

  it("CONTRACT: a store that silently discards writes is NOT treated as durable", () => {
    // The third failure mode, and the one a truthiness check misses: no throw,
    // but nothing persists. Trusting it would lose the token with no error.
    withLocalStorage({
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });

    expect(isStorageDurable()).toBe(false);
    safeStorage().setItem("k", "v");
    expect(safeStorage().getItem("k")).toBe("v");
  });

  it("treats an absent localStorage as non-durable rather than crashing", () => {
    // @ts-expect-error -- deleting a global on purpose
    delete globalThis.localStorage;
    expect(() => safeStorage()).not.toThrow();
    expect(isStorageDurable()).toBe(false);
  });

  it("probes only ONCE — the answer cannot change mid-session", () => {
    let reads = 0;
    withLocalStorage({
      get() {
        reads++;
        return workingStore();
      },
    });

    safeStorage();
    safeStorage();
    isStorageDurable();
    expect(reads).toBe(1);
  });

  it("leaves no probe key behind in the real store", () => {
    const store = workingStore();
    withLocalStorage({ value: store });
    isStorageDurable();
    // Probing must not litter a user's storage with our own key.
    expect(store.getItem("__traycer_storage_probe__")).toBeNull();
  });
});
