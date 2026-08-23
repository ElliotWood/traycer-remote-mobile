/**
 * Stops the Teams tab telling the user they blocked a microphone nobody asked
 * them about.
 *
 * `microphone` is a PERMISSIONS-POLICY-gated feature whose default allowlist is
 * `self`. A cross-origin frame is refused it unless the parent delegates with
 * `allow="microphone"` - the fourth module in this shell to turn out to have
 * that shape, after `screen-wake-lock.ts`, `web-notification-host.ts` and
 * `clipboard-fallback.ts`.
 *
 * UNLIKE THOSE THREE, THERE IS NOTHING TO RECOVER. A clipboard write has
 * `execCommand`; a microphone has no fallback and this module does not pretend
 * otherwise. What is broken here is not the capability - it is the app's
 * ACCOUNT of why the capability is missing, and that is repairable.
 *
 * THE DEFECT, end to end. `use-voice-dictation.ts` classifies the failure by
 * error name:
 *
 *     const denied = error instanceof Error && error.name === "NotAllowedError";
 *
 * and a policy refusal arrives as exactly that. So on the Teams tab the user is
 * told "Microphone access is blocked for Traycer", asked to "Enable microphone
 * access for Traycer, then try again", and given an "Open Settings" button
 * which calls `openMicrophoneSettings()` - a documented no-op in this shell.
 * Three statements, and all three are false on this surface: they blocked
 * nothing, no setting of theirs can grant it, and the button does nothing.
 *
 * MEASURED, not reasoned. `scratch/teams-shell-probe/microphone.mjs`,
 * Chromium 1228, a fake capture device and an explicit `microphone` grant on
 * every arm so the USER-permission layer is `granted` everywhere by
 * construction and the policy is the only variable:
 *
 *   arm                   allowsFeature   permissions.query   getUserMedia
 *   top (control)         true            granted             resolved, 1 live
 *   same-origin frame     true            granted             resolved, 1 live
 *   cross-origin frame    FALSE           GRANTED             rejected NotAllowedError
 *   the same + allow=     true            granted             resolved, 1 live
 *
 * The same-origin arm carries Teams' own sandbox tokens, so this is a statement
 * about CROSS-ORIGIN DELEGATION and not about being framed. The fourth arm
 * makes it the parent's to grant.
 *
 * THE THIRD COLUMN IS THE REASON THIS MODULE READS THE POLICY AND NOT THE
 * PERMISSION. `navigator.permissions.query({name:"microphone"})` returns
 * `granted` in the refused arm - it is the obvious thing to reach for, it reads
 * as authoritative, and it is wrong in precisely the case that matters. It
 * answers "has the user decided?", which on this surface is a question nobody
 * ever put to them. Only `allowsFeature` separates the two refusals.
 *
 * WHY A SHELL MODULE AND NOT AN EDIT TO THE HOOK. Under convergence the UI is
 * upstream's and the shell adapts the platform beneath it. The hook's
 * classification is CORRECT everywhere the policy is granted, which is every
 * surface upstream ships to; it is our frame that introduces a refusal their
 * `NotAllowedError` branch was never written for.
 *
 * WHY NOT `requestMicrophoneAccess()`, WHICH LOOKS LIKE THE SEAM FOR THIS. The
 * hook calls it first and short-circuits on `"denied"` - so teaching it to
 * measure the policy would reach the SAME "Microphone access is blocked for
 * Traycer" copy and the same dead button, one step earlier and with a reading
 * to justify it. The obvious repair at the obvious seam makes the message no
 * better. Its `"granted"` is also honest against its actual contract: it exists
 * to drive the macOS OS-level prompt, and in a browser there is no such prompt.
 */

export type MicrophoneSurface =
  /** Permissions policy grants this document `microphone`. */
  | "granted"
  /**
   * It does not. Every `getUserMedia({audio})` on this surface will reject, and
   * no action available to the user can change that.
   */
  | "policy-blocked"
  /**
   * No permissions-policy API to read - Firefox, Safari, jsdom. NOT a synonym
   * for `policy-blocked`: one is a measurement and one is its absence, and
   * collapsing them is the mistake `screen-wake-lock.ts` was rewritten to undo.
   */
  | "unmeasured"
  /** `navigator.mediaDevices` itself is absent - an insecure context. */
  | "no-api";

/**
 * The error a policy refusal is re-thrown as.
 *
 * The NAME is the entire mechanism. It must not be `NotAllowedError`, because
 * that is the string `use-voice-dictation.ts` reads to mean "the user denied
 * it" - the misclassification this module exists to prevent. Anything else
 * routes to the hook's generic branch, which reports this message verbatim and
 * leaves `permissionDenied` false, so the "Open Settings" affordance is never
 * offered for a setting that does not exist.
 */
export class MicrophonePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraycerMicrophonePolicyError";
  }
}

const POLICY_BLOCKED_MESSAGE =
  "the page hosting Traycer has not granted it microphone access. " +
  "This is set by the host page, not by you, so no browser or system " +
  "permission of yours can enable it here.";

export interface PolicyDocument {
  readonly featurePolicy?: { allowsFeature(feature: string): boolean };
  readonly permissionsPolicy?: { allowsFeature(feature: string): boolean };
}

export interface MediaDevicesLike {
  // An explicit `| undefined` rather than `?:`, which this package bans. The
  // real `MediaDevices.getUserMedia` declares the parameter optional, and a
  // function with an optional parameter is assignable to one that requires it,
  // so a real navigator still satisfies this.
  getUserMedia(
    constraints: MediaStreamConstraints | undefined,
  ): Promise<MediaStream>;
}

export interface MediaNavigator {
  mediaDevices?: MediaDevicesLike;
}

