/**
 * Makes the OS/browser back gesture pop ONE level of the app's own navigation
 * stack instead of leaving the app.
 *
 * ## Why this exists
 *
 * The phone client renders everything at one URL and never touched
 * `window.history`, so in an INSTALLED PWA the Android hardware back button and
 * the iOS back-swipe popped the browser's own single history entry — which
 * means closing the app, from any depth, losing anything typed. The fix is not
 * a `popstate` listener bolted onto the existing state: it is making history a
 * property of the navigation model, so a screen added later participates
 * without its author having to remember anything.
 *
 * ## The model: two tiers, one stack
 *
 * Back-consuming UI in this app comes in two shapes, and before this module
 * only the first was modelled at all:
 *
 *   1. ROUTE FRAMES — the `navReducer` stack in `app-shell.tsx` (fleet → epic →
 *      chat / artifact / notifications / settings). Identity-bearing, long-lived.
 *   2. DISMISSIBLE LAYERS — anything mounted *on top of* a route that back
 *      should close first: bottom sheets, action sheets, and the full-screen
 *      "drill" forms held as local state inside a route (`EpicView`'s
 *      author/create-artifact forms, `FleetView`'s new-epic form). Their state
 *      is genuinely local to the component that owns it, so this module does
 *      not try to hoist it — a layer just *registers* while it is open.
 *
 * Total app depth is `routeDepth + openLayers`, and `back-stack.ts` keeps one
 * synthetic history entry per level. One `popstate` handler consumes exactly one
 * level: newest layer first, then a route frame, and only at the fleet root with
 * nothing open does the platform's "back closes the app" apply — which is the
 * correct behaviour there, and the one case the user explicitly wanted kept.
 *
 * ## Why in-app back routes THROUGH history
 *
 * `useNavBack()` calls `history.back()`; it does NOT dispatch a nav action. The
 * top bar's back arrow, a sheet's ✕, a form's Cancel and the OS gesture
 * therefore all reach the same `popstate` handler, so the two navigation models
 * the requirement warned about cannot drift — there is only one. It also keeps
 * the history stack honest: a Cancel button that merely flipped local state
 * would leave an orphan entry behind, and the user's next back tap would appear
 * to do nothing while it silently consumed the orphan. That orphan bug is the
 * failure mode this indirection buys immunity from, and it is why the
 * indirection is worth the initial "why is Cancel calling history?" surprise.
 *
 * ## What is NOT a level
 *
 * Depth counts route frames and open layers — and nothing else. Changing which
 * MACHINE the user is driving (the persistent host switcher, core-flows Flow 1)
 * is deliberately neither: per the product rule, "switching machines changes
 * reach, not location, so it does not push a history entry and back does not
 * undo it". This model gets that right by construction rather than by
 * exception, because a host selection is not a route and not a mounted overlay,
 * so there is nothing for it to register. Note the distinction that matters when
 * that screen lands: the switcher's SHEET is a layer (back should close it, and
 * it gets that free from `BottomSheet`), while the SELECTION it makes is not —
 * closing the sheet must not revert the machine. Keeping the choice in ordinary
 * app state, and only the sheet in this stack, is all that is required.
 *
 * The same test applies to anything else added later: if backing out of it
 * should restore what was on screen before, it is a level; if it changes what
 * the app is pointed at, it is state.
 *
 * ## Deliberate non-goal: restoring the stack across a reload
 *
 * A hard refresh mid-stack lands on the fleet root, and `NavHost` collapses the
 * now-stale entries above it so back still exits cleanly instead of consuming
 * several dead taps. Serialising the whole route stack into history state would
 * restore the exact screen, but the stack carries ids and titles that would then
 * be untrusted persisted input needing validation on the way back in. Sane and
 * predictable beat clever here; the ids are all re-fetchable from the fleet.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  depthStamp,
  planBackConsumption,
  planDepthSync,
  readDepthStamp,
  readForeignDepth,
  unitsToConsume,
} from "./back-stack";

/**
 * Identifies stamps written by THIS page load. Module scope, so it is computed
 * once per load and every entry we push carries it — which is what lets stale
 * entries left by a pre-reload session be recognised and ignored rather than
 * mistaken for our own depth (see `SESSION_STATE_KEY`).
 */
