/**
 * Makes "copy" work on the Teams tab, where the async Clipboard API is refused.
 *
 * `clipboard-write` is a PERMISSIONS-POLICY-gated feature whose default
 * allowlist is `self`. A cross-origin frame is therefore refused it unless the
 * parent delegates with `allow="clipboard-write"`, and the refusal arrives as a
 * rejected promise from `navigator.clipboard.writeText` - the same delegation
 * shape `screen-wake-lock.ts` turned out to have.
 *
 * WHY THIS IS A SHELL MODULE AND NOT A SET OF EDITS. gui-app calls
 * `navigator.clipboard.writeText` directly NINE times across EIGHT files and
 * routes none of them through a platform seam: `use-clipboard-copy.ts`,
 * `composer-clipboard.ts` (twice), `host-doctor-actions.ts`,
 * `notification-hooks-section.tsx`, both mermaid blocks, both wireframe blocks.
 *
 * COUNTED, because the first count taken here was a grep for the word and it
 * was wrong in both directions. One of those eight files is the shared hook,
 * and EIGHTEEN components use it - copying a chat message, a code block, a plan
 * segment, a worktree path, an approval field. So the surface is not eight
 * buttons. Every copy button in the app was dead on the Teams tab.
 *
 * Under convergence the UI is upstream's and the shell adapts the platform
 * beneath it, so the repair belongs at the platform object all of them reach
 * for. Editing the call sites would be eight divergences to carry across every
 * future merge, to fix one property of one surface.
 *
 * FOUR of the eight files pass no rejection handler at all - both mermaid
 * blocks and both wireframe blocks `void` a single-argument `.then()` - so
 * there the copy fails, no toast appears, and the promise rejection is
 * unhandled. The others report an error correctly, which on this surface means
 * correctly reporting that copy does not work.
 *
 * MEASURED, not reasoned. `scratch/teams-shell-probe/clipboard.mjs`, headful
 * Chromium 1228, every write inside a real click, and what reached the SYSTEM
 * clipboard read back from a separate browser context that the arm cannot
 * reach:
 *
 *   arm                   allowsFeature   writeText                 landed
 *   top (control)         true            resolved                  YES
 *   same-origin frame     true            resolved                  YES
 *   cross-origin frame    FALSE           rejected NotAllowedError  NO
 *   the same + allow=     true            resolved                  YES
 *
 * The same-origin arm carries Teams' own sandbox tokens, so the finding is
 * about CROSS-ORIGIN DELEGATION and not about being in a frame. The fourth arm
 * makes it the parent's to grant. Each arm was seeded with a distinct sentinel
 * first, so the refused arm reads back the SEED rather than an empty string - a
 * write that did nothing is proven to have done nothing.
 *
 * AND THERE IS A FALLBACK, measured in the same run rather than assumed:
 * `document.execCommand("copy")` over a hidden textarea landed the text in
 * EVERY arm, the refused one included. It is gated on user activation, not on
 * the permissions policy. Its success at top level is what makes its success in
 * the frame mean something - a fallback that worked nowhere would have been
 * indistinguishable from one blocked by the same policy.
 *
 * THE ATTRIBUTE ANSWERS A QUESTION THIS PROBE CANNOT. The arms above use Teams'
 * sandbox tokens with NO `allow` attribute, which is a guess about Teams. What
 * Teams actually sends is unreadable without a real install - but the document
 * can read the delegated policy about ITSELF from inside the frame, so
 * `<html data-clipboard>` reports it on the real deployment. `granted` there
 * means Teams delegates `clipboard-write`; `policy-blocked` means it does not
 * and this module is the only reason copy works at all.
 */

export type ClipboardSurface =
  /** Permissions policy grants this document `clipboard-write`. */
  | "granted"
  /** It does not. Every native write on this surface will reject. */
  | "policy-blocked"
  /**
   * No permissions-policy API to read - Firefox, Safari, jsdom. NOT a synonym
   * for `policy-blocked`: one is a measurement and one is its absence, and
   * collapsing them is the mistake `screen-wake-lock.ts` was rewritten to undo.
   */
  | "unmeasured"
  /** `navigator.clipboard` itself is absent - an insecure context. */
  | "no-api"
  /** The fallback ran and the text reached the clipboard. */
  | "fallback-copied"
  /** The fallback ran and could not copy either. */
  | "fallback-failed";

/** The one member of `Clipboard` this module wraps. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export interface ClipboardNavigator {
  clipboard?: ClipboardWriter;
}

export interface PolicyDocument {
  readonly featurePolicy?: { allowsFeature(feature: string): boolean };
  readonly permissionsPolicy?: { allowsFeature(feature: string): boolean };
}

/**
 * Reads what the document is allowed to do, from inside the document.
 *
 * Returns `null` where there is no API to ask, rather than a boolean. A
 * `false` would say "measured, and refused" about a browser that was never
 * asked, and this module's whole value is that the two are told apart on the
 * real install.
 */
export function readClipboardWritePolicy(doc: PolicyDocument): boolean | null {
  const policy = doc.featurePolicy ?? doc.permissionsPolicy;
  if (policy === undefined) return null;
  try {
    return policy.allowsFeature("clipboard-write");
  } catch {
    return null;
  }
}