/**
 * Reads what the document is allowed to do, from inside the document.
 *
 * Returns `null` where there is no API to ask, rather than a boolean. A `false`
 * would say "measured, and refused" about a browser that was never asked, and
 * telling those apart on the real install is most of this module's value.
 *
 * Chromium exposes `featurePolicy` and the spec renamed it `permissionsPolicy`;
 * both are read for the same reason `clipboard-fallback.ts` reads both.
 */
export function readMicrophonePolicy(doc: PolicyDocument): boolean | null {
  const policy = doc.featurePolicy ?? doc.permissionsPolicy;
  if (policy === undefined) return null;
  try {
    return policy.allowsFeature("microphone");
  } catch {
    return null;
  }
}

/**
 * Does this request need the microphone?
 *
 * A video-only request is governed by the `camera` policy, which this module
 * has neither measured nor wrapped. Nothing in gui-app requests video today -
 * verified, not assumed - so this guard is what keeps the module's claim the
 * size of its evidence rather than a bet that stays correct by luck.
 */
export function requestsAudio(
  constraints: MediaStreamConstraints | undefined,
): boolean {
  if (constraints === undefined) return false;
  const audio = constraints.audio;
  return audio !== undefined && audio !== false && audio !== null;
}

export interface InstallOptions {
  readonly navigator?: MediaNavigator;
  readonly document?: PolicyDocument;
  /** Reports the surface. Defaults to stamping `<html data-microphone>`. */
  readonly report?: (surface: MicrophoneSurface) => void;
}

/**
 * Wraps `navigator.mediaDevices.getUserMedia` so a POLICY refusal is
 * distinguishable from a USER denial, and stamps what this surface is. Returns
 * the surface it measured.
 *
 * THE WRAPPER CALLS THE NATIVE API FIRST AND THE POLICY READING DOES NOT GATE
 * IT. The reading is consulted only to describe a refusal that has already
 * happened, never to pre-empt one - so a wrong reading cannot cost a working
 * surface its microphone. Rejecting early on `allowsFeature === false` looks
 * like a tightening and is the one change here that could break a surface that
 * works: it would hand a false negative the power to disable dictation outright,
 * where the worst this ordering can do is describe a real failure imprecisely.
 *
 * NOR DOES IT SUPPRESS ANYTHING. Only a rejection that is BOTH `NotAllowedError`
 * AND made against a document the policy refuses is re-described. A
 * `NotFoundError` (no microphone attached) and a genuine user denial on a
 * granted surface both propagate exactly as the browser threw them, because
 * "there is no microphone" and "the host page withheld it" are different facts
 * and only one of them is this module's to state.
 */
export function installMicrophonePolicy(
  options: InstallOptions,
): MicrophoneSurface {
  const nav: MediaNavigator = options.navigator ?? globalThis.navigator;
  // `Document` and `PolicyDocument` share no REQUIRED member - both policy
  // readers are optional, because Chromium and the spec disagree on the name -
  // so TypeScript's weak-type check rejects the assignment even though a real
  // document is precisely what this reads. The cast is at the ONE place a real
  // document enters the module.
  const doc: PolicyDocument =
    options.document ?? (globalThis.document as PolicyDocument);
  const report =
    options.report ??
    ((surface: MicrophoneSurface): void => {
      document.documentElement.dataset.microphone = surface;
    });

  const allowed = readMicrophonePolicy(doc);
  let devices: MediaDevicesLike | undefined;
  try {
    devices = nav.mediaDevices;
  } catch {
    devices = undefined;
  }

  /**
   * Stamped at INSTALL, before any dictation is attempted. An attribute that
   * waits for someone to press the mic button is absent for an unbounded
   * stretch, and absent reads identically to an old bundle, to a boot that
   * threw, and to this module never having been wired - which is how
   * `data-push` hid a defect two modules ago.
   */
  const installed: MicrophoneSurface =
    devices === undefined
      ? "no-api"
      : allowed === null
        ? "unmeasured"
        : allowed
          ? "granted"
          : "policy-blocked";
  report(installed);

  if (devices === undefined) {
    // A SMALLER CLAIM than the equivalent branch in `clipboard-fallback.ts`,
    // and stated as such. There the absence threw at unguarded call sites; here
    // the one call site is already inside a try/catch, so this changes a leaked
    // "Cannot read properties of undefined" into a sentence, and nothing else.
    const synthesized: MediaDevicesLike = {
      getUserMedia: () =>
        Promise.reject(
          new MicrophonePolicyError(
            "this browser exposes no microphone API here, which usually means " +
              "the page was not loaded over a secure connection.",
          ),
        ),
    };
    try {
      Object.defineProperty(nav, "mediaDevices", {
        value: synthesized,
        configurable: true,
      });
    } catch {
      // A navigator that refuses the definition leaves the app exactly as it
      // was, and the attribute already says `no-api`.
    }
    return installed;
  }

  const nativeGetUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = (
    constraints: MediaStreamConstraints | undefined,
  ): Promise<MediaStream> =>
    // `then(undefined, ...)` rather than `.catch()`: nothing here may run after
    // a SUCCESSFUL acquisition. A resolved stream is passed through untouched.
    nativeGetUserMedia(constraints).then(undefined, (cause: unknown) => {
      const isDenial =
        cause instanceof Error && cause.name === "NotAllowedError";
      // Re-read rather than closing over `allowed`: the delegated policy is a
      // property of the document, and this call may happen long after install.
      if (!isDenial || !requestsAudio(constraints)) throw cause;
      if (readMicrophonePolicy(doc) !== false) throw cause;
      throw new MicrophonePolicyError(POLICY_BLOCKED_MESSAGE);
    });

  return installed;
}
