/**
 * Is this document a CROSS-ORIGIN frame?
 *
 * BROWSER-PROOF BUILD ONLY - sibling of `teams-host.ts`, same scope.
 *
 * ## Why this is not `window !== window.parent`
 *
 * `teams-host.ts` asks "am I framed", which is the right question there: a
 * Teams tab is always a child frame, and that test is a cheap necessary
 * condition for loading the SDK. It is the WRONG question for a permission,
 * and the difference was measured rather than reasoned about.
 *
 * Three arms, one variable, Chromium 1228, notifications GRANTED to the app's
 * origin in every arm:
 *
 * | arm                  | `window !== window.parent` | `Notification.permission` |
 * | -------------------- | -------------------------- | ------------------------- |
 * | top level            | false                      | `granted`                 |
 * | same-origin iframe   | **true**                   | **`granted`**             |
 * | cross-origin iframe  | true                       | **`denied`**              |
 *
 * The same-origin arm is the control, and it is the whole reason this module
 * exists: it is framed and it is granted. **Being framed is not what takes the
 * permission away - being cross-origin is.** A shell that used the framing test
 * to explain a denial would blame the wrong thing in the one case where it is
 * wrong, and be untestable against the case where it is right.
 *
 * ## The mechanism, also measured rather than assumed
 *
 * Reading a cross-origin parent's `location.origin` throws `SecurityError`;
 * same-origin and top-level both return a string. That is what this returns,
 * and the probe that established it checked all three arms, not just the one
 * the fix needed.
 *
 * Every failure to read resolves to `true`. That direction is deliberate: the
 * consequence of a false `true` is a notification offer withheld from a surface
 * that might have honoured it, and the consequence of a false `false` is the
 * user being told they refused something they were never asked about.
 */

/** The narrowest shape this module uses, so a test can build one honestly. */
export interface FrameWindow {
  readonly parent: FrameWindow;
  readonly location: { readonly origin: string };
}

/**
 * The real window, or null where there is none (Node, SSR).
 *
 * Split out so `isCrossOriginFramed` takes a REQUIRED argument: an optional
 * parameter is banned by this repo's lint rules, and threading the default
 * through the call site is what makes the environment lookup a thing a test can
 * stand in for rather than something to work around.
 */
export function currentWindow(): FrameWindow | null {
  const scope: { readonly window?: FrameWindow } = globalThis;
  return scope.window ?? null;
}

export function isCrossOriginFramed(win: FrameWindow | null): boolean {
  const self = win;
  if (self === null) return false;

  let parent: FrameWindow;
  try {
    parent = self.parent;
  } catch {
    // A hostile or exotic embedder. Treated as cross-origin per the note above.
    return true;
  }

  // Identity comparison is same-origin-policy safe even where properties are
  // not, and top level is the overwhelmingly common case: answer it first and
  // never touch `location`.
  if (parent === self) return false;

  try {
    // Throws `SecurityError` iff the parent is a different origin - MEASURED,
    // in all three arms, not inferred from the same-origin policy's wording.
    const origin = parent.location.origin;
    return typeof origin !== "string";
  } catch {
    return true;
  }
}
