/**
 * The "watch progress" link, into the tab's chat route.
 *
 * ## What this used to build, and why every link it produced was dead
 *
 * It built `${BASE}/epics/${epicId}/chats/${chatId}`, MIRRORING
 * `clients/teams-tab/src/router/route.ts`. That tab was deleted in `cb1edae3`;
 * the tab now served is upstream's `gui-app` at `/next/`, and its route tree
 * has exactly one epic route:
 *
 *     /epics/$epicId/$tabId
 *
 * `clients/gui-app/src/lib/routes.ts` matches it with
 * `/^\/epics\/([^/]+)\/([^/]+)\/?$/` — EXACTLY TWO SEGMENTS. The old link had
 * three, so it did not merely miss the chat: `routedTabTarget` returned `null`
 * and the navigation controller issued a LANDING CORRECTION. The user pressed
 * "Watch progress" and arrived at the app's landing page, with no error
 * anywhere. That is the liability the old docblock here warned about, realised.
 *
 * It was also broken a SECOND, independent way, which the deploy note that
 * disabled this feature did not find. `/next/` is a SUBPATH deploy, and
 * `clients/gui-app/src/router.tsx` switches to HASH history whenever the vite
 * base is not `/` — so the route lives in the fragment. A path-shaped link
 * cannot address a route in a hash-history app at all, whatever its shape.
 * Fixing only the segments would have produced a link that still went nowhere.
 *
 * ## What this builds now, and why each part of it
 *
 *     ${BASE}/#/epics/${epicId}/${epicId}?focusArtifactId=${chatId}
 *
 * - **`#`, but only for a subpath base.** Same rule as the app's own
 *   `isSubpathDeploy()`: a base URL whose path is not `/` is a subpath deploy
 *   and therefore hash history. A root-served tab keeps browser history and
 *   gets a plain path. The operator configures one origin; the mode follows
 *   from it, so the two cannot be set inconsistently.
 *
 * - **`epicId` in the `$tabId` slot.** A canvas tab id is minted client-side
 *   and is unknowable from here. It does not need to be known: for a `$tabId`
 *   the store does not hold, `tabNavigationController.resolveExternalEpic`
 *   opens a tab for the epic and re-navigates to the real id, carrying the
 *   search params across. Using the epic id as the placeholder is the app's
 *   OWN convention for "no tab id yet" — see `epics-list-panel.tsx`,
 *   `resolveTabIdForEpic(item.epicId) ?? item.epicId`.
 *
 * - **`focusArtifactId`, not `focusThreadId`.** The name is a trap. A chat IS
 *   an artifact in the canvas store, and `focusArtifactId` is what the app's
 *   own push-notification routing passes a chat id as
 *   (`lib/notifications/payload.ts` → `routeEpicChatNotification`, the branch
 *   taken when no tile for that chat is open — which is always true for a tab
 *   opened by this link). `focusThreadId` is an artifact COMMENT thread, it is
 *   ignored unless `focusArtifactId` is also set, and it would focus nothing.
 *
 * `focusedAt` is deliberately absent. It is only a de-dupe discriminator for
 * repeat activations of the same target; a link has no arrival time, and a
 * fixed build-time stamp de-dupes identically to omitting it. Leaving it out
 * keeps this function pure, with no clock to inject.
 *
 * ## The duplication is still deliberate, and still a liability
 *
 * The route is written here rather than imported: the bot and the tab are
 * separately deployed artifacts and a shared constant would imply they move
 * together. They do not — the bot can be redeployed while an older tab is
 * still being served. What is new is that the join is no longer a comment. The
 * golden link in `__tests__/__fixtures__/watch-progress-links.json` is asserted
 * from BOTH sides: this package pins that it emits those exact bytes, and
 * `clients/gui-app/src/lib/__tests__/teams-card-link-contract.test.ts` pins
 * that the app's own route parsers resolve them to the epic and the chat.
 * Neither side can drift alone, which is precisely what happened last time.
 *
 * NO FQDN IN THIS FILE. The base URL is configuration — the tab origin is a
 * deployment fact and this repo is public.
 */

export interface DeepLinkConfig {
  /** e.g. `https://<host>/next/` — trailing slash optional. Empty disables links. */
  readonly tabBaseUrl: string;
}

/**
 * `null` when no base URL is configured, and the caller must render a card
 * WITHOUT a link rather than a link that goes nowhere.
 *
 * A dead "Watch progress" button is worse than none: it is the one part of
 * the reply the user is being told to act on, and a button that does nothing
 * is the `Action.Execute` failure in a different costume.
 */
export function chatDeepLink(
  config: DeepLinkConfig,
  epicId: string,
  chatId: string,
): string | null {
  const base = config.tabBaseUrl.trim().replace(/\/+$/, "");
  if (base === "") return null;
  if (epicId.trim() === "" || chatId.trim() === "") return null;

  const origin = parseBase(base);
  // An unparseable base cannot be classified as root or subpath, and guessing
  // picks the history mode — the one thing that decides whether the link works
  // at all. No link beats a coin flip, by this function's own contract above.
  if (origin === null) return null;

  const route =
    `/epics/${encodeURIComponent(epicId)}/${encodeURIComponent(epicId)}` +
    `?focusArtifactId=${encodeURIComponent(chatId)}`;

  return origin.isSubpath ? `${base}/#${route}` : `${base}${route}`;
}

/**
 * Mirrors `gui-app`'s `isSubpathDeploy()`, which reads `import.meta.env.BASE_URL`
 * and calls anything but `/` a subpath. Here the same fact arrives as the path
 * of the configured base URL, because that IS the vite base the tab was built
 * with — `/next/` is served from `/next/` precisely because it was built with
 * `base: "/next/"`.
 */
function parseBase(base: string): { readonly isSubpath: boolean } | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  // Only http(s) can serve a tab. A `javascript:` or `data:` base would be a
  // misconfiguration this must not turn into a rendered button.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { isSubpath: url.pathname.replace(/\/+$/, "") !== "" };
}
