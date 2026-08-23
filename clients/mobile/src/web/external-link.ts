/**
 * Opens a link that leaves this document, from OUR shell.
 *
 * ## Why this is a module and not one line of `window.open`
 *
 * One line of `window.open` is exactly what it was, in `capacitor-web-shim.ts`:
 *
 * ```ts
 * async open(options: { url: string }): Promise<void> {
 *   window.open(options.url, "_blank", "noopener,noreferrer");
 * }
 * ```
 *
 * Everything that leaves the app goes through there. gui-app's `MarkdownAnchor`
 * routes every `http(s):`/`mailto:` click to `runnerHost.openExternalLink`, and
 * so does device-code SIGN-IN - `auth-service.ts` opens
 * `verificationUriComplete` through the same method. So on the Teams tab this
 * one call is the app's only door out, and sign-in is behind it.
 *
 * ## MEASURED: that call cannot tell success from refusal. Neither could a fix.
 *
 * Chromium 1228, every open fired inside a real click. `pagesOpened` is counted
 * by the DRIVER from outside the page, via the browser context's own `page`
 * event, so it is not something the page under test can report about itself.
 *
 * | arm | shipped call returned | a page actually opened |
 * | --- | --- | --- |
 * | top level - **the control** | `null` | **yes** |
 * | cross-origin frame, Teams' own sandbox tokens | `null` | **yes** |
 * | cross-origin frame, no `allow-popups` - **negative control** | `null` | **NO** |
 *
 * All three read `null`, and one of them opened nothing. **Success and refusal
 * are the same observation**, so the shipped code is not merely failing to check
 * a return value - there is no return value to check.
 *
 * The reason is `noopener` itself, and the second control pins it: dropping
 * `noopener` returns an `object` on success and `null` on refusal, so the value
 * *would* discriminate - at the cost of handing the opened page a live
 * `window.opener` back into the app. **The obvious fix is worse than the bug**:
 * a `w === null` check on the shipped call reports "blocked" on every successful
 * open, on every surface, forever.
 *
 * ## So the answer is a different door, not a better check
 *
 * `@microsoft/teams-js` has `app.openLink(url)`, it is already in this bundle,
 * and the SDK is already initialized by `teams-host.ts`. Unlike `window.open` it
 * returns a promise that **rejects** - it goes through the SDK's
 * `sendAndHandleStatusAndReason`, so the Teams host's refusal comes back as a
 * rejection rather than as silence. That rejection is the only observable
 * failure signal available on this surface at all.
 *
 * ⚠️ **What this does NOT claim.** Nothing here measures the real Teams client.
 * The probe shows that a refusal is REACHABLE and that `window.open` cannot
 * report one; it does not show that Teams refuses - under Teams' own sandbox
 * token set a localhost parent permitted the popup. The case for `openLink` is
 * that it is Microsoft's API for this, it costs nothing extra, and it has a
 * failure path. It is not "popups are blocked in Teams", which is unmeasured.
 *
 * ## The outcome is externally readable at `<html data-external-open>`
 *
 * Same device, and the same reason, as `data-notifications`, `data-push` and
 * `data-storage-durable`: the negative states want different next actions and a
 * probe that can only see "did not open" cannot tell which one it is looking at.
 * `window-unverified` is deliberately not called `window` - it is the state this
 * whole module exists because of, and naming it after the thing it cannot
 * establish is how the next reader re-learns this the hard way.
 */

/** Kept here rather than inline so the test asserts on the shipped copy. */
export const EXTERNAL_LINK_NOTE_TEXT =
  "Teams would not open that link. If it did not open in your browser, copy it:";
export const EXTERNAL_LINK_NOTE_DISMISS = "Got it";
export const EXTERNAL_LINK_NOTE_TESTID = "external-link-blocked";

export type ExternalLinkOutcome =
  /** The Teams host took the link and did not refuse it. */
  | "teams"
  /** The Teams host REFUSED it. The one failure this surface can observe. */
  | "teams-refused"
  /**
   * Handed to `window.open`, which cannot say what became of it. NOT a success
   * reading - see the table in the docblock.
   */
  | "window-unverified"
  /** There was no way to open it at all: no `window.open`, or it threw. */
  | "unavailable";

