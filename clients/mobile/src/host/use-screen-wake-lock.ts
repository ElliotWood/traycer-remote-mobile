/**
 * Keeps the phone screen awake while the app is open (Screen Wake Lock API).
 *
 * DEFAULT IS "always" AT THE USER'S EXPLICIT REQUEST. They were told the
 * battery cost — holding the screen on dwarfs every other optimisation in
 * this client combined — and chose it knowingly ("I'll take the battery
 * hit"). Recorded in the epic decision log. Do NOT quietly change the
 * default back while reading the performance work; that would be reversing
 * an informed decision, not fixing an oversight.
 *
 * Requires a secure context, satisfied since the tailnet origin serves real
 * HTTPS. Supported on Chrome/Edge Android and Safari iOS 16.4+.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

export type WakeLockPreference = "off" | "while-running" | "always";

export const WAKE_LOCK_STORAGE_KEY = "traycer.mobile.wakeLock";

/** The user's explicit choice — see the docblock before changing this. */
export const DEFAULT_WAKE_LOCK_PREFERENCE: WakeLockPreference = "always";

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function readWakeLockPreference(): WakeLockPreference {
  try {
    const raw = window.localStorage.getItem(WAKE_LOCK_STORAGE_KEY);
    if (raw === "off" || raw === "while-running" || raw === "always") return raw;
  } catch {
    // Private mode / storage disabled — fall through to the default.
  }
  return DEFAULT_WAKE_LOCK_PREFERENCE;
}

/**
 * Module-level subscribers so changing the setting takes effect immediately.
 * The alternative — plumbing the value from the settings screen up to the
 * shell that holds the lock — would thread a prop through several unrelated
 * layers for one rarely-changed value.
 */
const listeners = new Set<() => void>();
let cached: WakeLockPreference | null = null;

export function writeWakeLockPreference(value: WakeLockPreference): void {
  cached = value;
  try {
    window.localStorage.setItem(WAKE_LOCK_STORAGE_KEY, value);
  } catch {
    // Non-fatal: the setting simply won't persist across reloads.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WakeLockPreference {
  cached ??= readWakeLockPreference();
  return cached;
}

/** Reactive read of the preference — re-renders on `writeWakeLockPreference`. */
export function useWakeLockPreference(): WakeLockPreference {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_WAKE_LOCK_PREFERENCE);
}

/**
 * Holds a screen wake lock while `active`.
 *
 * THE TRAP THIS HANDLES: the browser silently releases the lock every time
 * the page hides, and never restores it. Without re-acquiring on
 * `visibilitychange` the feature appears to work exactly once and then looks
 * broken. This owns the only `visibilitychange` listener it needs; it is
 * deliberately NOT folded into `liveness-recovery`, whose listeners exist to
 * drive reconnection — coupling an unrelated concern into that path would
 * make both harder to reason about.
 */
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !isWakeLockSupported()) return;

    let disposed = false;

    const release = (): void => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      // Already-released sentinels reject; nothing to do about it either way.
      if (sentinel !== null) void sentinel.release().catch(() => {});
    };

    const acquire = async (): Promise<void> => {
      // `request` rejects on low battery, OS power-saving, or an unsupported
      // surface. That is a normal outcome, not an error worth surfacing —
      // this is a comfort feature and must degrade silently.
      if (disposed || document.visibilityState !== "visible") return;
      if (sentinelRef.current !== null) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (disposed || !active) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // The OS can drop it independently (battery saver kicking in).
        // Clear our handle so a later visibility change can re-acquire.
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        sentinelRef.current = null;
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void acquire();
      else sentinelRef.current = null; // the browser already released it
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [active]);
}
