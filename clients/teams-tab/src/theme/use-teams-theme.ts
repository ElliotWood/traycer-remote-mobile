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

/**
 * How long to wait for the Teams host to answer before giving up on it.
 *
 * MEASURED, and the reason this exists at all: `app.initialize()` does NOT
 * reliably reject when Teams is absent. Standalone it rejects promptly — but
 * inside an IFRAME it postMessages its parent and waits, and a parent that
 * is not Teams simply never answers. The promise then neither resolves nor
 * rejects.
 *
 * The deployed tab was verified doing exactly that: standalone it renders
 * the sign-in screen; framed under a non-Teams parent it rendered an empty
 * document, no errors, forever. `ready` stayed false and the app painted
 * `<FluentProvider/>` with nothing inside.
 *
 * That is the blank-screen failure this project has already fixed once in
 * the PWA, reintroduced here by code whose own docblock claimed to prevent
 * it — the catch path handles "no parent", not "a parent that never
 * replies".
 *
 * 4s is generous for a postMessage handshake to a host that IS listening,
 * and short enough that a user is not staring at nothing.
 */
const INITIALIZE_TIMEOUT_MS = 4000;

export function useTeamsTheme(): TeamsThemeState {
  const [state, setState] = useState<TeamsThemeState>({
    themeName: "default",
    inTeams: false,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;

    // Races the handshake against a timeout, because `initialize()` can hang
    // rather than reject — see INITIALIZE_TIMEOUT_MS. `Promise.race` and not
    // a flag check afterwards: a hung promise never runs its `.then`, so
    // nothing downstream of it would ever execute.
    const timedOut = Symbol("teams-initialize-timeout");
    const timeout = new Promise<typeof timedOut>((resolve) =>
      setTimeout(() => {
        resolve(timedOut);
      }, INITIALIZE_TIMEOUT_MS),
    );

    // `.catch(() => {})` on the initialize promise itself, NOT only on the
    // race: once the timeout wins, the race is settled and a later rejection
    // from `initialize()` has no handler — an unhandled-rejection warning in
    // the console of a Teams tab, which is exactly the noise that makes a
    // real error hard to spot later.
    const initialize = app
      .initialize()
      .then(() => "ok" as const)
      .catch(() => "failed" as const);

    Promise.race([initialize, timeout])
      .then(async (outcome) => {
        if (outcome === timedOut || outcome === "failed") {
          // A parent that never answered, or an initialize that rejected.
          // Neither is an error here — the tab is simply not running under
          // Teams, and rendering something beats rendering nothing.
          if (!cancelled) {
            setState({
              themeName: themeFromLocation(),
              inTeams: false,
              ready: true,
            });
          }
          return;
        }
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
