/**
 * Measures a pane's live box for {@link affordsSplit}.
 *
 * ─── Why `useSyncExternalStore` and not `useState` + `useEffect` ───
 *
 * The obvious shape — measure in a layout effect, `setState`, re-render — is
 * banned here in a way that is easy to miss: this repo lints
 * `react-hooks/set-state-in-effect` as an ERROR, and teams-tab holds a
 * baseline of exactly 5 of them. A sixth would move a number three separate
 * regressions have already hidden behind on this branch. `useSyncExternalStore`
 * reads the DOM in `getSnapshot`, so no state is set from an effect at all and
 * the baseline is untouched.
 *
 * It also happens to be the correct instrument rather than a workaround:
 * React calls `getSnapshot` during every render, so a pane that changes size
 * because a SIBLING was split or closed re-measures on the render that change
 * already causes, with no subscription needed for it.
 *
 * ⚠️ `getSnapshot` MUST return a primitive. Returning a fresh `{width, height}`
 * each call is a new reference every time, which React reads as "changed" and
 * turns into an infinite render loop. That is why this hook returns two
 * numbers from two stores rather than one object from one.
 *
 * ─── What `subscribe` covers, and what it does not ───
 *
 * A `ResizeObserver` when the platform has one, plus a window `resize`
 * listener. jsdom has NEITHER by default — one test file installs a local
 * noop — so the observer is feature-detected rather than assumed. In jsdom
 * `getBoundingClientRect` returns zeroes anyway, which
 * {@link splitAxisExtentPx} reads as unmeasured, so the whole path degrades to
 * "allow the split" rather than to an error.
 */
import { useCallback, useMemo, useSyncExternalStore, type RefObject } from "react";
import type { PaneExtentPx } from "./split-affordance";

function subscribeToElementSize(
  element: Element | null,
  onChange: () => void,
): () => void {
  if (element === null) return () => {};

  const disposers: Array<() => void> = [];

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(onChange);
    observer.observe(element);
    disposers.push(() => {
      observer.disconnect();
    });
  }

  // Kept even when the observer exists. An iframe being resized by its HOST —
  // which is the Teams case, and the only one this rule is really for — does
  // not always surface as an element resize before the window event.
  if (typeof window !== "undefined") {
    window.addEventListener("resize", onChange);
    disposers.push(() => {
      window.removeEventListener("resize", onChange);
    });
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * The measured box of `ref.current`, or `null` until it has one.
 *
 * Returns `null` rather than `{width: 0, height: 0}` so callers cannot
 * accidentally treat "not measured yet" as "measured, and tiny" — the two
 * have opposite correct answers and the zero object makes them look alike.
 */
export function usePaneExtentPx(
  ref: RefObject<HTMLElement | null>,
): PaneExtentPx | null {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToElementSize(ref.current, onChange),
    [ref],
  );

  const width = useSyncExternalStore(
    subscribe,
    () => ref.current?.getBoundingClientRect().width ?? 0,
    // Server snapshot: no DOM, so nothing is measured. Matches the client's
    // pre-layout answer, so hydration sees no mismatch.
    () => 0,
  );
  const height = useSyncExternalStore(
    subscribe,
    () => ref.current?.getBoundingClientRect().height ?? 0,
    () => 0,
  );

  // Memoized on the two primitives, so the object identity is stable between
  // renders that did not change the size. Without this every render hands
  // `affordsSplit` a fresh object, which is harmless here but is the exact
  // habit that makes a future `useMemo`/`useEffect` dependency silently
  // useless.
  return useMemo(
    () => (width > 0 || height > 0 ? { width, height } : null),
    [width, height],
  );
}
