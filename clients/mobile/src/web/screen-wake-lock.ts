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

/**
 * `policy-blocked` and `deferred` are the two readings this module used to
 * collapse, and the first one is why the Teams answer was unobtainable for
 * three check-ins.
 *
 * `unavailable` means TRANSIENT: the surface is permitted to hold a lock and
 * the request was refused anyway - battery saver, OS power policy - so a later
 * attempt can succeed and re-acquiring on visibility is worth doing.
 * `policy-blocked` means PERMANENT: permissions policy does not grant this
 * document the feature at all, which is fixed for the document's lifetime, so
 * every retry is guaranteed to fail. Same `NotAllowedError` from `request`,
 * opposite next actions, and a probe that sees only `unavailable` cannot tell
 * a phone saving power from a tab that can never do this.
 */
export type WakeLockOutcome =
  | "held"
  | "off"
  | "unsupported"
  | "policy-blocked"
  | "deferred"
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

/**
 * The one member of `FeaturePolicy`/`PermissionsPolicy` this module touches.
 * Not in `lib.dom` - Chromium ships `document.featurePolicy`, the spec renamed
 * it `permissionsPolicy`, and TypeScript declares neither - so the shape is
 * declared here rather than asserted past at the call site.
 */
export interface PermissionsPolicy {
  allowsFeature(feature: string): boolean;
}

export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  /** Chromium's name. Present in Teams (Electron and Edge are both Chromium). */
  readonly featurePolicy?: PermissionsPolicy;
  /** The spec's name, read too so a rename does not silently disable this. */
  readonly permissionsPolicy?: PermissionsPolicy;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Is this document structurally barred from holding a screen wake lock?
 *
 * MEASURED, headed Chromium 1228, four arms, one variable:
 *
 * | arm                                          | `allowsFeature` | `request`         |
 * | -------------------------------------------- | --------------- | ----------------- |
 * | top level - CONTROL                          | `true`          | held              |
 * | same-origin iframe - CONTROL                 | `true`          | held              |
 * | cross-origin iframe, Teams' sandbox, no allow | **`false`**     | `NotAllowedError` |
 * | the same frame + `allow="screen-wake-lock *"` | `true`          | held              |
 *
 * The same-origin control is what makes this a statement about DELEGATION
 * rather than about framing, and the fourth arm is what makes it a statement
 * about the parent rather than about the surface: the capability is delegable,
 * so whether a Teams tab holds a lock is decided by Teams' own `allow`
 * attribute. That attribute cannot be read from outside a real install - but
 * `allowsFeature` is the SAME answer read from inside, by the shipped bundle,
 * on the real surface. This is how the epic's three-run "genuinely unknown"
 * gets answered by a deployment instead of by a probe.
 *
 * NOT named `surface-blocked` like its sibling in `notification-permission.ts`,
 * and the difference is load-bearing: that one INFERS a block from being
 * cross-origin, because notifications expose no policy read. This one READS the
 * policy. Borrowing the name would suggest the two were established the same
 * way, and only one of them is a measurement.
 *
 * Where the API is absent - Firefox, Safari, jsdom - this answers `false` and
 * the request is attempted. That direction matches the rest of the module: only
 * an explicit `off` disables it, and a lock that might work is worth asking
 * for. A false `true` would withhold the feature from a surface that would have
 * granted it, on no evidence at all.
 */
export function isWakeLockPolicyBlocked(doc: VisibilityDocument): boolean {
  const policy = doc.featurePolicy ?? doc.permissionsPolicy;
  if (policy === undefined) return false;
  try {
    return !policy.allowsFeature("screen-wake-lock");
  } catch {
    return false;
  }
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
  // Checked BEFORE requesting, and it returns rather than falling through.
  // Permissions policy is fixed when the document is created, from the frame's
  // `allow` attribute, and cannot change without a navigation - so this is not
  // a state to retry out of. Without the early return the module would request
  // a lock it can never get on every single visibility change, forever, and
  // report the permanent refusal as the transient one each time.
  if (isWakeLockPolicyBlocked(doc)) {
    report("policy-blocked");
    return () => {};
  }

  let sentinel: WakeLockHandle | null = null;
  let stopped = false;

  const acquire = async (): Promise<void> => {
    if (stopped || sentinel !== null) return;
    if (doc.visibilityState !== "visible") {
      // Says so, rather than returning in silence. This is the only path that
      // used to leave `<html data-wake-lock>` with NO attribute of any kind,
      // and the module's own contract above promises the attribute reports what
      // it did. Absent is not one of the outcomes - it reads identically to an
      // old bundle, to a boot that threw before reaching this, and to the
      // module never having been wired, which is exactly how `data-push` hid
      // one module over.
      report("deferred");
      return;
    }
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
      // Reaching here now means the surface WAS permitted and refused anyway -
      // low battery, OS power-saving. A normal outcome for a comfort feature,
      // not an error worth surfacing, and one a later attempt can recover from.
      //
      // The old comment here also named "an unsupported surface", which was a
      // wrong attribution of exactly the kind this module now exists to remove:
      // the permitted/forbidden split is decided above and returns, so a
      // forbidden surface cannot arrive at this line.
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
      // And say so. Leaving the attribute on `held` here would have it assert
      // the lock is being held at the one moment it provably is not.
      report("deferred");
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
