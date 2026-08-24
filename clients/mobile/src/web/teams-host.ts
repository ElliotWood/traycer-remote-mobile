/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `vite.config.web.ts` and `host-store.ts`; same scope and same caveat.
 *
 * The Teams half of the shell: completes the Teams JS SDK handshake when this
 * bundle is running as a Teams personal tab, and does nothing at all when it
 * is not.
 *
 * ## Why this is the whole Teams shell
 *
 * Under `convergence-architecture` the Teams client IS this bundle - the same
 * `/next/` build the PWA serves - inside a Teams tab rather than a second
 * implementation of the UI. Two things had already been MEASURED about that
 * arrangement before this file existed:
 *
 *   - the surface can be FRAMED (no `X-Frame-Options`, no `frame-ancestors`,
 *     `#root` mounts, 0 stack overflows), and
 *   - device-code SIGN-IN completes identically framed and unframed, under
 *     Teams' own sandbox token set.
 *
 * So the residue was never rendering or auth. It was this: the SDK handshake.
 *
 * ## What the handshake actually buys, stated honestly
 *
 * A tab renders in Teams with no SDK at all - it is just an iframe. What
 * `initialize()` buys is that the app is a Teams app rather than a web page
 * Teams happens to be showing:
 *
 *   - `notifySuccess()` answers the host's load protocol. If the manifest ever
 *     sets `showLoadingIndicator`, a tab that never answers sits behind a
 *     spinner forever. Answering costs nothing and removes that whole failure
 *     mode in advance, rather than after someone flips the flag.
 *   - `getContext()` is the only way to learn WHICH Teams client this is.
 *     Deliberately recorded rather than acted on - see the note on theme below.
 *
 * Everything richer (SSO, deep links into a specific epic, activity-feed
 * notifications) builds on top of an initialized SDK, and none of it can be
 * built before this.
 *
 * ## The trap this file exists to avoid, which cost the retired tab a day
 *
 * `app.initialize()` does NOT reliably reject when Teams is absent. Standalone
 * it rejects promptly. Inside an IFRAME it postMessages its parent and waits -
 * and a parent that is not Teams simply never answers, so the promise neither
 * resolves nor rejects. The retired `clients/teams-tab` was verified doing
 * exactly that: standalone it rendered sign-in; framed under a non-Teams
 * parent it rendered an EMPTY DOCUMENT, no errors, forever.
 *
 * That is why the handshake is raced against a timeout, and why nothing here
 * gates first paint. See `INITIALIZE_TIMEOUT_MS`.
 *
 * ## Theme IS applied now - the seam this file said was missing was built
 *
 * This section used to read "theme is read and NOT applied, that is a decision"
 * and deferred it: gui-app's theme is owned by `lib/theme-applier.ts` off the
 * persisted settings store, so writing to that store would overwrite the user's
 * OWN explicit choice permanently, and writing to the DOM directly would be
 * reverted by the applier on its next store change. Both of those are still
 * true. What was wrong was the conclusion - that the honest version, *"Teams is
 * the system signal when, and only when, the user's preference is `system`"*,
 * "needs a seam in the applier that upstream does not currently expose."
 *
 * It needed a seam that did not exist YET, which is a different claim. The
 * applier already carried the exact mechanism the honest version describes: an
 * ambient light/dark signal (`prefers-color-scheme`), consulted only when the
 * user's preference is `system`, held in a module-level variable that the
 * media-query listener updates. `setHostThemeOverride(...)` is a second source
 * for that same signal, taking precedence over the OS while set. The user's
 * explicit light/dark choice is untouched in both directions.
 *
 * That override is the reason the OS signal is the wrong thing to rely on
 * inside a tab: `prefers-color-scheme` in a Teams frame reports the OS, and
 * Teams' own theme is set independently of it. A user running dark Teams on a
 * light OS got a light Traycer tab in a dark client.
 *
 * The theme is still ALSO recorded on the document element - it is what a
 * framed probe can assert on from outside, and `applyTeamsHostAttributes` is
 * the only writer of it.
 */

