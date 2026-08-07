import { afterEach, describe, expect, it } from "vitest";
import {
  SecureStoragePlugin,
  isStorageDurable,
  resetTrackedKeysForTests,
} from "./capacitor-web-shim";
import { resetStorageProbeForTests } from "./safe-storage";

/**
 * THE DEFECT THIS FILE EXISTS FOR is not "storage throws" - safe-storage's own
 * tests cover that. It is the consequence one layer up.
 *
 * `mobile-runner-host.ts:488,501` calls `keys()` as an existence pre-check
 * before both `get` and `delete`. A key `keys()` does not list is reported
 * ABSENT WITHOUT BEING READ. So an under-reporting `keys()` does not surface
 * as an error anywhere - the user is silently signed out and it reads as an
 * expired session. That is a defect that lands in a legitimate state, and the
 * only place it is visible is here.
 *
 * The probe is reproduced faithfully: the throw is on the PROPERTY ACCESS,
 * so denial is modelled with a getter, not with a throwing `getItem`.
 */

const PREFIX = "traycer.secure.";
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function withLocalStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    ...descriptor,
  });
}

/** A real `Storage`, so `length`/`key` are present rather than cast away. */
function workingStore(seed: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
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
}

function denyStorage(): void {
  withLocalStorage({
    get() {
      throw new DOMException(
        "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
        "SecurityError",
      );
    },
  });
}

afterEach(() => {
  resetStorageProbeForTests();
  resetTrackedKeysForTests();
  if (original === undefined) {
    // @ts-expect-error -- removing a global the test added
    delete globalThis.localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", original);
  }
});

describe("capacitor-web-shim / SecureStoragePlugin", () => {
  it("REGRESSION: lists keys written before this module ever ran", async () => {
    // A returning user. Their credentials were written by an earlier build,
    // so no in-session index can know about them. A shim that tracked its own
    // keys returns [] here, `get` short-circuits to null, and the user is
    // signed out with no error anywhere.
    withLocalStorage({
      value: workingStore({ [`${PREFIX}traycer.credentials`]: "{token}" }),
    });

    await expect(SecureStoragePlugin.keys()).resolves.toEqual({
      value: ["traycer.credentials"],
    });
    await expect(
      SecureStoragePlugin.get({ key: "traycer.credentials" }),
    ).resolves.toEqual({ value: "{token}" });
  });

  it("reports only its own prefixed keys, not everything in the store", async () => {
    withLocalStorage({
      value: workingStore({
        [`${PREFIX}mine`]: "1",
        "traycer.hosts": "2",
        unrelated: "3",
      }),
    });

    const { value } = await SecureStoragePlugin.keys();
    expect(value).toEqual(["mine"]);
  });

  it("round-trips set / keys / get / remove against a working store", async () => {
    withLocalStorage({ value: workingStore({}) });

    await SecureStoragePlugin.set({ key: "k", value: "v" });
    await expect(SecureStoragePlugin.keys()).resolves.toEqual({ value: ["k"] });
    await expect(SecureStoragePlugin.get({ key: "k" })).resolves.toEqual({
      value: "v",
    });

    await SecureStoragePlugin.remove({ key: "k" });
    await expect(SecureStoragePlugin.keys()).resolves.toEqual({ value: [] });
  });

  it("CONTRACT: a missing key throws the exact message the host matches on", async () => {
    withLocalStorage({ value: workingStore({}) });

    // `mobile-runner-host.ts` maps this message to `null` and rethrows
    // anything else. Reword it and a miss becomes a crash.
    await expect(SecureStoragePlugin.get({ key: "nope" })).rejects.toThrow(
      "Item with given key does not exist",
    );
  });

  describe("when the browser DENIES storage (a Teams tab is a third-party frame)", () => {
    it("CONTRACT: no method throws a SecurityError out to the host", async () => {
      denyStorage();

      await expect(SecureStoragePlugin.keys()).resolves.toEqual({ value: [] });
      await expect(
        SecureStoragePlugin.set({ key: "k", value: "v" }),
      ).resolves.toEqual({ value: true });
      await expect(SecureStoragePlugin.remove({ key: "k" })).resolves.toEqual({
        value: true,
      });
      expect(isStorageDurable()).toBe(false);
    });

    it("a miss still throws the missing-item message, NOT the SecurityError", async () => {
      denyStorage();

      // The distinction matters: `isMissingStorageItem` rethrows anything it
      // does not recognise, so a leaked SecurityError becomes a crash on a
      // path whose correct answer is "no credentials yet".
      await expect(SecureStoragePlugin.get({ key: "k" })).rejects.toThrow(
        "Item with given key does not exist",
      );
    });

    it("still works for the CURRENT session, in memory", async () => {
      denyStorage();

      await SecureStoragePlugin.set({ key: "k", value: "v" });
      // This is the tracked-set path, and it is only correct because the
      // in-memory store starts empty - nothing pre-existing can be missed.
      await expect(SecureStoragePlugin.keys()).resolves.toEqual({
        value: ["k"],
      });
      await expect(SecureStoragePlugin.get({ key: "k" })).resolves.toEqual({
        value: "v",
      });

      await SecureStoragePlugin.remove({ key: "k" });
      await expect(SecureStoragePlugin.keys()).resolves.toEqual({ value: [] });
    });
  });

  it("treats a store that silently discards writes as non-durable and still functions", async () => {
    // No throw, nothing persists - the failure mode a truthiness check misses.
    withLocalStorage({
      value: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });

    expect(isStorageDurable()).toBe(false);
    await SecureStoragePlugin.set({ key: "k", value: "v" });
    await expect(SecureStoragePlugin.get({ key: "k" })).resolves.toEqual({
      value: "v",
    });
  });
});
