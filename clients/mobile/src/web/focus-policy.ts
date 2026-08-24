/**
 * Stops the Teams tab notifying the user about the chat that is open in front
 * of them.
 *
 * BROWSER-PROOF BUILD ONLY - sibling of `teams-host.ts`, same scope.
 *
 * ## The defect, end to end
 *
 * `notification-display.ts` gates every host-channel emission and every cloud
 * snapshot arrival on `readFocusedHostNotificationPresenceEntity()`, whose own
 * docblock states the intent exactly: *"this gate re-checks live focus at
 * display time so the tab you are looking at never toasts about its own
 * activity; rows for other entities still display."*
 *
 * That function returns `null` - meaning *suppress nothing* - the instant
 * `document.hasFocus()` is false (`notification-presence.ts:70`). The same
 * reading is also what the client reports to the host as `presence.focused`
 * (`notification-presence.ts:31`).
 *
 * In a browser tab `document.hasFocus()` is a good proxy for "the user is
 * looking at this". In a FRAME it is not, and the difference is not subtle:
 * the surrounding chrome is part of the same page, so every click on Teams'
 * rail, tab strip or compose box takes focus out of the app while the app
 * stays fully on screen. A freshly opened tab has never been clicked at all.
 *
 * ## Measured, not reasoned - `scratch/teams-shell-probe/focus-presence.mjs`
 *
 * Chromium 1228, Teams' own sandbox token set, three arms x three states.
 * Identical under `headless` and `HEADFUL=1`:
 *
 * | arm                 | on load    | clicked in app | clicked host chrome |
 * | ------------------- | ---------- | -------------- | ------------------- |
 * | top level (control) | **true**   | true           | *n/a*               |
 * | same-origin frame   | **false**  | true           | **false**           |
 * | cross-origin frame  | **false**  | true           | **false**           |
 *
 * `visibilityState` reads `visible` in every cell above - the app is on screen
 * throughout. THE TOP ARM IS WHAT MAKES THE OTHERS READABLE: a headless browser
 * holds no focus at all (already recorded for the wake lock), so a run where
 * every arm read false would have measured nothing. It reads `true` with zero
 * interaction, so the framed `false` is the frame and not the harness.
 *
 * BOTH FRAMED ARMS AGREE, so unlike `embedding.ts` this module tests for being
 * FRAMED and not for being cross-origin. Being cross-origin is what takes the
 * notification permission away; being framed is what breaks focus. Two
 * different questions, and the same-origin arm is what separates them.
 *
 * ## What replaces it, and the part that is deliberately NOT claimed
 *
 * `scratch/teams-shell-probe/frame-hidden.mjs` asked whether a frame can tell
 * "the host is showing me" from "the host switched away". Five mechanisms, with
 * the frame clicked first so focus starts true:
 *
 * | the host did this  | `intersectionRatio` | `hasFocus` | `visibilityState` |
 * | ------------------ | ------------------- | ---------- | ----------------- |
 * | nothing (baseline) | 1                   | true       | visible           |
 * | `display:none`     | **0**               | true       | visible           |
 * | moved off screen   | **0**               | true       | visible           |
 * | `visibility:hidden`| 1                   | true       | visible           |
 * | covered opaquely   | 1                   | true       | visible           |
 *
 * So an `IntersectionObserver` against the implicit root DOES see the two
 * mechanisms that remove a frame from the layout, and does NOT see the two that
 * leave it in place. Both readings are from the same observer in the same run,
 * with a restore between each, so the 1s are a measured absence rather than a
 * stuck instrument.
 *
 * The reading this installs is therefore:
 *
 *     hasFocus() || (visibilityState === "visible" && onScreen)
 *
 * ### Three things this does not know, stated because the safe direction differs
 *
 * 1. **`visibilityState` when the whole window is backgrounded is UNMEASURED
 *    here, not measured absent.** The probe's own control for it failed:
 *    bringing a second tab to the front left the frame reading `visible` under
 *    headless AND headful, which is [[browser-probe-environment-limits]] - this
 *    box does not background pages. The term is kept because it can only make
 *    the reading more conservative, and it is labelled unmeasured rather than
 *    quietly relied on.
 * 2. **A frame hidden by `visibility:hidden`, or covered by another window,
 *    reads as focused.** Measured, above. This is the one direction that can
 *    cost a notification.
 * 3. Which of those Teams actually uses is unverified - no real Teams install
 *    on this box (the standing exemption).
 *
 * ### Why (2) is acceptable here and would not be on the desktop
 *
 * The blast radius of a wrong `true` is one entity: the gate suppresses only
 * rows matching the entity the user is looking at, and every other row still
 * displays. And on THIS surface the suppressed output is an in-app toast and a
 * chime - `web-notification-host.ts` reports `surface-blocked` for a
 * cross-origin frame, so there is no OS notification to lose. A toast in a tab
 * the user is not looking at was never going to be seen; the chime is the whole
 * of what a wrong `true` costs.
 *
 * Against that, the wrong `false` it replaces fires a toast AND a chime for the
 * chat on screen, every time, from load until the first click inside the frame
 * and again after every click on Teams' own chrome.
 *
 * ## Why the platform and not the call site
 *
 * Under convergence the UI is upstream's and the shell adapts the platform
 * beneath it - the same reasoning as `clipboard-fallback.ts` and
 * `microphone-policy.ts`. `document.hasFocus` is a platform reading, and
 * `notification-presence.ts` is correct everywhere the reading means what it
 * says, which is every surface upstream ships to. Our frame is what introduces
 * a meaning it was not written for.
 *
 * The override is also narrower than it looks: `document.hasFocus` has exactly
 * ONE non-test caller in gui-app (`notification-presence.ts:75`) - grepped, not
 * assumed. The `hasFocus` in `composer-prompt-editor.tsx` is the editor
 * handle's own method and never touches the document.
 */