/**
 * The slice of `@microsoft/teams-js`'s `app` namespace this shell uses.
 *
 * Declared structurally rather than imported as a type so the tests can supply
 * a fake without the real SDK, and so the dynamic import below stays the only
 * reference to the package. A test that imported the real module would be
 * testing Microsoft's postMessage client, which is not what is in doubt here.
 */
export interface TeamsAppSdk {
  initialize(): Promise<void>;
  getContext(): Promise<{
    readonly app: {
      readonly theme?: string;
      readonly host?: { readonly clientType?: string };
    };
    /**
     * Optional in the SDK's own types (`app.d.ts`, `PageInfo.subPageId`), and
     * absent on every load that was not opened by a deep link - which is most
     * of them.
     */
    readonly page?: { readonly subPageId?: string };
  }>;
  notifySuccess(): Promise<unknown>;
  registerOnThemeChangeHandler(handler: (theme: string) => void): void;
  /**
   * Teams' own "open this URL" call, and the reason it is worth reaching for is
   * that it REJECTS. It resolves through the SDK's
   * `sendAndHandleStatusAndReason`, so a host refusal comes back as a rejection
   * - whereas `window.open(url, "_blank", "noopener,noreferrer")` returns
   * `null` on success and on refusal alike (measured; see `external-link.ts`).
   * This is the only observable failure signal a Teams tab has for a link.
   */
  openLink(url: string): Promise<void>;
}

export interface TeamsHostState {
  /** `false` in a plain browser, and `false` is the normal case. */
  readonly inTeams: boolean;
  /**
   * `"default"` | `"dark"` | `"contrast"` | `"glass"`, or null outside Teams.
   * Recorded, not applied - see the theme note above.
   */
  readonly theme: string | null;
  /**
   * `"desktop"` | `"web"` | `"android"` | `"ios"`, or null.
   *
   * Needed because a viewport width means nothing without knowing which client
   * produced it: 390px is a phone, and 390px is also a narrow desktop Teams
   * window, and only one of those should get the phone layout.
   */
  readonly hostClientType: string | null;
  /**
   * The route a Teams deep link asked for, or null on an ordinary open.
   *
   * `context.page.subPageId` is the ONLY field in a Teams entity deep link
   * that can say which page to open. It was read by nothing until
   * `teams-deep-link.ts`, so a card could address this tab and not tell it
   * where to go - the tab opened on its landing screen, silently. Reported in
   * the state as well as through `onDeepLink` because a state a probe can
   * assert on is how the other Teams signals here are checked from outside.
   */
  readonly subPageId: string | null;
}

const OUTSIDE_TEAMS: TeamsHostState = {
  inTeams: false,
  theme: null,
  hostClientType: null,
  subPageId: null,
};

/**
 * How long to wait for the host to answer before concluding it is not Teams.
 *
 * 4s is generous for a postMessage handshake to a parent that IS listening,
 * and short enough that nothing downstream waits on a dead promise. Nothing
 * user-visible is gated on it either way - the app has already painted.
 */
const INITIALIZE_TIMEOUT_MS = 4000;

