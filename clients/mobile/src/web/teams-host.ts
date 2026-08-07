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
 * ## Theme is read and NOT applied. That is a decision, not an omission.
 *
 * `getContext()` reports the host's theme, and it is tempting to push it into
 * the app. It is not done here because gui-app's theme is owned by
 * `lib/theme-applier.ts` off the persisted settings store: writing to that
 * store would overwrite the user's OWN explicit choice permanently, and
 * writing to the DOM directly would be reverted by the applier on its next
 * store change. The honest version - "Teams is the system signal when, and
 * only when, the user's preference is `system`" - needs a seam in the applier
 * that upstream does not currently expose.
 *
 * So the theme is recorded on the document element, where it is observable and
 * where CSS can pick it up later, and the colours are left alone.
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
  }>;
  notifySuccess(): Promise<unknown>;
  registerOnThemeChangeHandler(handler: (theme: string) => void): void;
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
}

const OUTSIDE_TEAMS: TeamsHostState = {
  inTeams: false,
  theme: null,
  hostClientType: null,
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
  let theme: string | null = null;
  let hostClientType: string | null = null;
  try {
    const context = await sdk.getContext();
    theme = context.app.theme ?? null;
    // Optional in the SDK's own types: an older host that omits it must yield
    // null rather than throw.
    hostClientType = context.app.host?.clientType ?? null;
  } catch {
    // Keep going. `notifySuccess()` below matters more than the context does.
  }

  if (theme !== null) options.onTheme?.(theme);

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

  return { inTeams: true, theme, hostClientType };
}

/**
 * Records the Teams state on the document element.
 *
 * Split from `initializeTeamsHost` so the handshake stays testable without a
 * DOM, and so the attributes have exactly one writer. These are the observable
 * a framed probe can assert on - "the tab believes it is in Teams" is
 * otherwise entirely invisible from outside.
 */
export function applyTeamsHostAttributes(
  state: TeamsHostState,
  root: Element,
): void {
  if (!state.inTeams) return;
  root.setAttribute("data-teams-host", state.hostClientType ?? "unknown");
  if (state.theme !== null) root.setAttribute("data-teams-theme", state.theme);
}