/** What `document.hasFocus()` means on this surface. */
export type FocusPolicySurface =
  /** Not framed. The native reading is correct and is left completely alone. */
  | "native"
  /** Framed, and the frame-honest reading is installed. */
  | "framed"
  /**
   * Framed, but there is no `IntersectionObserver` to say whether the frame is
   * on screen - jsdom, or an old browser. NOT a synonym for `native`: one is a
   * surface that needs no adaptation and one is a surface that needs it and
   * cannot have it. Nothing is overridden, because the reading without its
   * on-screen term is `visibilityState === "visible"`, which is true almost
   * always and would suppress far more than the defect being fixed.
   */
  | "unmeasured";

/**
 * The reading itself, pure and exported so the decision can be tested without
 * a DOM, an observer, or a frame.
 *
 * `nativeHasFocus` is checked FIRST and short-circuits: a document that holds
 * focus is being looked at, and no amount of geometry can make that less true.
 * Everything after it is the frame-only recovery.
 */
export function framedFocusReading(input: {
  readonly nativeHasFocus: boolean;
  readonly visible: boolean;
  readonly onScreen: boolean;
}): boolean {
  if (input.nativeHasFocus) return true;
  return input.visible && input.onScreen;
}

export interface FocusDocument {
  hasFocus(): boolean;
  readonly visibilityState: string;
  readonly documentElement: Element;
}

/**
 * Starts watching whether the frame is on screen, and returns whether there was
 * anything to watch with.
 *
 * Split out and injectable because `IntersectionObserver` is absent in jsdom,
 * and a test that had to shim the real constructor would be testing the shim.
 */
export type ObserveOnScreen = (
  element: Element,
  onChange: (onScreen: boolean) => void,
) => boolean;

