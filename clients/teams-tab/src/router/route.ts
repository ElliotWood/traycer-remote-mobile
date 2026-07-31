/**
 * URL-backed routing for the tab.
 *
 * WHY NOT MOBILE'S `@/router/nav`, given the "extract, don't duplicate" rule:
 * that module is an in-memory stack whose own docblock says it exists because
 * "the phone client has exactly one drilldown and NO URL BAR to honour". The
 * tab's requirement is the opposite one. It needs real URLs because:
 *
 *   - the manifest points `contentUrl` at a path, and two entries collapsing
 *     onto one screen is exactly what happened while there was no router;
 *   - Teams deep links address a tab by URL;
 *   - browser back must move within the app rather than leaving it.
 *
 * So this is a different mechanism for a different requirement, not a second
 * copy of the same one. Sharing the reducer would mean sharing a route union
 * whose first member is called `fleet` and means epics — importing a
 * vocabulary collision we just finished removing.
 *
 * WHY NOT A ROUTER DEPENDENCY: the whole surface is two routes and a
 * drilldown. `history.pushState` plus a `popstate` listener is the entire
 * mechanism, and a router would bring a matcher, a nesting model and an
 * outlet system for a problem that has none of those.
 */

/** Everything the tab can be looking at. Discriminated for exhaustive rendering. */
export type Route =
  | { readonly name: "epics" }
  | { readonly name: "epic"; readonly epicId: string }
  /** Reserved for the notifications surface; parsed now so the URL is stable. */
  | { readonly name: "waiting" };

/**
 * The path prefix the tab is served under.
 *
 * MUST match the Vite `--base`. They are the same fact in two places, and a
 * mismatch is invisible in dev (where base is `/`) and fatal in production —
 * every route would parse as unknown and fall back to the list, so a deep
 * link would silently land on the wrong screen rather than failing loudly.
 */
export const BASE = "/tab";

/**
 * Parses a pathname into a route.
 *
 * Unknown paths resolve to `epics` rather than throwing or rendering a 404:
 * this is served under an SPA fallback, so an unmatched path is far more
 * likely to be a stale link than a mistake worth an error page. `/tab/fleet`
 * is the concrete case — the URL Elliot already has open, from before the
 * screen was renamed.
 */
export function parseRoute(pathname: string): Route {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const segments = rest.split("/").filter((s) => s.length > 0);

  if (segments[0] === "waiting") return { name: "waiting" };
  if (segments[0] === "epics" && typeof segments[1] === "string") {
    return { name: "epic", epicId: segments[1] };
  }
  return { name: "epics" };
}

export function routeToPath(route: Route): string {
  switch (route.name) {
    case "epic":
      return `${BASE}/epics/${route.epicId}`;
    case "waiting":
      return `${BASE}/waiting`;
    case "epics":
      return `${BASE}/epics`;
  }
}
