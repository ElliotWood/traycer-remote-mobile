/**
 * The arithmetic behind "OS back pops ONE level of the app's own stack".
 *
 * The phone client renders its whole UI at a single URL, so the browser's
 * history is not a record of *where* the user is — it is only a record of *how
 * deep* they are. This module owns that correspondence, framework-free (no
 * React, no `window`) so the interesting cases are unit-testable directly;
 * `nav-host.tsx` is the thin binding that calls `window.history` for real.
 *
 * ## The invariant
 *
 * There is ONE synthetic history entry per level of app depth beyond the root,
 * where depth counts BOTH tiers of back-consuming UI:
 *
 *     depth = (route frames above fleet) + (open dismissible layers)
 *
 * Each pushed entry is stamped with the depth it represents (`DEPTH_STATE_KEY`).
 * That stamp — not an event counter — is what makes the handler self-healing:
 * `popstate` reports the depth the browser *landed on*, so the app can always
 * compute how many levels to shed, no matter how the traversal happened (a
 * single back tap, a long-press jump of three entries, or a `history.go(-n)`
 * the app issued itself). Counting events instead would break on exactly those
 * cases, because `history.go(-n)` fires ONE `popstate`, not `n`.
 *
 * ## Why layers before routes
 *
 * A sheet or a full-screen form is visually *on top of* the screen underneath
 * it, so dismissing it is what the user means by "back" — popping the route out
 * from under an open sheet would be two levels at once. Layers are therefore
 * consumed last-in-first-out before any route frame is touched.
 */

/** The key our depth stamp lives under in a history entry's `state`. Namespaced because the entry's `state` is shared with anything else that calls `replaceState` on this page. */
export const DEPTH_STATE_KEY = "traycerNavDepth";

/**
 * The key identifying WHICH page load wrote a stamp.
 *
 * Depth stamps survive a reload, but the app's navigation stack does not — so
 * after a hard refresh mid-stack the entries behind the user describe screens
 * that no longer exist, stamped with depths the freshly-booted app has no
 * relationship to. Reading those as our own is actively harmful: a stale stamp
 * DEEPER than our committed depth makes `unitsToConsume` clamp to zero, and back
 * silently does nothing — the exact bug this module exists to remove.
 *
 * Scoping every stamp to its page load makes that impossible. A foreign stamp
 * reads as depth 0 ("root"), which is the safe direction: the worst outcome is a
 * back tap that exits at the root, never one that strands the user.
 *
 * This is deliberately belt-and-braces with `NavHost`'s boot-time collapse of
 * stale entries. The collapse is a `history.go(-n)`, and a pending traversal can
 * be cancelled by a `pushState` that races it (verified: jsdom drops it outright,
 * and the interaction is unspecified enough not to rely on across browsers). So
 * the collapse is treated as tidying, and CORRECTNESS rests here instead — on
 * arithmetic that cannot be raced.
 */
export const SESSION_STATE_KEY = "traycerNavSession";

interface RawStamp {
  readonly depth: number;
  readonly session: string;
}

/**
 * Deliberately total: `state` is untrusted input (it survives reloads, and
 * `replaceState` callers elsewhere on the page can clobber it), so anything that
 * isn't a well-formed stamp reads as absent.
 */
function readRawStamp(state: unknown): RawStamp | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  if (!(DEPTH_STATE_KEY in state) || !(SESSION_STATE_KEY in state)) {
    return null;
  }
  const depth: unknown = state[DEPTH_STATE_KEY];
  const session: unknown = state[SESSION_STATE_KEY];
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0) {
    return null;
  }
  if (typeof session !== "string" || session.length === 0) {
    return null;
  }
  return { depth, session };
}

/** Build the `state` payload for an entry at `depth`, owned by `session`. */
export function depthStamp(depth: number, session: string): Record<string, string | number> {
  return { [DEPTH_STATE_KEY]: depth, [SESSION_STATE_KEY]: session };
}

/**
 * The depth THIS page load stamped on an entry — 0 for a fresh entry, a foreign
 * (pre-reload) entry, or anything malformed. This is the only reading used for
 * back arithmetic.
 */