function defaultObserveOnScreen(
  element: Element,
  onChange: (onScreen: boolean) => void,
): boolean {
  const ctor = (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver;
  if (ctor === undefined) return false;
  try {
    // Implicit root. For a frame Chromium computes this against the TOP-LEVEL
    // viewport, which is the whole reason it can see a frame the host removed -
    // measured in `frame-hidden.mjs`, not taken from the spec's wording.
    const observer = new ctor((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) onChange(last.intersectionRatio > 0);
    });
    observer.observe(element);
    return true;
  } catch {
    return false;
  }
}

export interface FocusPolicyOptions {
  readonly document?: FocusDocument;
  readonly isFramed?: () => boolean;
  readonly observeOnScreen?: ObserveOnScreen;
  /** Reports the surface. Defaults to stamping `<html data-focus-policy>`. */
  readonly report?: (surface: FocusPolicySurface) => void;
  /**
   * Reports each on-screen change. Defaults to stamping
   * `<html data-focus-onscreen>`.
   *
   * Separate from `report` because they answer different questions and the
   * second one is the only thing that can show the mechanism is LIVE rather
   * than merely installed - `data-focus-policy="framed"` on a frame whose
   * observer never fires reads exactly like one whose observer works.
   */
  readonly reportOnScreen?: (onScreen: boolean) => void;
}

/**
 * Installs the frame-honest `document.hasFocus`, and returns the surface it
 * measured. Never throws.
 *
 * OUTSIDE A FRAME THIS TOUCHES NOTHING. The PWA, the desktop renderer and every
 * upstream surface keep the native method, byte for byte - the defect is
 * created by framing and so is the repair.
 *
 * The override is an OWN property on the document instance, shadowing
 * `Document.prototype.hasFocus`, which is what makes it visible to
 * `document.hasFocus()` at the one call site that matters without patching a
 * prototype every other document on the page would share.
 */
export function installFocusPolicy(
  options: FocusPolicyOptions,
): FocusPolicySurface {
  // No cast: a real `Document` satisfies `FocusDocument` structurally, which is
  // the point of declaring the shape this narrowly. `visibilityState` widens
  // from `DocumentVisibilityState` to `string` and `documentElement` narrows
  // from `HTMLElement` to `Element`, both in the assignable direction.
  const doc: FocusDocument = options.document ?? globalThis.document;
  const report =
    options.report ??
    ((surface: FocusPolicySurface): void => {
      document.documentElement.dataset.focusPolicy = surface;
    });
  const reportOnScreen =
    options.reportOnScreen ??
    ((onScreen: boolean): void => {
      document.documentElement.dataset.focusOnscreen = String(onScreen);
    });

  const isFramed =
    options.isFramed ??
    ((): boolean => {
      // Identity comparison only - same-origin-policy safe where property reads
      // are not. An embedder exotic enough to throw is treated as framed, which
      // is the direction `embedding.ts` also takes for its own reading.
      try {
        return globalThis.window !== globalThis.window.parent;
      } catch {
        return true;
      }
    });

  if (!isFramed()) {
    report("native");
    return "native";
  }

  // FALSE until the observer says otherwise, so the moment before the first
  // callback behaves exactly as today rather than suppressing on an assumption.
  let onScreen = false;
  const observe = options.observeOnScreen ?? defaultObserveOnScreen;
  const observing = observe(doc.documentElement, (next) => {
    onScreen = next;
    reportOnScreen(next);
  });

  if (!observing) {
    report("unmeasured");
    return "unmeasured";
  }

  const native = doc.hasFocus.bind(doc);
  try {
    Object.defineProperty(doc, "hasFocus", {
      value: (): boolean =>
        framedFocusReading({
          // Re-read every call. This is consulted at DISPLAY time, arbitrarily
          // long after install, and a cached reading would be the exact staleness
          // the gate's own docblock exists to avoid.
          nativeHasFocus: native(),
          visible: doc.visibilityState === "visible",
          onScreen,
        }),
      configurable: true,
      writable: true,
    });
  } catch {
    // A document that refuses the definition keeps the native reading, and the
    // attribute below would then overstate what happened.
    report("unmeasured");
    return "unmeasured";
  }

  report("framed");
  return "framed";
}