export interface TeamsHostOptions {
  /**
   * Whether this document is framed. A Teams tab is ALWAYS a child frame, so
   * this is a cheap necessary condition that keeps the ~100KB SDK off the
   * critical path of the overwhelmingly common case: the PWA, opened normally.
   *
   * A false positive (framed by something that is not Teams) costs one dynamic
   * import and one 4s timeout that no one is waiting on. A false NEGATIVE
   * would be the real bug, which is why the test is "is there a parent" and
   * not any attempt to sniff Teams itself.
   */
  readonly isFramed?: () => boolean;
  /** Injected in tests. Defaults to a dynamic import of `@microsoft/teams-js`. */
  readonly loadSdk?: () => Promise<TeamsAppSdk>;
  readonly timeoutMs?: number;
  /**
   * Called once on the initial context, and again on every host theme change.
   * Injected so the caller decides what a theme MEANS; this module only
   * reports it.
   */
  readonly onTheme?: (theme: string) => void;
  /**
   * Called ONCE, with the `subPageId` of the deep link that opened this tab,
   * and not at all on an ordinary open.
   *
   * Injected for the same reason as `onTheme`: this module reports what Teams
   * said and the caller decides what it means. Navigating from in here would
   * put a `window.location` write inside the handshake, where it could not be
   * tested without a DOM and where a failure would look like a failed
   * handshake.
   *
   * There is deliberately no change handler to pair with it. Teams re-delivers
   * the context on a fresh load rather than pushing page changes the way it
   * pushes themes, so a registration here would be a listener for an event
   * that does not arrive - a documented option with no producer, which is the
   * shape this file already had to fix once.
   */
  readonly onDeepLink?: (subPageId: string) => void;
  /**
   * Hands the caller a link opener bound to this SDK instance, and is called
   * ONLY after the host has answered `initialize()`.
   *
   * Injected for the same reason as `onTheme` and `onDeepLink`: this module
   * reports what Teams offers and the caller decides what to do with it. The
   * gating is the load-bearing part rather than a detail - an opener handed
   * over before the handshake succeeds would route a plain browser's links into
   * an SDK that has no host to talk to, turning every working link on the PWA
   * into a rejection. That is a wider blast radius than the defect it fixes,
   * so `MUT-7` exists to hold it.
   */
  readonly onLinkOpener?: (open: (url: string) => Promise<void>) => void;
}

async function loadTeamsSdk(): Promise<TeamsAppSdk> {
  const { app } = await import("@microsoft/teams-js");
  return app;
}

/**
 * Completes the Teams handshake if there is a Teams host to complete it with.
 *
 * NEVER REJECTS and never hangs: every failure path resolves to
 * `{ inTeams: false }`, because "this is not a Teams tab" is the normal
 * outcome and is not an error. Callers should treat the returned state as
 * information, not as a gate.
 */