/**
 * The Teams-native opener, registered by `main.tsx` once - and only once - the
 * SDK handshake has succeeded.
 *
 * Module-level because `Browser.open`'s signature is fixed by the Capacitor
 * alias in `vite.config.web.ts` and cannot take an injected dependency, and
 * because the opener becomes available strictly AFTER the app has rendered:
 * the handshake is a ~100KB dynamic import raced against 4s, deliberately not
 * on the critical path. A link clicked in the first moments of a Teams tab
 * therefore takes the `window.open` path, which is the correct degradation and
 * not a race worth closing - it is what the PWA does on every click.
 */
let teamsLinkOpener: ((url: string) => Promise<void>) | null = null;

/**
 * Registers (or with `null`, clears) the Teams-native opener.
 *
 * `null` is not only for tests: a handshake that never completes must leave the
 * window path in place rather than a half-registered one.
 */
export function setTeamsLinkOpener(
  opener: ((url: string) => Promise<void>) | null,
): void {
  teamsLinkOpener = opener;
}

export interface OpenExternalOptions {
  readonly url: string;
  /**
   * Defaults to the registered Teams opener. Injected so a test can hold the
   * surface fixed while varying whether Teams accepts - the only way to show
   * that one code path produces two different outcomes.
   */
  readonly teamsOpen?: ((url: string) => Promise<void>) | null | undefined;
  /**
   * Attempts a browser window. Returns whether the CALL WAS MADE - deliberately
   * not whether a window appeared, which is the thing this module has measured
   * to be unknowable. A name like `didOpen` here would be a lie with a boolean's
   * authority.
   */
  readonly attemptWindow?: ((url: string) => boolean) | undefined;
  /** Reports the outcome. Defaults to stamping `<html data-external-open>`. */
  readonly report?: ((outcome: ExternalLinkOutcome) => void) | undefined;
  /**
   * The element the note is inserted before. Defaults to the app's `#root`,
   * resolved at CALL time rather than boot time because this renders on a click
   * and `#root` is guaranteed present by then.
   */
  readonly container?: HTMLElement | null | undefined;
}

/**
 * Never rejects. A link that will not open is a degradation the user is told
 * about; letting it reject would put an unhandled rejection in the console of a
 * real Teams tab for something already handled.
 */
export async function openExternalUrl(
  options: OpenExternalOptions,
): Promise<ExternalLinkOutcome> {
  const report = options.report ?? defaultReport;
  const attemptWindow = options.attemptWindow ?? attemptWindowOpen;
  const teamsOpen =
    options.teamsOpen === undefined ? teamsLinkOpener : options.teamsOpen;

  if (teamsOpen !== null) {
    try {
      await teamsOpen(options.url);
      report("teams");
      return "teams";
    } catch {
      // The ONLY failure signal available on this surface. Everything below is
      // best-effort on top of a fact.
      report("teams-refused");
      // Tried anyway, and this is a considered choice rather than belt-and-
      // braces. `openLink` also rejects for reasons that are not a refusal to
      // open - an unexpected frame context, an older host - and in those the
      // browser path may still work. It costs one call and cannot make things
      // worse, because the note below is worded to be true whether or not it
      // succeeded. What it must NOT do is change the reported outcome: a fact
      // (Teams refused) must not be overwritten by a guess.
      attemptWindow(options.url);
      renderBlockedNote(resolveContainer(options.container), options.url);
      return "teams-refused";
    }
  }

  if (!attemptWindow(options.url)) {
    report("unavailable");
    return "unavailable";
  }
  report("window-unverified");
  return "window-unverified";
}

function defaultReport(outcome: ExternalLinkOutcome): void {
  document.documentElement.dataset.externalOpen = outcome;
}

function resolveContainer(
  supplied: HTMLElement | null | undefined,
): HTMLElement | null {
  if (supplied !== undefined && supplied !== null) return supplied;
  return document.getElementById("root");
}

