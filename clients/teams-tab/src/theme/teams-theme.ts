/**
 * Theme comes FROM Teams, never from us.
 *
 * This is the whole point of decision 1: Fluent's Teams themes are the same
 * tokens the host uses, so light / dark / high-contrast are correct by
 * construction rather than hand-matched. The bot's cards had to reach the
 * same place by using only the Adaptive Card schema's semantic tokens and
 * never a hex value; this is the same rule with real support behind it.
 *
 * The high-contrast case matters more than it looks. It is not "dark with
 * more contrast" — it is a distinct accessibility mode, and a tab that maps
 * it onto the dark theme is inaccessible to the people who turned it on.
 * `teamsHighContrastTheme` exists; using it is free.
 *
 * OUTSIDE TEAMS this module still resolves a theme rather than throwing. The
 * tab is developed and screenshotted in a plain browser, and a scaffold that
 * only renders inside Teams cannot be looked at until it is deployed — which
 * is exactly the loop this project has been trying to shorten.
 */
import {
  teamsDarkTheme,
  teamsHighContrastTheme,
  teamsLightTheme,
  type Theme,
} from "@fluentui/react-components";

/** The three values Teams reports; `default` is its name for light. */
export type TeamsThemeName = "default" | "dark" | "contrast";

export function themeFor(name: TeamsThemeName): Theme {
  switch (name) {
    case "dark":
      return teamsDarkTheme;
    case "contrast":
      return teamsHighContrastTheme;
    case "default":
      return teamsLightTheme;
  }
}

/**
 * Normalises whatever the host reports into the three names above.
 *
 * Teams has historically sent values beyond the documented three, so an
 * unknown string falls back to light rather than throwing — a tab that fails
 * to start because it did not recognise a theme name would be a poor trade.
 */
export function normaliseThemeName(raw: string | undefined): TeamsThemeName {
  if (raw === "dark") return "dark";
  if (raw === "contrast") return "contrast";
  return "default";
}
