/**
 * The canvas layout for the epic currently on screen, loaded and saved.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO NOT HAVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `browserCanvasStorage(epicId)` is per-epic — that was decided before a byte
 * was written, precisely so a later move to per-epic layouts would not be a
 * migration. The naive way to consume it gives that back:
 *
 *     const [state, setState] = useState(() => loadCanvas(storage));
 *
 * A `useState` initialiser runs **once per component lifetime**, and epic A →
 * epic B is a PROP change, not a remount. So the canvas shows A's layout under
 * B's heading, and the first edit **saves it to B's key**. Silent, permanent,
 * and it corrupts the data the per-epic key was introduced to protect.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE FIX IS HERE AND NOT A `key` PROP ON THE COMPONENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `<CanvasScreen key={epicId} …/>` also fixes it, by forcing a remount. It was
 * the first thing tried and it is the worse answer:
 *
 *   - **A `key` has no type.** Dropping it is not a compile error, not a lint
 *     error, and not visible in review as anything other than an absent
 *     attribute. The thing holding the invariant would be the easiest thing in
 *     the file to delete by accident.
 *   - **It cannot be tested where it lives.** The fix would be at the call
 *     site, so the test would have to render `App` — auth, config, a host
 *     connection — to assert a property of storage keys.
 *   - **It is remote from what it protects.** A reader of this hook would see
 *     no handling of `epicId` changing and reasonably conclude there is none.
 *
 * So the epic change is handled explicitly, in the module that owns the
 * storage key, and the A → B navigation is a direct unit test.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOADING DURING RENDER, NOT IN AN EFFECT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * React's documented pattern for adjusting state when a prop changes, and here
 * it is also the only correct one. An effect runs AFTER the render that saw
 * the new `epicId`, so there is a frame where the new epic is on screen with
 * the old epic's layout — and if the user acts in it, the save fires with the
 * new key and the old state. That is the same corruption, arrived at through a
 * narrower door.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SAVING ON THE CHANGE, NOT IN AN EFFECT ON THE STATE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `useEffect(() => save(state), [state, epicId])` fires on MOUNT too, so
 * merely visiting an epic rewrites its stored layout — and worse, it fires
 * once with the new `epicId` and the old `state` on the render where they
 * disagree. Writing inside the setter means a save happens exactly when a user
 * changed something, with the pair that changed together.
 */
import { useCallback, useState } from "react";
import {
  loadCanvas,
  saveCanvas,
  type CanvasStorage,
} from "./canvas-persistence";
import { EMPTY_CANVAS, type CanvasState } from "./canvas-state";

/**
 * How to reach storage for one epic. Injected so a test can supply a map, and
 * because `browserCanvasStorage` touches `window.localStorage` — which THROWS
 * rather than returning null when a Teams iframe blocks third-party storage.
 */
export type CanvasStorageFor = (epicId: string) => CanvasStorage;

export interface UseCanvasResult {
  readonly state: CanvasState;
  readonly setState: (next: CanvasState) => void;
}

interface Held {
  readonly epicId: string | null;
  readonly state: CanvasState;
}

/**
 * `null` when no epic is on screen, and it means "touch storage at all".
 *
 * The alternative was passing `""` from routes that have no epic, which reads
 * as harmless and is not: `canvasStorageKey("")` is a real, writable key
 * — `traycer.teams-tab.canvas.` — so every non-canvas route would read it, and
 * one bug away from writing to it. An id that no epic can have is a value the
 * storage layer would have to be trusted to treat specially. `null` is refused
 * before a key is built.
 */
function load(epicId: string | null, storageFor: CanvasStorageFor): CanvasState {
  return epicId === null ? EMPTY_CANVAS : loadCanvas(storageFor(epicId));
}

export function useCanvas(
  epicId: string | null,
  storageFor: CanvasStorageFor,
): UseCanvasResult {
  const [held, setHeld] = useState<Held>(() => ({
    epicId,
    state: load(epicId, storageFor),
  }));

  // The epic changed under us. Load the new one NOW and hand it back from this
  // same render, so no render ever pairs one epic's id with another's layout.
  let current = held;
  if (held.epicId !== epicId) {
    current = { epicId, state: load(epicId, storageFor) };
    setHeld(current);
  }

  const setState = useCallback(
    (next: CanvasState) => {
      setHeld({ epicId, state: next });
      // `epicId` is the one from THIS closure, which is the one the caller was
      // looking at when they changed something. Reading a ref or the held
      // value here is what reintroduces the mismatch.
      if (epicId !== null) saveCanvas(storageFor(epicId), next);
    },
    [epicId, storageFor],
  );

  return { state: current.state, setState };
}
