/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `teams-host.ts` and `teams-theme-param.ts`; same scope and same caveat.
 *
 * Applies the route a Teams deep link asked for.
 *
 * ## The channel, and why it is the only one
 *
 * A card in Teams cannot address this app with an ordinary `https://` URL
 * without leaving Teams - `Action.OpenUrl` opens it outside the tab, in a
 * top-level context at our origin, where the tab's partitioned device-auth
 * tokens do not exist. The Teams-native form addresses the installed app:
 *
 *     https://teams.microsoft.com/l/entity/<appId>/<entityId>
 *       ?webUrl=<the ordinary link>
 *       &context={"subEntityId":"<route>"}
 *
 * `subEntityId` is the ONLY field in that envelope that can say WHICH page,
 * and it arrives here as `app.getContext().page.subPageId`. Before this file,
 * nothing in either client read it - so an entity link would have opened the
 * app's landing page, inside Teams, silently. `clients/teams-bot` builds the
 * producing half and its `TRAYCER_TEAMS_APP_ID` is deliberately unset until
 * this half is deployed.
 *
 * ## Why this reloads instead of navigating, which looks like the lazy answer
 *
 * It is the opposite. `location.hash = route` is the obvious move and it would
 * have been a DEAD LINK that changes the URL bar - measured, not assumed:
 *
 *     @tanstack/history@1.162.0, dist/esm/index.js
 *     addEventListener(popStateEvent, onPushPopEvent)   <- the ONLY one
 *     addEventListener(beforeUnloadEvent, ...)
 *
 * There is no `hashchange` listener in the package at all. A programmatic hash
 * assignment fires `hashchange` and NOT `popstate`, so the router would never
 * re-read the location: the address updates, the view does not, and nothing
 * anywhere reports it. That is this epic's most-repeated bug shape - "the
 * button did nothing" - reached through the one line that looks obviously
 * correct.
 *
 * Setting the fragment and reloading takes the path a genuine cold deep-link
 * open already takes: the router reads the URL when it is constructed. It
 * costs one extra boot per deep-linked open and uses no knowledge of the
 * router's internals, which is what makes it the safe default for a surface
 * nobody can click unattended.
 *
 * A cheaper option exists and is NOT taken here: set the fragment and dispatch
 * a synthetic `popstate`, which the listener above would answer. It is
 * plausible and it is unverified - it depends on a third-party listener's
 * behaviour rather than on the browser's own load path - so it is recorded for
 * someone who can watch a real tab, not shipped by an unattended run.
 *
 * ## The reload guard is load-bearing, not a micro-optimisation
 *
 * Teams hands the context to EVERY load of the tab, including the one this
 * reload causes. Without the "am I already there" comparison the second boot
 * would find the same `subPageId`, reload again, and the tab would spin
 * forever. The guard is the thing that terminates it.
 */

/**
 * The route in a `subPageId`, or `null` when there is nothing usable in it.
 *
 * ## Structural validation, deliberately not an allow-list
 *
 * `readTeamsThemeParam` next door validates against a CLOSED list of four
 * names, and the difference is worth stating so neither is "corrected" toward
 * the other. A theme has four possible values and an unrecognised one is
 * almost certainly a placeholder that was never substituted. A route space is
 * not enumerable - the producer is the side that knows which routes exist, and
 * pinning a list here would silently drop every deep link to a route added
 * later, which is a worse failure than the one it would prevent.
 *
 * So the checks are the structural ones, each answering a way this string
 * could stop being a route in THIS document:
 *
 * - must be an absolute in-app path, so a relative one cannot resolve against
 *   whatever the current route happens to be
 * - `//` is rejected because a protocol-relative URL names another ORIGIN
 * - a `#` would nest a fragment inside a fragment, and the router reads the
 *   first one
 * - anything at or below `0x20`, plus `0x7f`, cannot appear in a real route
 *   and is the shape a mangled or truncated value arrives in
 *
 * That last check is a character-code loop rather than a regex on purpose.
 * The escape-heavy class it replaces was written twice and wrong twice, once
 * leaving two RAW control bytes in this file - which tsc and the whole suite
 * accept while `grep` starts calling the file binary.
 */
export function readTeamsDeepLinkRoute(
  subPageId: string | null | undefined,
): string | null {
  if (typeof subPageId !== "string") return null;
  const route = subPageId.trim();
  if (route === "") return null;
  if (!route.startsWith("/")) return null;
  if (route.startsWith("//")) return null;
  if (route.includes("#")) return null;
  for (let index = 0; index < route.length; index += 1) {
    const code = route.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return route;
}

/**
 * The window operations this needs, named so a test can supply them.
 *
 * `isSubpath` mirrors gui-app's own `isSubpathDeploy()` - "any vite base but
 * `/`" - which is the same rule `clients/teams-bot`'s link builder mirrors on
 * the producing side. Three sites now agree about it, which is a liability
 * worth naming: it decides hash history versus browser history, and the two
 * halves of one button disagreeing about that is precisely how this link
 * shipped dead once already.
 */
export interface DeepLinkWindow {
  readonly isSubpath: boolean;
  /** `window.location.hash`, leading `#` included, `""` when absent. */
  readonly currentHash: string;
  setHash(route: string): void;
  reload(): void;
  assign(route: string): void;
}

export type DeepLinkOutcome = "applied" | "already-there" | "ignored";

/**
 * Navigates to a deep-linked route.
 *
 * `"already-there"` is a success, not a refusal - see the reload-guard note
 * above. It is a distinct value rather than a silent early return because the
 * caller must be able to tell it from `"ignored"`, which means the route was
 * unusable. Collapsing the two into one silence is how a check stops being
 * able to see a defect.
 */
export function applyTeamsDeepLink(
  subPageId: string | null | undefined,
  target: DeepLinkWindow,
): DeepLinkOutcome {
  const route = readTeamsDeepLinkRoute(subPageId);
  if (route === null) return "ignored";

  if (!target.isSubpath) {
    // Browser history: the route IS a path, so an ordinary navigation loads
    // the app at it. No fragment is involved and no guard is needed - and this
    // branch is not reached by a Teams tab, which is always a subpath deploy.
    target.assign(route);
    return "applied";
  }

  if (target.currentHash.replace(/^#/, "") === route) return "already-there";

  target.setHash(route);
  target.reload();
  return "applied";
}

/**
 * The real window, bound at the call site in `main.tsx`.
 *
 * Separate from the logic above so the decision is testable without a DOM and
 * so the DOM access has exactly one writer.
 */
export function browserDeepLinkWindow(baseUrl: string): DeepLinkWindow {
  return {
    isSubpath: baseUrl.replace(/\/+$/, "") !== "",
    get currentHash() {
      return window.location.hash;
    },
    setHash: (route) => {
      window.location.hash = route;
    },
    reload: () => {
      window.location.reload();
    },
    assign: (route) => {
      window.location.assign(route);
    },
  };
}
