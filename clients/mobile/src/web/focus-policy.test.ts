import { describe, expect, it, vi } from "vitest";
import {
  framedFocusReading,
  installFocusPolicy,
  type FocusDocument,
  type FocusPolicySurface,
  type ObserveOnScreen,
} from "./focus-policy";

/**
 * A document whose three inputs are all settable, because the whole question is
 * how the reading composes them and a real `Document` lets you set none of them.
 */
function fakeDocument(initial: {
  readonly nativeHasFocus: boolean;
  readonly visibilityState: string;
}): {
  readonly doc: FocusDocument;
  set: (next: Partial<typeof initial>) => void;
  nativeCalls: () => number;
} {
  let nativeHasFocus = initial.nativeHasFocus;
  let visibilityState = initial.visibilityState;
  let nativeCalls = 0;
  const doc: FocusDocument = {
    hasFocus(): boolean {
      nativeCalls++;
      return nativeHasFocus;
    },
    get visibilityState(): string {
      return visibilityState;
    },
    // A real element, so the observer seam is handed the same kind of thing it
    // gets in the app rather than a shape that only type-checks.
    documentElement: globalThis.document.createElement("div"),
  };
  return {
    doc,
    set: (next) => {
      if (next.nativeHasFocus !== undefined) nativeHasFocus = next.nativeHasFocus;
      if (next.visibilityState !== undefined) visibilityState = next.visibilityState;
    },
    nativeCalls: () => nativeCalls,
  };
}

/** An observer that never fires unless the test says so. */
function controllableObserver(): {
  readonly observe: ObserveOnScreen;
  fire: (onScreen: boolean) => void;
  observedCount: () => number;
} {
  let emit: ((onScreen: boolean) => void) | null = null;
  let observedCount = 0;
  return {
    observe: (_element, onChange) => {
      observedCount++;
      emit = onChange;
      return true;
    },
    fire: (onScreen) => {
      if (emit === null) throw new Error("observer was never installed");
      emit(onScreen);
    },
    observedCount: () => observedCount,
  };
}

const NO_OBSERVER: ObserveOnScreen = () => false;

function install(options: {
  readonly framed: boolean;
  readonly doc: FocusDocument;
  readonly observe: ObserveOnScreen;
}): {
  readonly surface: FocusPolicySurface;
  readonly reported: FocusPolicySurface[];
  readonly onScreenReports: boolean[];
} {
  const reported: FocusPolicySurface[] = [];
  const onScreenReports: boolean[] = [];
  const surface = installFocusPolicy({
    document: options.doc,
    isFramed: () => options.framed,
    observeOnScreen: options.observe,
    report: (s) => reported.push(s),
    reportOnScreen: (v) => onScreenReports.push(v),
  });
  return { surface, reported, onScreenReports };
}

describe("framedFocusReading", () => {
  it("is true whenever the document natively holds focus, whatever the geometry says", () => {
    // Both geometry terms are the ones that would say NO, so this fails the
    // moment the short-circuit is removed rather than passing by agreement.
    expect(
      framedFocusReading({ nativeHasFocus: true, visible: false, onScreen: false }),
    ).toBe(true);
  });

  it("is true for a visible on-screen frame that does not hold focus", () => {
    expect(
      framedFocusReading({ nativeHasFocus: false, visible: true, onScreen: true }),
    ).toBe(true);
  });

  it("is false when the page is not visible", () => {
    expect(
      framedFocusReading({ nativeHasFocus: false, visible: false, onScreen: true }),
    ).toBe(false);
  });

  it("is false when the frame is off screen", () => {
    expect(
      framedFocusReading({ nativeHasFocus: false, visible: true, onScreen: false }),
    ).toBe(false);
  });
});

describe("installFocusPolicy", () => {
  it("leaves the native method strictly alone outside a frame", () => {
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    const before = doc.hasFocus;
    const observer = controllableObserver();

    const result = install({ framed: false, doc, observe: observer.observe });

    expect(result.surface).toBe("native");
    expect(result.reported).toEqual(["native"]);
    // Identity, not behaviour: a replacement that happened to return the same
    // value would pass a behavioural check and still be a replacement.
    expect(doc.hasFocus).toBe(before);
    expect(observer.observedCount()).toBe(0);
  });

  it("reports `unmeasured` and overrides nothing when there is no observer", () => {
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    const before = doc.hasFocus;

    const result = install({ framed: true, doc, observe: NO_OBSERVER });

    expect(result.surface).toBe("unmeasured");
    expect(result.reported).toEqual(["unmeasured"]);
    expect(doc.hasFocus).toBe(before);
  });

  it("reports `framed` and installs the reading when framed with an observer", () => {
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    const before = doc.hasFocus;

    const result = install({
      framed: true,
      doc,
      observe: controllableObserver().observe,
    });

    expect(result.surface).toBe("framed");
    expect(result.reported).toEqual(["framed"]);
    expect(doc.hasFocus).not.toBe(before);
  });

  it("reads false until the observer has said the frame is on screen", () => {
    // The safe default, and the reason it is asserted rather than assumed: a
    // `true` here would suppress notifications on an assumption during the
    // window before the first callback.
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    install({ framed: true, doc, observe: controllableObserver().observe });

    expect(doc.hasFocus()).toBe(false);
  });

  /**
   * THE SEAM TEST. Everything above can be green while the installed method
   * ignores its own inputs - which is exactly the defect being fixed, one layer
   * down. This drives the real `document.hasFocus()` through the four states a
   * Teams tab actually moves between.
   */
  it("answers each state through the installed method, re-read every call", () => {
    const { doc, set, nativeCalls } = fakeDocument({
      nativeHasFocus: false,
      visibilityState: "visible",
    });
    const observer = controllableObserver();
    install({ framed: true, doc, observe: observer.observe });

    // 1. Teams is showing the tab; the user has clicked Teams' own chrome.
    observer.fire(true);
    expect(doc.hasFocus()).toBe(true);

    // 2. The user clicks back into the app.
    set({ nativeHasFocus: true });
    expect(doc.hasFocus()).toBe(true);

    // 3. Teams switches to another tab and removes this frame from the layout.
    set({ nativeHasFocus: false });
    observer.fire(false);
    expect(doc.hasFocus()).toBe(false);

    // 4. The frame is back on screen, but the whole window is backgrounded.
    observer.fire(true);
    set({ visibilityState: "hidden" });
    expect(doc.hasFocus()).toBe(false);

    // Every answer above came from a fresh read of the native method rather
    // than one cached at install.
    expect(nativeCalls()).toBeGreaterThanOrEqual(4);
  });

  it("reports each on-screen change so an installed observer can be told from a live one", () => {
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    const observer = controllableObserver();
    const result = install({ framed: true, doc, observe: observer.observe });

    expect(result.onScreenReports).toEqual([]);
    observer.fire(true);
    observer.fire(false);
    expect(result.onScreenReports).toEqual([true, false]);
  });

  it("falls back to `unmeasured` when the document refuses the override", () => {
    const { doc } = fakeDocument({ nativeHasFocus: false, visibilityState: "visible" });
    const frozen = Object.freeze(doc);
    const spy = vi.spyOn(Object, "defineProperty").mockImplementation(() => {
      throw new TypeError("refused");
    });
    try {
      const result = install({
        framed: true,
        doc: frozen,
        observe: controllableObserver().observe,
      });
      expect(result.surface).toBe("unmeasured");
      expect(result.reported).toEqual(["unmeasured"]);
    } finally {
      spy.mockRestore();
    }
  });
});
