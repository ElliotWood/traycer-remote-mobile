/**
 * The "watch progress" link, into the tab's chat route.
 *
 * MIRRORS `clients/teams-tab/src/router/route.ts`:
 *
 *     chat  →  ${BASE}/epics/${epicId}/chats/${chatId}
 *
 * That path is duplicated here rather than imported, because the bot and the
 * tab are separately deployed artifacts and a shared constant would imply
 * they move together. They do not: the bot can be redeployed while an older
 * tab is still being served, which is exactly the state the VM was in for
 * most of today.
 *
 * The duplication is therefore deliberate — and it is a LIABILITY, so it is
 * written down: if the tab's route shape changes, this produces a link that
 * 404s into the SPA fallback and renders the epics list instead. A user would
 * see "the wrong page", not an error. There is a test pinning the shape, and
 * it names `route.ts` so the next person changing that file finds this one.
 *
 * NO FQDN IN THIS FILE. The base URL is configuration — the tab origin is a
 * deployment fact and this repo is public.
 */

export interface DeepLinkConfig {
  /** e.g. `https://<host>/tab` — no trailing slash. Empty disables links. */
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
  return `${base}/epics/${encodeURIComponent(epicId)}/chats/${encodeURIComponent(chatId)}`;
}