/**
 * THE RETURN VALUE OF `window.open` IS DELIBERATELY DISCARDED, and this is the
 * single most likely line in this file to be "fixed" by a later reader.
 *
 * With `noopener` it is `null` on success as well as on refusal - measured, in
 * three arms, one of which opened nothing and one of which opened a page, both
 * reading `null`. Branching on it would report failure on every working open.
 * `noopener,noreferrer` stays: severing `window.opener` is the point, and the
 * alternative is handing an arbitrary agent-authored link a live handle back
 * into a signed-in app.
 *
 * `true` therefore means THE CALL WAS MADE - nothing more.
 */
export function attemptWindowOpen(url: string): boolean {
  const open: unknown = globalThis.window?.open;
  // Absent in jsdom and under server-side rendering; the DOM types claim
  // otherwise, so the type is what is optimistic here.
  if (typeof open !== "function") return false;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    // Some embedders throw rather than returning null.
    return false;
  }
}

/**
 * The note shown when the Teams host refused the link.
 *
 * It NAMES TEAMS, and that is legitimate here in a way it is not in
 * `notification-permission.ts` - which deliberately says "another app" because
 * it only knows it is cross-origin embedded. This branch is reachable only
 * through an opener registered after a SUCCESSFUL SDK handshake, so being in
 * Teams is established rather than guessed.
 *
 * IT SHOWS THE URL, and that is the whole point of it. A Teams personal tab has
 * no address bar and no back button, so a user whose sign-in link silently did
 * not open has no way to reach it and no way to know why. The one action that
 * helps is being able to read and copy the address.
 *
 * The copy is true whether or not the `window.open` fallback above worked -
 * which it has no way to find out. "If it did not open" is doing real work in
 * that sentence rather than hedging.
 *
 * A prior note is REMOVED rather than kept: it carries a URL, so a stale one
 * shows the wrong address, and the most recent failure is the one the user just
 * caused. That is the opposite of `renderBanner`'s keep-the-first rule next
 * door, where the banners are identical and re-rendering would flicker.
 */
export function renderBlockedNote(
  container: HTMLElement | null,
  url: string,
): HTMLElement | null {
  if (container === null) return null;

  const existing = document.querySelector(
    `[data-testid="${EXTERNAL_LINK_NOTE_TESTID}"]`,
  );
  if (existing !== null) existing.remove();

  const note = document.createElement("div");
  note.setAttribute("role", "status");
  note.dataset.testid = EXTERNAL_LINK_NOTE_TESTID;
  note.style.cssText =
    "display:flex;gap:12px;align-items:center;justify-content:center;" +
    "flex-wrap:wrap;padding:10px 14px;font:13px/1.45 system-ui,sans-serif;" +
    "background:#3a2a10;color:#f0d9a8;border-bottom:1px solid #6b4f1e";

  const label = document.createElement("span");
  label.textContent = EXTERNAL_LINK_NOTE_TEXT;

  // A `<code>` rather than an anchor, on purpose: an anchor here would be a
  // link offered as the remedy for a link that would not open, and clicking it
  // would take the same refused path. This is text to copy.
  const address = document.createElement("code");
  address.textContent = url;
  address.dataset.testid = `${EXTERNAL_LINK_NOTE_TESTID}-url`;
  address.style.cssText =
    "user-select:all;font:12px/1.4 ui-monospace,monospace;word-break:break-all;" +
    "padding:2px 6px;border-radius:4px;background:#00000033";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = EXTERNAL_LINK_NOTE_DISMISS;
  dismiss.style.cssText =
    "font:inherit;cursor:pointer;padding:4px 10px;border-radius:6px;" +
    "border:1px solid transparent;background:transparent;color:#d8b878";
  dismiss.addEventListener("click", () => {
    note.remove();
  });

  note.append(label, address, dismiss);
  container.before(note);
  return note;
}

/** Tests only. The module's registration state, reset between cases. */
export function resetTeamsLinkOpenerForTests(): void {
  teamsLinkOpener = null;
}