const NAV_SESSION: string =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `s${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

/**
 * A registered layer, held as a ref box rather than a bare function so the
 * owning component can change its dismiss callback (every render, typically —
 * it is usually an inline arrow) without re-registering the layer and churning
 * a history entry.
 */
type LayerBox = { current: () => void };

interface NavHostValue {
  /** The ONE way anything in the app navigates backwards. See the docblock. */
  readonly back: () => void;
  readonly registerLayer: (layer: LayerBox) => () => void;
}

const NavHostContext = createContext<NavHostValue | null>(null);

interface NavHostProps {
  /** Route frames above the fleet root, i.e. `stack.length - 1`. */
  readonly routeDepth: number;
  /** Pop `count` route frames. Called only from the `popstate` handler. */
  readonly onPopRoutes: (count: number) => void;
  readonly children: ReactNode;
}

function stampState(depth: number): object {
  // Preserve whatever else is on the entry: `app-shell.tsx` strips deep-link
  // query params with its own `replaceState`, and neither call should erase the
  // other's contribution.
  const existing: unknown = window.history.state;
  const base: object = typeof existing === "object" && existing !== null ? existing : {};
  return { ...base, ...depthStamp(depth, NAV_SESSION) };
}

export function NavHost({ routeDepth, onPopRoutes, children }: NavHostProps): ReactElement {
  const [layers, setLayers] = useState<readonly LayerBox[]>([]);
  /**
   * How many synthetic history entries we have actually committed. The single
   * source of truth for every sync decision — and, crucially, it is updated by
   * the `popstate` handler BEFORE React re-renders, which is what makes the
   * reconcile effect below a no-op after a back gesture instead of a second,
   * competing history mutation.
   */
  const committedRef = useRef(0);

  const syncDepth = useCallback((targetDepth: number): void => {
    const plan = planDepthSync(committedRef.current, targetDepth);
    if (plan.push.length === 0 && plan.go === 0) {
      return;
    }
    committedRef.current = targetDepth;
    for (const depth of plan.push) {
      // No URL argument: the app lives at one URL, and changing it would put a
      // path the service worker has no precache entry for into the address bar.
      window.history.pushState(stampState(depth), "");
    }
    if (plan.go < 0) {
      window.history.go(plan.go);
    }
  }, []);

  // Tidy away the stale entries a mid-stack reload left above the app's root.
  //
  // The entry the app boots on is deliberately NOT stamped here. Session-scoped
  // stamps already make every entry not written by this page load read as depth
  // 0, so the boot entry needs no marking to behave as the root — and a
  // `replaceState` claiming it was verified redundant by mutation (removing it
  // failed no test, because there is no reachable state in which it changes an
  // outcome). Unexercised defensive code is a liability, so it is gone.
  //
  // The traversal below is best-effort POLISH, not correctness: after a reload
  // the app boots at the fleet root, and returning to the true root means back
  // exits cleanly instead of consuming dead taps first. A `pushState` racing it
  // cancels it outright in at least one implementation (verified in jsdom), and
  // the interaction is unspecified enough not to rely on across browsers — which
  // is exactly why correctness rests on the session-scoped arithmetic instead.
  useEffect(() => {
    const stale = readForeignDepth(window.history.state, NAV_SESSION);
    if (stale > 0) {
      window.history.go(-stale);
    }
  }, []);

  // Reconcile on EVERY render, deliberately without a dependency array: the
  // plan is a diff, so an unchanged depth costs nothing, and running
  // unconditionally removes any need to reason about whether a child's
  // layer-registration effect commits before or after this parent's own
  // effects. Self-healing beats correctly-ordered.
  useEffect(() => {
    syncDepth(routeDepth + layers.length);
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      const landed = readDepthStamp(event.state, NAV_SESSION);
      const units = unitsToConsume(committedRef.current, landed);
      // Commit first: dismissing a layer or popping a route re-renders, and the
      // reconcile effect must see a depth that already matches reality or it
      // will push the entry we just consumed straight back on.
      committedRef.current = landed;
      if (units === 0) {
        return;
      }
      const plan = planBackConsumption(units, layers.length, routeDepth);
      // Newest layer first — a nested sheet closes before the sheet under it.
      for (let i = 0; i < plan.dismissLayers; i += 1) {
        layers[layers.length - 1 - i].current();
      }
      if (plan.popRoutes > 0) {
        onPopRoutes(plan.popRoutes);
      }
      // `plan.allowExit` needs no branch: the browser has already discarded the
      // entry, so letting the handler return is exactly "the platform default
      // happens". It is asserted in the unit tests rather than acted on here.
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [layers, routeDepth, onPopRoutes]);

  const registerLayer = useCallback((layer: LayerBox): (() => void) => {
    setLayers((prev) => [...prev, layer]);
    return () => {
      setLayers((prev) => prev.filter((candidate) => candidate !== layer));
    };
  }, []);

  const value = useMemo<NavHostValue>(
    () => ({
      back: () => {
        window.history.back();
      },
      registerLayer,
    }),
    [registerLayer],
  );

  return <NavHostContext.Provider value={value}>{children}</NavHostContext.Provider>;
}

/**
 * The one way to navigate backwards. Returns a no-op outside a `NavHost` so a
 * unit test rendering a single component in isolation neither throws nor
 * accidentally drives the real history — matching `useArtifactNav`'s
 * degraded-harness convention.
 */
export function useNavBack(): () => void {
  const host = useContext(NavHostContext);
  return useMemo(() => host?.back ?? ((): void => {}), [host]);
}

/**
 * Make a modal/drawer/sheet/full-screen-form participate in back navigation.
 *
 * This is the whole contract for a new dismissible surface — one call, and the
 * OS back gesture closes it before its parent screen pops:
 *
 *     const dismiss = useDismissLayer(open, () => setOpen(false));
 *     // …and wire the ✕ / Cancel / backdrop tap to `dismiss`, not `setOpen(false)`
 *
 * Returning the dismiss function (rather than expecting callers to also grab
 * `useNavBack`) is what keeps the two halves impossible to get half-right: a
 * caller who wires `dismiss` everywhere cannot leave an in-app close path that
 * bypasses history. `dismiss` is safe to call when inactive — it is just
 * `history.back()`, and an inactive layer is not registered to consume it.
 */
export function useDismissLayer(active: boolean, onDismiss: () => void): () => void {
  const host = useContext(NavHostContext);
  const box = useRef<() => void>(onDismiss);

  // Kept fresh out-of-band so the layer registers exactly once per open, not
  // once per render of an inline callback.
  useEffect(() => {
    box.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (host === null || !active) {
      return;
    }
    return host.registerLayer(box);
  }, [host, active]);

  return useNavBack();
}
