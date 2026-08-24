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
 * ## Why a correct web link was still the wrong link
 *
 * Everything above makes the URL resolve. It does not make it a TEAMS link.
 * `Action.OpenUrl` on an ordinary `https://` URL hands it to the platform,
 * which opens it outside the tab — and even where a client shows it in an
 * embedded view, that view is a TOP-LEVEL browsing context at our origin,
 * while the installed tab is a third-party frame under Teams. Those are
 * different storage partitions, so the tab's device-auth tokens are not there:
 * the user presses a button inside Teams and arrives, outside Teams, at a
 * sign-in screen. The partitioning half is not a guess — it is what the
 * iframe storage gate measured when the tab was first built.
 *
 * The Teams-native form addresses the installed app instead:
 *
 *     https://teams.microsoft.com/l/entity/<appId>/<entityId>
 *       ?webUrl=<the web link above>
 *       &context={"subEntityId":"<route>"}
 *
 * `subEntityId` is the ONLY channel a deep link has for saying which page to
 * open; it reaches the tab as `app.getContext().page.subPageId`. So this half
 * is inert until the tab reads that field — see the note on `TRAYCER_TEAMS_APP_ID`
 * in `index.ts`. Emitting an entity link into a tab that ignores `subPageId`
 * would open the app's landing page: still inside Teams, still signed in, and
 * still not the chat. That is why the app id is configuration and defaults to
 * off rather than being hardcoded from the manifest.
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
  /**
   * The Teams app id — `appPackage/manifest.json`'s `id`, NOT the bot id.
   *
   * Empty or unset keeps the plain web link, which is the safe default: a web
   * link works everywhere and merely leaves Teams, whereas an entity link with
   * the wrong app id opens nothing at all.
   */
  readonly teamsAppId?: string;
}

/**
 * The `entityId` of the app's static tab in `appPackage/manifest.json`.
 *
 * Teams calls this the `pageId` in a deep link and the `entityId` in a
 * manifest; they are the same string and it must match exactly or the link
 * resolves to the app with no page. Pinned against the manifest itself by
 * `read-surface/__tests__/manifest-static-tabs.test.ts`, because the two files
 * are separately deployed and a rename here would otherwise be silent.
 */
export const APP_TAB_ENTITY_ID = "traycer.app";

/** `id` in a freshly rendered manifest, before the deploy substitutes it. */
const UNSUBSTITUTED_APP_ID = "00000000-0000-0000-0000-000000000000";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const webUrl = origin.isSubpath ? `${base}/#${route}` : `${base}${route}`;

  const appId = teamsAppId(config);
  return appId === null ? webUrl : entityDeepLink(appId, route, webUrl);
}

/**
 * `null` unless the configured app id is one Teams could actually resolve.
 *
 * The nil uuid is rejected by name because it is what `manifest.json` carries
 * in the repo: an operator who copies the manifest's own `id` into the bot's
 * environment configures a link to app `00000000-…`, which is not an error
 * anywhere — Teams simply opens nothing. This is the same class as the help
 * page's refusal to map a literal, unsubstituted `{theme}` onto a colour:
 * a placeholder that survived deployment must fail closed, back to the web
 * link, rather than be treated as a value.
 */
function teamsAppId(config: DeepLinkConfig): string | null {
  const id = config.teamsAppId?.trim() ?? "";
  if (id === "" || id === UNSUBSTITUTED_APP_ID) return null;
  return UUID_RE.test(id) ? id : null;
}

/**
 * Builds the link byte-for-byte the way `@microsoft/teams-js` builds its own.
 *
 * Not copied from documentation: read out of the shipped SDK, whose
 * `createTeamsAppLink` (`internal/utils.js`) is
 *
 *     new URL("https://teams.microsoft.com/l/entity/" + encodeURIComponent(appId)
 *             + "/" + encodeURIComponent(pageId))
 *     …searchParams.append("webUrl", …)
 *     …searchParams.append("context", JSON.stringify({ chatId, channelId, subEntityId }))
 *
 * so the parameter names, their order and the JSON envelope are the SDK's,
 * reproduced here because the bot is a Node process that must not pull a
 * browser SDK in to format a string.
 *
 * `webUrl` is the fallback Teams uses where it cannot open the tab — an
 * Outlook client, a browser with no Teams installed — and it is exactly the
 * link this function returned before, so nothing loses the old behaviour; it
 * moves from being the whole answer to being the second one.
 *
 * `subEntityId` carries the SAME route string that the web link puts in its
 * fragment. One route shape in this file, and the tab applies it verbatim.
 */
function entityDeepLink(appId: string, route: string, webUrl: string): string {
  const url = new URL(
    `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${encodeURIComponent(APP_TAB_ENTITY_ID)}`,
  );
  url.searchParams.append("webUrl", webUrl);
  url.searchParams.append("context", JSON.stringify({ subEntityId: route }));
  return url.toString();
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
