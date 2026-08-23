/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `teams-host.ts`; same scope and same caveat.
 *
 * Reads the Teams theme out of the tab's own URL, so first paint is already
 * the right colour.
 *
 * ## Why this exists when `teams-host.ts` already reports the theme
 *
 * It reports it too LATE to paint with. The handshake is a dynamic import of
 * ~100KB of SDK followed by a postMessage round trip, raced against a 4s
 * timeout, and `main.tsx` deliberately fires it AFTER `createRoot().render()`
 * because nothing user-visible may wait on it. All of that is correct and none
 * of it is changed here. The consequence is simply that a dark-Teams user sees
 * a LIGHT tab first and it flips once the host answers.
 *
 * Teams offers a second channel that has neither cost nor latency: a
 * `{theme}` placeholder in the manifest's `contentUrl`, substituted by the
 * client BEFORE the page is requested. The theme is then in
 * `window.location.search` at the top of `bootstrap()`, and applying it costs
 * one string comparison.
 *
 * ## This repo already made this exact argument, for the lesser surface
 *
 * `clients/teams-bot/appPackage/README.md` says of the Help tab:
 *
 *   > That gives the help page a correct theme on its very first paint without
 *   > a teams-js handshake, which matters because the page must render even
 *   > when the handshake never completes.
 *
 * That reasoning applies to `/next/` with MORE force, not less: the help page
 * is a static explainer that has no handshake at all, whereas this bundle is
 * the one that explicitly designs for the handshake never completing. The
 * manifest carried `?theme={theme}` on `/help/` and not on `/next/` - the
 * mechanism was present, documented, and pointed at the smaller problem.
 *
 * ## The two halves are useless apart, and neither fails loudly
 *
 * The manifest half (`?theme={theme}` on the `/next/` tab) and this half must
 * BOTH land. Manifest alone: the parameter arrives and nothing reads it.
 * This alone: no parameter ever arrives. Neither produces an error, a warning
 * or a failing test - just the original late flip. Stated here because a
 * reader landing one half has no signal that the other is missing.
 */

import type { ResolvedTheme } from "@traycer-clients/gui-app";
import { teamsThemeToResolved } from "./teams-host";

/**
 * The theme names Teams actually substitutes. `default` and `dark` are the
 * originals; `contrast` is the high-contrast client; `glass` is the new
 * client's translucent surface.
 *
 * A CLOSED list, and that is the load-bearing decision in this file - see
 * `readTeamsThemeParam`.
 */
const TEAMS_THEME_NAMES: readonly string[] = [
  "default",
  "dark",
  "contrast",
  "glass",
];

export const TEAMS_THEME_PARAM = "theme";

/**
 * Returns the Teams theme named in a query string, or `null` when there is no
 * usable one.
 *
 * ## Why an unrecognised value is `null` here and `"light"` in `teamsThemeToResolved`
 *
 * They are answering different questions, and collapsing them would reintroduce
 * the very defect this file fixes.
 *
 * `teamsThemeToResolved` is fed by `getContext()`, so its input is always a
 * real theme name from a real Teams client. An unfamiliar one there means "a
 * future client shipped a new theme", and guessing `light` is the better of
 * two wrong answers.
 *
 * A URL parameter has a failure mode the SDK does not: **the placeholder may
 * not have been substituted at all**, in which case the literal string
 * `{theme}` arrives. That does not mean "some theme we do not recognise", it
 * means "no signal" - and resolving it to `light` would force a light tab on a
 * dark-Teams user, which is precisely the bug being fixed, re-entered through
 * the fix. So anything not on the closed list yields `null`, the host override
 * is never set, and the app behaves exactly as it did before this file
 * existed: OS preference now, SDK theme when the handshake lands.
 *
 * `null` is therefore the safe answer in every ambiguous case, which is why
 * the list is closed rather than a `startsWith`/`!== "{theme}"` filter.
 */
export function readTeamsThemeParam(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const value = params.get(TEAMS_THEME_PARAM);
  if (value === null) return null;
  return TEAMS_THEME_NAMES.includes(value) ? value : null;
}

/**
 * Resolves the Teams theme in a query string to a light/dark signal.
 *
 * Routed through `teamsThemeToResolved` rather than repeating its mapping, so
 * the URL channel and the SDK channel cannot disagree about what `contrast`
 * means. A tab that painted dark from the URL and then flipped light when the
 * handshake landed would be a worse bug than the one this fixes, because it
 * would look like a rendering fault rather than a stale theme.
 */
export function resolveTeamsThemeParam(search: string): ResolvedTheme | null {
  const theme = readTeamsThemeParam(search);
  return theme === null ? null : teamsThemeToResolved(theme);
}
