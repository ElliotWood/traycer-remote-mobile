// @vitest-environment jsdom
/**
 * The `localStorage` seam, which is the one piece of the persistence path that
 * every other test routes around.
 *
 * `use-canvas.test.tsx` injects a Map, deliberately — it is testing the
 * epic-keying, and a real `localStorage` would only add noise. That leaves
 * `browserCanvasStorage` itself covered by nothing, and it is the function
 * whose ENTIRE reason for existing is a failure mode no other test can reach:
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IN A TEAMS IFRAME, `localStorage` THROWS. IT DOES NOT RETURN NULL.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * When an embedding context blocks third-party storage, touching
 * `window.localStorage` raises a `SecurityError`. A module-level reference
 * turns that into a boot failure on exactly the platform this client exists
 * for — the tab would show nothing at all, in Teams, and work perfectly in
 * every browser anyone tested it in.
 *
 * The try/catch was written for that and has never been executed by a test,
 * which is the "instrument was never run" shape applied to a defence rather
 * than to a check. Below, both throw sites are exercised: the PROPERTY ACCESS
 * and the METHOD CALL. They are different failure points and only one of them
 * is the one people think of.
 *
 * Stated limit: jsdom raising an error where a real Teams iframe raises a
 * `SecurityError` proves the catch is reachable and swallows, not that Teams
 * throws in exactly this shape. The catch is unconditional, so the
 * distinction does not change the outcome — but this is a test about our
 * handling, not evidence about Teams.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  browserCanvasStorage,
  canvasStorageKey,
  loadCanvas,
  saveCanvas,
} from "@/canvas/canvas-persistence";
import { EMPTY_CANVAS, openTile } from "@/canvas/canvas-state";
import { makeBlankTile } from "@/canvas/opener";

const EPIC = "aaaa0000-0000-4000-8000-00000000000a";

const REAL = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  if (REAL !== undefined) Object.defineProperty(window, "localStorage", REAL);
  window.localStorage.clear();
});

/** Replace `window.localStorage` with something hostile. */
function installStorage(descriptor: PropertyDescriptor): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    ...descriptor,
  });
}

describe("browserCanvasStorage — the happy path, so the failure paths mean something", () => {
  it("round-trips through the real localStorage under the per-epic key", () => {
    const storage = browserCanvasStorage(EPIC);
    const state = openTile({
      state: EMPTY_CANVAS,
      tile: makeBlankTile("host-1"),
      preview: false,
      ids: { paneId: () => "p1", groupId: () => "g1" },
    });

    saveCanvas(storage, state);

    // The KEY, not just the round trip. A seam that reads and writes its own
    // private location would pass a round-trip test while sharing nothing with
    // the rest of the app.
    expect(window.localStorage.getItem(canvasStorageKey(EPIC))).not.toBeNull();
    expect(loadCanvas(storage).root).not.toBeNull();
  });
});

describe("browserCanvasStorage — when the embedding context blocks storage", () => {
  it("CONTRACT: a throwing PROPERTY ACCESS degrades to no stored layout", () => {
    // The real Teams shape: reaching for `window.localStorage` at all raises.
    installStorage({
      get() {
        throw new Error("SecurityError: access to storage is denied");
      },
    });

    const storage = browserCanvasStorage(EPIC);
    expect(() => loadCanvas(storage)).not.toThrow();
    expect(loadCanvas(storage)).toBe(EMPTY_CANVAS);
  });

  it("CONTRACT: a throwing PROPERTY ACCESS makes a save a no-op, not a crash", () => {
    installStorage({
      get() {
        throw new Error("SecurityError: access to storage is denied");
      },
    });

    const storage = browserCanvasStorage(EPIC);
    // A canvas that cannot persist must still be a canvas. The user loses
    // survival across reload and nothing else — which is the designed
    // degradation, and is silent on purpose: a message about a storage policy
    // they do not control and cannot change from here helps nobody.
    expect(() => {
      saveCanvas(storage, EMPTY_CANVAS);
    }).not.toThrow();
  });

  it("CONTRACT: a throwing getItem degrades too — a different site from the access", () => {
    // Distinct from the above and easy to conflate. Some contexts hand back a
    // Storage object whose METHODS throw. A catch placed around only the
    // property read would miss this entirely.
    installStorage({
      get: () => ({
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => undefined,
      }),
    });

    expect(loadCanvas(browserCanvasStorage(EPIC))).toBe(EMPTY_CANVAS);
  });

  it("CONTRACT: a throwing setItem — the quota case — loses the layout, not the session", () => {
    let attempted = 0;
    installStorage({
      get: () => ({
        getItem: () => null,
        setItem: () => {
          attempted += 1;
          throw new Error("QuotaExceededError");
        },
      }),
    });

    expect(() => {
      saveCanvas(browserCanvasStorage(EPIC), EMPTY_CANVAS);
    }).not.toThrow();
    // The write was ATTEMPTED. Without this the test passes for an
    // implementation that never calls `setItem` at all — the assertion would
    // be satisfied by the bug it is meant to exclude.
    expect(attempted).toBe(1);
  });
});