export async function initializeTeamsHost(
  options: TeamsHostOptions,
): Promise<TeamsHostState> {
  const isFramed =
    options.isFramed ??
    ((): boolean => {
      // Cross-origin `window.parent` comparison is same-origin-policy safe -
      // identity is readable where properties are not - but a hostile or
      // exotic embedder is not worth crashing boot over.
      try {
        return globalThis.window !== globalThis.window.parent;
      } catch {
        return true;
      }
    });

  if (!isFramed()) return OUTSIDE_TEAMS;

  const loadSdk = options.loadSdk ?? loadTeamsSdk;
  const timeoutMs = options.timeoutMs ?? INITIALIZE_TIMEOUT_MS;

  let sdk: TeamsAppSdk;
  try {
    sdk = await loadSdk();
  } catch {
    // A chunk that fails to load must not take the app with it.
    return OUTSIDE_TEAMS;
  }

  const timedOut = Symbol("teams-initialize-timeout");

  // `.catch()` on the initialize promise ITSELF, not only on the race: once
  // the timeout wins, the race is settled, and a later rejection from a
  // promise with no handler is an unhandled-rejection warning in the console
  // of a real Teams tab - exactly the noise that hides a real error later.
  const handshake = sdk
    .initialize()
    .then(() => "ok" as const)
    .catch(() => "failed" as const);

  // `window.setTimeout`, not the bare global: `@types/node` is in this
  // package's devDependencies, so the bare `setTimeout` resolves to Node's
  // overload and yields a `Timeout` object. The DOM one returns a `number`,
  // which is the truth in every environment this module actually runs in.
  let timer: number | undefined;
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = window.setTimeout(() => {
      resolve(timedOut);
    }, timeoutMs);
  });

  const outcome = await Promise.race([handshake, timeout]);
  // Frees the timer on the winning path so a test - or a long-lived tab -
  // is not held awake by a pending 4s callback that can no longer matter.
  if (timer !== undefined) window.clearTimeout(timer);

  if (outcome !== "ok") return OUTSIDE_TEAMS;

  // Past this line we KNOW we are in Teams: the host answered. Anything that
  // fails from here is a degraded Teams session, not a plain browser, and
  // reporting it as `inTeams: false` would be a lie that the layout would act
  // on.

  // FIRST, and before `getContext()`, because the context read is allowed to
  // fail (the `catch` below keeps going) and a degraded Teams session still has
  // a working host to open links through. Registering after it would make the
  // app's only door out depend on a call this file already treats as optional.
  options.onLinkOpener?.((url: string) => sdk.openLink(url));

  let theme: string | null = null;
  let hostClientType: string | null = null;
  let subPageId: string | null = null;
  try {
    const context = await sdk.getContext();
    theme = context.app.theme ?? null;
    // Optional in the SDK's own types: an older host that omits it must yield
    // null rather than throw.
    hostClientType = context.app.host?.clientType ?? null;
    // Absent on every open that is not a deep link, which is most of them.
    // An empty string is the same non-answer as an absent field and must not
    // reach the caller as a route.
    const page = context.page?.subPageId ?? "";
    subPageId = page === "" ? null : page;
  } catch {
    // Keep going. `notifySuccess()` below matters more than the context does.
  }

  if (theme !== null) options.onTheme?.(theme);
  // BEFORE `notifySuccess()`, and the ordering is the reviewable choice here.
  // Applying a deep link can RELOAD this document, and a document about to be
  // discarded should not first report itself ready: if the manifest ever sets
  // `showLoadingIndicator`, the honest state during that moment is still
  // loading, and the boot that follows answers the protocol exactly as an
  // ordinary open does. Every path that does NOT reload - no deep link, an
  // unusable one, or one we are already at - falls through to the ack below,
  // so this cannot cost an acknowledgement that would otherwise be sent.
  if (subPageId !== null) options.onDeepLink?.(subPageId);

  try {
    // Teams pushes theme changes rather than expecting a poll; without this a
    // tab keeps whatever theme it started with when the user switches.
    sdk.registerOnThemeChangeHandler((next) => {
      options.onTheme?.(next);
    });
  } catch {
    // Not worth failing the handshake over.
  }

  try {
    await sdk.notifySuccess();
  } catch {
    // A rejected `notifySuccess` does NOT retract the handshake. The host
    // answered `initialize`; that is what `inTeams` reports, and downgrading
    // it here would make the layout disagree with reality over a load-protocol
    // acknowledgement.
  }

  return { inTeams: true, theme, hostClientType, subPageId };
}

/**
 * Records the Teams state on the document element.
 *
 * Split from `initializeTeamsHost` so the handshake stays testable without a
 * DOM, and so the attributes have exactly one writer. These are the observable
 * a framed probe can assert on - "the tab believes it is in Teams" is
 * otherwise entirely invisible from outside.
 */
/**
 * Decodes a Teams theme name into the light/dark signal the app understands.
 *
 * Teams ships `"default"`, `"dark"`, `"contrast"` and (in the new client)
 * `"glass"`. Only two of those are a light/dark question:
 *
 * - `contrast` is Teams' high-contrast theme, which is BLACK-backed. Mapping
 *   it to `light` would put a light app inside a black client, so it resolves
 *   dark. That is the closest honest answer and not a claim to support
 *   high-contrast properly - a real high-contrast theme is a preset, not a
 *   light/dark mode, and this app has no such preset to select.
 * - anything else, INCLUDING an unrecognised name from a future client,
 *   resolves `light`. `default` and `glass` are both light surfaces, and an
 *   unknown name is far more likely to be another light variant than a dark
 *   one - guessing dark would black out a tab in a light client.
 *
 * Pure and exported so the mapping is testable without a Teams host; deciding
 * what a theme MEANS is the caller's job, which is why this is not wired into
 * `initializeTeamsHost` itself.
 */
export function teamsThemeToResolved(theme: string): "light" | "dark" {
  return theme === "dark" || theme === "contrast" ? "dark" : "light";
}

export function applyTeamsHostAttributes(
  state: TeamsHostState,
  root: Element,
): void {
  if (!state.inTeams) return;
  root.setAttribute("data-teams-host", state.hostClientType ?? "unknown");
  if (state.theme !== null) root.setAttribute("data-teams-theme", state.theme);
}
