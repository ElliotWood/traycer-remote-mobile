/**
 * Keeps the phone screen awake while the app is open (Screen Wake Lock API).
 *
 * DEFAULT IS "always" AT THE USER'S EXPLICIT REQUEST. Elliot was told the
 * battery cost - holding the screen on dwarfs every other optimisation in this
 * client combined - and chose it knowingly ("I'll take the battery hit").
 * Recorded in the epic decision log. Do NOT quietly change the default back
 * while reading performance work; that reverses an informed decision rather
 * than fixing an oversight.
 *
 * Ported from the retired `clients/mobile/src/host/use-screen-wake-lock.ts`.
 * That was a React hook inside a UI we no longer own; this is the same
 * behaviour as a shell-level module, because under convergence the UI is
 * upstream's `gui-app` and we have no component to hang a hook on.
 *
 * ONE DISCLOSED REDUCTION, and it is disclosed the way this epic learned to:
 * with a mechanism, not a sentence. The old preference had three values -
 * `off`, `while-running`, `always` - and `while-running` needed to know whether
 * an agent was working, which the shell cannot see. So only a stored `off`
 * disables the lock; every other value holds it. That errs toward the setting
 * the user actually chose, and it is not taken on trust: the outcome is written
 * to `<html data-wake-lock>`, so what this module did is readable from outside
 * the app on a real deployment rather than argued about from source. The same
 * device `data-storage-durable` established for the storage port.
 *
 * There is no UI to change the preference. There was none to port - the
 * settings screen lived in the retired client - so a stored `off` can only come
 * from that client, on a device that ran it. Reading the same key is what makes
 * that a migration rather than an override.
 */

import { safeStorage } from "./safe-storage";

export const WAKE_LOCK_STORAGE_KEY = "traycer.mobile.wakeLock";

export type WakeLockOutcome =
  | "held"
  | "off"
  | "unsupported"
  | "unavailable";

/** Only an explicit `off` disables it - see the reduction note above. */
export function wakeLockEnabled(read: (key: string) => string | null): boolean {
  return read(WAKE_LOCK_STORAGE_KEY) !== "off";
}

/**
 * The three collaborators, each named as the narrowest shape this module
 * actually uses. Exported, and narrow on purpose: a test supplying a fake can
 * then satisfy the type outright instead of asserting its way past `Navigator`
 * and `Document`, which are far too wide to build honestly.
 */
/**
 * The two members of `WakeLockSentinel` this module touches. Real sentinels
 * satisfy it, so production is unaffected; the narrowness is what lets a test
 * build one without asserting past an interface it does not implement.
 */
export interface WakeLockHandle {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockNavigator {
  readonly wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
}

export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface StartOptions {
  readonly navigator?: WakeLockNavigator;
  readonly document?: VisibilityDocument;
  readonly read?: (key: string) => string | null;
  /** Reports what happened. Defaults to stamping `<html data-wake-lock>`. */
  readonly report?: (outcome: WakeLockOutcome) => void;
}

/**
 * Acquires and holds a screen wake lock. Returns a stop function.
 *
 * THE TRAP THIS HANDLES: the browser silently releases the lock every time the
 * page hides and never restores it. Without re-acquiring on `visibilitychange`
 * the feature appears to work exactly once and then looks broken - which is
 * indistinguishable, to a user, from it never having worked.
 */
export function startScreenWakeLock(options: StartOptions): () => void {
  const nav: WakeLockNavigator = options.navigator ?? globalThis.navigator;
  const doc: VisibilityDocument = options.document ?? globalThis.document;
  const read = options.read ?? ((key: string) => safeStorage().getItem(key));
  const report =
    options.report ??
    ((outcome: WakeLockOutcome): void => {
      document.documentElement.dataset.wakeLock = outcome;
    });

  if (!wakeLockEnabled(read)) {
    report("off");
    return () => {};
  }
  const wakeLock = nav.wakeLock;
  if (wakeLock === undefined) {
    report("unsupported");
    return () => {};
  }

  let sentinel: WakeLockHandle | null = null;
  let stopped = false;

  const acquire = async (): Promise<void> => {
    if (stopped || sentinel !== null) return;
    if (doc.visibilityState !== "visible") return;
    try {
      const acquired = await wakeLock.request("screen");
      if (stopped) {
        void acquired.release().catch(() => {});
        return;
      }
      sentinel = acquired;
      // The OS can drop it independently - battery saver kicking in. Clear the
      // handle so a later visibility change can re-acquire.
      acquired.addEventListener("release", () => {
        if (sentinel === acquired) sentinel = null;
      });
      report("held");
    } catch {
      // `request` rejects on low battery, OS power-saving, or an unsupported
      // surface. That is a normal outcome for a comfort feature, not an error
      // worth surfacing - but it is NOT the same as "off" or "unsupported",
      // and collapsing the three into one reading is how a probe later reports
      // that the feature works because the attribute was merely present.
      sentinel = null;
      report("unavailable");
    }
  };

  const onVisibilityChange = (): void => {
    if (doc.visibilityState === "visible") {
      void acquire();
    } else {
      // The browser has already released it; drop our handle so the next
      // visible transition re-acquires rather than short-circuiting.
      sentinel = null;
    }
  };

  void acquire();
  doc.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopped = true;
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    const held = sentinel;
    sentinel = null;
    if (held !== null) void held.release().catch(() => {});
  };
}
