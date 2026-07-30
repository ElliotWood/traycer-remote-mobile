/**
 * Subscribes to the Teams host's theme, and degrades to a plain browser.
 *
 * `app.initialize()` REJECTS outside Teams. That is not an error condition
 * here — the tab is developed, screenshotted and reviewed in a normal browser
 * long before it is ever installed, and a scaffold that only renders inside
 * Teams cannot be looked at until it is deployed. So a failed initialize is
 * recorded as `inTeams: false` and the app renders with the light theme.
 *
 * The alternative — treating "not in Teams" as fatal — would have made the
 * shoot-before-wire loop impossible, which is the loop that has caught most
 * of this project's layout defects.
 */
import { useEffect, useState } from "react";
import { app } from "@microsoft/teams-js";
import { normaliseThemeName, type TeamsThemeName } from "./teams-theme";

export interface TeamsThemeState {
  readonly themeName: TeamsThemeName;
  /** `false` in a plain browser. Surfaced so the UI can say so rather than pretending. */
  readonly inTeams: boolean;
  /** `false` until initialize settles either way, so nothing paints on a guess. */
  readonly ready: boolean;
}

/**
 * `?theme=dark|contrast` — a developer affordance for previewing the tab's
 * three themes in a plain browser, where there is no host to ask.
 *
 * Deliberately only consulted when Teams is ABSENT, so it can never override
 * the real host: inside Teams this code path does not run at all. It exists
 * because the alternative for reviewing dark and high-contrast is deploying
 * and switching your Teams theme by hand, and a review loop that slow is a
 * review loop nobody runs.
 */
function themeFromLocation(): TeamsThemeName {
  if (typeof window === "undefined") return "default";
  const raw = new URLSearchParams(window.location.search).get("theme");
  return normaliseThemeName(raw ?? undefined);
}

export function useTeamsTheme(): TeamsThemeState {
  const [state, setState] = useState<TeamsThemeState>({
    themeName: "default",
    inTeams: false,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;

    app
      .initialize()
      .then(async () => {
        const context = await app.getContext();
        if (cancelled) return;
        setState({
          themeName: normaliseThemeName(context.app.theme),
          inTeams: true,
          ready: true,
        });
        // Teams pushes theme changes rather than expecting a poll; without
        // this the tab keeps the theme it started with when the user switches.
        app.registerOnThemeChangeHandler((next) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            themeName: normaliseThemeName(next),
          }));
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          themeName: themeFromLocation(),
          inTeams: false,
          ready: true,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
