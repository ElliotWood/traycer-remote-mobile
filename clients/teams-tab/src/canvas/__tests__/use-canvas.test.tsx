// @vitest-environment jsdom
/**
 * Navigating between epics must not move one epic's layout onto another.
 *
 * This is the test the fix exists for, and it is worth more than the fix — the
 * fix is a few lines and the defect is INVISIBLE without navigating. Every
 * single-epic test passes against the broken version: load works, save works,
 * reload works. It only goes wrong on A → B, and then it goes wrong silently
 * and permanently, by writing A's layout into B's key.
 *
 * The storage seam is a plain Map, so every assertion below is on the keys and
 * bytes that would have reached `localStorage`. Asserting on rendered panes
 * would prove the screen looked right and say nothing about what was written,
 * which is the half that cannot be undone.
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvas, type CanvasStorageFor } from "@/canvas/use-canvas";
import {
  canvasStorageKey,
  type CanvasStorage,
} from "@/canvas/canvas-persistence";
import {
  EMPTY_CANVAS,
  openTile,
  type CanvasState,
  type IdSource,
} from "@/canvas/canvas-state";
import { makeBlankTile } from "@/canvas/opener";
import { collectPanes } from "@/canvas/tile-tree";

const EPIC_A = "aaaa0000-0000-4000-8000-00000000000a";
const EPIC_B = "bbbb0000-0000-4000-8000-00000000000b";
const HOST = "host-1";

function idSource(): IdSource {
  let panes = 0;
  let groups = 0;
  return {
    paneId: () => `p${(panes += 1)}`,
    groupId: () => `g${(groups += 1)}`,
  };
}

/**
 * A storage factory over one Map, so the test can inspect exactly the keys the
 * real `browserCanvasStorage` would have used — `canvasStorageKey` is imported
 * rather than the string retyped, so a change to the key format cannot leave
 * this suite asserting against a key nothing writes.
 */
function fakeStorage(): {
  readonly storageFor: CanvasStorageFor;
  readonly map: Map<string, string>;
  readonly touched: Set<string>;
} {
  const map = new Map<string, string>();
  /*
   * Every key this storage was ASKED for, read or write.
   *
   * `map` alone was the first version and it could not fail the test named
   * "touches no key at all": a read never grows a Map, so passing `""` for
   * "no epic" — which reads `traycer.teams-tab.canvas.` on every route —
   * left `map.size` at 0 and the mutation printed GREEN.
   *
   * The claim was the right claim and the instrument was measuring writes
   * while its name said touches. Fixed by recording the reach, not by
   * narrowing the assertion to what happened to be observable.
   */
  const touched = new Set<string>();
  const storageFor: CanvasStorageFor = (epicId: string): CanvasStorage => {
    const key = canvasStorageKey(epicId);
    // Recorded HERE, at the factory, not inside read/write. Building the key
    // is the reach — a caller that resolves storage for an epic has already
    // decided that epic is in play, and this is the step `null` is meant to
    // prevent.
    touched.add(key);
    return {
      read: () => map.get(key) ?? null,
      write: (value: string) => {
        map.set(key, value);
      },
    };
  };
  return { storageFor, map, touched };
}

function withOneTab(state: CanvasState): CanvasState {
  return openTile({
    state,
    tile: makeBlankTile(HOST),
    preview: false,
    ids: idSource(),
  });
}

describe("useCanvas — one canvas per epic", () => {
  it("CONTRACT: navigating A to B does not carry A's layout, and does not write it to B", () => {
    const { storageFor, map } = fakeStorage();
    const hook = renderHook(
      ({ epicId }: { epicId: string | null }) => useCanvas(epicId, storageFor),
      { initialProps: { epicId: EPIC_A as string | null } },
    );

    act(() => {
      hook.result.current.setState(withOneTab(hook.result.current.state));
    });
    expect(collectPanes(hook.result.current.state.root).length).toBe(1);
    expect(map.has(canvasStorageKey(EPIC_A))).toBe(true);

    // The navigation. A PROP change, not a remount — which is the entire
    // reason the naive `useState` initialiser fails here and nowhere else.
    hook.rerender({ epicId: EPIC_B });

    // 1. B does not show A's layout.
    expect(hook.result.current.state).toBe(EMPTY_CANVAS);
    // 2. And nothing has been written to B's key by merely arriving.
    expect(map.has(canvasStorageKey(EPIC_B))).toBe(false);
  });

  it("CONTRACT: editing under B leaves A's stored layout untouched", () => {
    const { storageFor, map } = fakeStorage();
    const hook = renderHook(
      ({ epicId }: { epicId: string | null }) => useCanvas(epicId, storageFor),
      { initialProps: { epicId: EPIC_A as string | null } },
    );

    act(() => {
      hook.result.current.setState(withOneTab(hook.result.current.state));
    });
    const aBytes = map.get(canvasStorageKey(EPIC_A));
    expect(aBytes).toBeDefined();

    hook.rerender({ epicId: EPIC_B });
    act(() => {
      hook.result.current.setState(withOneTab(hook.result.current.state));
    });

    // The corruption this whole module exists to prevent: B's edit is written
    // under B, and A's bytes are byte-for-byte what they were.
    expect(map.get(canvasStorageKey(EPIC_B))).toBeDefined();
    expect(map.get(canvasStorageKey(EPIC_A))).toBe(aBytes);
    expect(map.get(canvasStorageKey(EPIC_B))).not.toBe(undefined);
  });

  it("restores A's layout on returning to it", () => {
    const { storageFor } = fakeStorage();
    const hook = renderHook(
      ({ epicId }: { epicId: string | null }) => useCanvas(epicId, storageFor),
      { initialProps: { epicId: EPIC_A as string | null } },
    );

    act(() => {
      hook.result.current.setState(withOneTab(hook.result.current.state));
    });
    hook.rerender({ epicId: EPIC_B });
    expect(hook.result.current.state.root).toBeNull();

    hook.rerender({ epicId: EPIC_A });
    // Round trip through JSON and the sanitizing parser, not the object we
    // still had in memory — which is the only version a real reload gets.
    expect(collectPanes(hook.result.current.state.root).length).toBe(1);
  });

  it("CONTRACT: a route with no epic touches no key at all", () => {
    const { storageFor, map, touched } = fakeStorage();
    const hook = renderHook(
      ({ epicId }: { epicId: string | null }) => useCanvas(epicId, storageFor),
      { initialProps: { epicId: null as string | null } },
    );

    expect(hook.result.current.state).toBe(EMPTY_CANVAS);
    // `canvasStorageKey("")` is a real, writable key —
    // `traycer.teams-tab.canvas.`. Passing `""` for "no epic" would READ it on
    // every non-canvas route and is one bug away from writing to it. Asserted
    // on `touched` rather than `map`, because a read leaves no trace in a Map
    // and this test is named for reaching, not for writing.
    expect([...touched]).toEqual([]);

    act(() => {
      hook.result.current.setState(withOneTab(hook.result.current.state));
    });
    expect([...touched]).toEqual([]);
    expect(map.size).toBe(0);
  });

  it("does not rewrite storage merely because the canvas was visited", () => {
    const { storageFor, map } = fakeStorage();
    const hook = renderHook(
      ({ epicId }: { epicId: string | null }) => useCanvas(epicId, storageFor),
      { initialProps: { epicId: EPIC_A as string | null } },
    );

    // A save-on-mount effect would have written here already. Nothing changed,
    // so nothing should have been persisted — a visit is not an edit.
    expect(map.size).toBe(0);
    hook.rerender({ epicId: EPIC_A });
    expect(map.size).toBe(0);
  });
});