export function readDepthStamp(state: unknown, session: string): number {
  const stamp = readRawStamp(state);
  return stamp !== null && stamp.session === session ? stamp.depth : 0;
}

/**
 * The depth a DIFFERENT page load stamped on an entry — i.e. "this tab reloaded
 * while `n` levels deep". Used once, at boot, to decide how far back the stale
 * entries go; never for back arithmetic.
 */
export function readForeignDepth(state: unknown, session: string): number {
  const stamp = readRawStamp(state);
  return stamp !== null && stamp.session !== session ? stamp.depth : 0;
}

/** What `nav-host` must do to `window.history` to make the committed depth match the app's actual depth. */
export interface DepthSyncPlan {
  /** Depths to `pushState`, in order — empty when the app got shallower or stayed put. */
  readonly push: readonly number[];
  /** Argument for `history.go` (always negative), or 0 when nothing needs shedding. */
  readonly go: number;
}

const NO_SYNC: DepthSyncPlan = { push: [], go: 0 };

/**
 * Reconcile committed history depth with the app's current depth.
 *
 * Called on every render, which is safe *because* it is a diff: when the two
 * already agree the plan is empty, so an unconditional call is a no-op rather
 * than a runaway push. That is what lets the binding avoid ordering games
 * between a parent's route effect and a child's layer-registration effect —
 * whichever runs first, the next reconcile corrects it.
 *
 * The shedding case (`go < 0`) is not dead code: a route action can *reduce*
 * depth without any back gesture — `goto-chat` from a notification tap
 * replaces a 3-deep stack with a 2-deep one, and the extra entry has to go or
 * the next back tap would consume nothing and look broken.
 */
export function planDepthSync(committedDepth: number, targetDepth: number): DepthSyncPlan {
  if (targetDepth > committedDepth) {
    const push: number[] = [];
    for (let depth = committedDepth + 1; depth <= targetDepth; depth += 1) {
      push.push(depth);
    }
    return { push, go: 0 };
  }
  if (targetDepth < committedDepth) {
    return { push: [], go: targetDepth - committedDepth };
  }
  return NO_SYNC;
}

/**
 * How many levels of app depth a `popstate` should consume.
 *
 * Clamped at 0 so a FORWARD traversal (landing deeper than we are) consumes
 * nothing rather than going negative — the app does not restore forward
 * history, so "forward" is a no-op it must survive rather than honour.
 *
 * A self-issued `history.go(-n)` also lands here, and correctly consumes
 * nothing: `nav-host` commits the new depth *before* calling `go`, so by the
 * time the event arrives `committedDepth` already equals `landedDepth`.
 */
export function unitsToConsume(committedDepth: number, landedDepth: number): number {
  return Math.max(0, committedDepth - landedDepth);
}

/** How a back consumption divides between the two tiers. */
export interface BackConsumption {
  /** Layers to dismiss, newest first. */
  readonly dismissLayers: number;
  /** Route frames to pop after the layers are gone. */
  readonly popRoutes: number;
  /**
   * True when the app had nothing left to consume — the user is at the fleet
   * root with no layers open, and the platform's own "back closes the app"
   * is the correct outcome. The binding does nothing in this case (the entry
   * is already gone); this flag exists so the intent is testable and explicit
   * rather than an implicit fall-through.
   */
  readonly allowExit: boolean;
}

/**
 * Split `units` of back across the open layers and then the route stack.
 *
 * Layers first (LIFO) — see the module docblock. `routeDepth` caps `popRoutes`
 * so a burst of units can never try to pop the fleet root: the root is not a
 * level the user navigated *to*, so there is nothing above it to return to.
 */
export function planBackConsumption(
  units: number,
  layerCount: number,
  routeDepth: number,
): BackConsumption {
  const dismissLayers = Math.min(layerCount, units);
  const popRoutes = Math.min(routeDepth, units - dismissLayers);
  return {
    dismissLayers,
    popRoutes,
    allowExit: units > 0 && dismissLayers === 0 && popRoutes === 0,
  };
}