/**
 * The fallback, written the ordinary way.
 *
 * The textarea is `readonly` and parked off-screen: `display:none` and
 * `visibility:hidden` are not selectable, so neither can be copied from, and a
 * visible one flashes. `select()` alone is unreliable on iOS, hence the
 * explicit range.
 *
 * NOT restoring the user's prior selection is deliberate and is the one cost of
 * this path: on the surface where it runs, the alternative is that copy does
 * nothing at all.
 */
export function execCommandCopy(doc: Document, text: string): boolean {
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export interface InstallOptions {
  readonly navigator?: ClipboardNavigator;
  readonly document?: PolicyDocument;
  /** The fallback writer. Injected in tests; defaults to {@link execCommandCopy}. */
  readonly copy?: (text: string) => boolean;
  /** Reports the surface. Defaults to stamping `<html data-clipboard>`. */
  readonly report?: (surface: ClipboardSurface) => void;
}

/**
 * Wraps `navigator.clipboard.writeText` so a refused write falls back, and
 * stamps what this surface is. Returns the surface it measured.
 *
 * THE WRAPPER IS INSTALLED UNCONDITIONALLY, and the policy reading does not
 * gate it. That split is the point: the wrapper tries the native call FIRST and
 * only reaches the fallback on a rejection, so on a granted surface it is inert
 * and there is nothing for a wrong policy reading to break. Branching the
 * behaviour on the reading instead would put a browser-specific API in the path
 * of every copy in the app, to save one rejected microtask on a surface where
 * copy was measured to be broken anyway.
 *
 * The original rejection is what propagates when the fallback also fails, not a
 * new error. `use-clipboard-copy.ts` logs it, and `NotAllowedError` from the
 * real API is more use to whoever reads that log than anything invented here.
 */
export function installClipboardFallback(
  options: InstallOptions,
): ClipboardSurface {
  const nav: ClipboardNavigator = options.navigator ?? globalThis.navigator;
  // `Document` and `PolicyDocument` share no REQUIRED member - both policy
  // readers are optional, because Chromium and the spec disagree on the name -
  // so TypeScript's weak-type check rejects the assignment even though a real
  // document is precisely what this reads. The cast is at the ONE place a real
  // document enters the module; every other path is typed.
  const doc: PolicyDocument =
    options.document ?? (globalThis.document as PolicyDocument);
  const report =
    options.report ??
    ((surface: ClipboardSurface): void => {
      document.documentElement.dataset.clipboard = surface;
    });
  const copy =
    options.copy ??
    ((text: string) => execCommandCopy(globalThis.document, text));

  const allowed = readClipboardWritePolicy(doc);
  // Reading the PROPERTY is what throws in some contexts, not calling a method
  // on it - the lesson `safe-storage.ts` records about `localStorage`. So this
  // read happens once, here, rather than at each call site.
  let native: ClipboardWriter | undefined;
  try {
    native = nav.clipboard;
  } catch {
    native = undefined;
  }

  /**
   * Stamped at INSTALL, before any copy is attempted. An attribute that only
   * appears once someone presses a copy button is absent for an unbounded
   * stretch on a quiet session, and absent reads identically to an old bundle,
   * to a boot that threw, and to this module never having been wired - which is
   * exactly how `data-push` hid a defect one module over.
   */
  const installed: ClipboardSurface =
    native === undefined
      ? "no-api"
      : allowed === null
        ? "unmeasured"
        : allowed
          ? "granted"
          : "policy-blocked";
  report(installed);

  const fallbackWrite = (text: string, cause: unknown): Promise<void> => {
    if (copy(text)) {
      report("fallback-copied");
      return Promise.resolve();
    }
    report("fallback-failed");
    return Promise.reject(cause);
  };

  if (native === undefined) {
    // Nothing to wrap. Synthesizing the object rather than leaving it absent is
    // what makes an insecure context degrade instead of throwing: gui-app reads
    // `navigator.clipboard.writeText` without a guard, so the ABSENCE throws
    // synchronously at the call site - which `use-clipboard-copy.ts:57` names
    // in a comment and catches, and the other eight calls do not.
    const synthesized: ClipboardWriter = {
      writeText: (text: string) =>
        fallbackWrite(
          text,
          new Error("navigator.clipboard is unavailable in this context"),
        ),
    };
    try {
      Object.defineProperty(nav, "clipboard", {
        value: synthesized,
        configurable: true,
      });
    } catch {
      // A navigator that refuses the definition leaves the app exactly as it
      // was. Reported rather than swallowed, so the attribute does not claim a
      // fallback that is not there.
      report("no-api");
    }
    return installed;
  }

  const nativeWriteText = native.writeText.bind(native);
  native.writeText = (text: string): Promise<void> =>
    // `then(undefined, ...)` rather than `.catch()`: a fallback that ran after
    // a SUCCESSFUL native write would copy twice and, worse, report
    // `fallback-copied` on a surface that never needed the fallback.
    nativeWriteText(text).then(undefined, (cause: unknown) =>
      fallbackWrite(text, cause),
    );

  return installed;
}
