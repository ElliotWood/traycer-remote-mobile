/**
 * The tab shell.
 *
 * Scaffold stage: renders Fleet from a fixture. Nothing is wired to the host
 * yet, on purpose — layout is the open question and it is answerable from an
 * image, which is the loop that has caught nearly every UI defect on this
 * project. Wiring comes after the shape is agreed.
 *
 * `FluentProvider` is the boundary that makes decision 1 real: every token
 * below it comes from the Teams theme, so light / dark / high-contrast are
 * correct without a single colour being chosen here.
 */
import { useEffect, useState, type ReactElement } from "react";
import {
  FluentProvider,
  makeStyles,
  Subtitle1,
  Text,
  tokens,
} from "@fluentui/react-components";
import { FleetGrid } from "./fleet/fleet-grid";
import {
  FIXTURE_NOW,
  FLEET_FIXTURE,
  LARGE_FLEET_FIXTURE,
} from "./fleet/fleet-fixture";
import { themeFor } from "./theme/teams-theme";
import { useTeamsTheme } from "./theme/use-teams-theme";

const useStyles = makeStyles({
  page: {
    // The Teams host owns the outer chrome; the tab owns its own padding and
    // nothing else. No max-width: Teams tabs are already constrained by the
    // host, and adding a second constraint leaves dead space on wide screens.
    padding: tokens.spacingVerticalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minHeight: "100vh",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

/** Width drives grid-vs-list, so it is measured rather than guessed from a media query. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return width;
}

export function App(): ReactElement {
  const styles = useStyles();
  const { themeName, inTeams, ready } = useTeamsTheme();
  const width = useViewportWidth();

  // Nothing paints until initialize settles either way — a flash of the light
  // theme before switching to dark is the sort of thing that reads as cheap.
  if (!ready) return <FluentProvider theme={themeFor("default")} />;

  // `?fleet=large` and `?view=grid|list` are the same out-of-Teams preview
  // affordance as `?theme`: they let the 55-agent case and the grid-vs-list
  // question be answered from images at a FIXED width, rather than by
  // resizing a window and trusting a memory of what the other one looked
  // like. Never consulted inside Teams.
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const fleet =
    params.get("fleet") === "large" ? LARGE_FLEET_FIXTURE : FLEET_FIXTURE;
  const rawView = params.get("view");
  const forceView =
    rawView === "grid" || rawView === "list" ? rawView : undefined;

  const blocked = fleet.filter(
    (a) => a.pendingApprovals + a.pendingInterviews > 0,
  ).length;

  return (
    <FluentProvider theme={themeFor(themeName)}>
      <div className={styles.page}>
        <div className={styles.header}>
          <Subtitle1>Fleet</Subtitle1>
          <Text size={200} className={styles.subtle}>
            {blocked > 0
              ? `${String(blocked)} waiting on you · ${String(fleet.length)} agents`
              : `${String(fleet.length)} agents`}
          </Text>
        </div>

        <FleetGrid
          agents={fleet}
          now={FIXTURE_NOW}
          width={width}
          forceView={forceView}
          onOpen={() => {
            // Navigation lands with the Epic/Chat tabs; a no-op here keeps the
            // row affordance honest about being a scaffold.
          }}
        />

        {!inTeams ? (
          // Names the theme actually in use rather than the default. The
          // first version said "theme defaults to light" unconditionally and
          // appeared beneath a dark-themed screenshot, which is exactly the
          // kind of caption that gets quoted back as fact.
          <Text size={200} className={styles.subtle}>
            Running outside Teams — {themeName} theme, fixture data.
          </Text>
        ) : null}
      </div>
    </FluentProvider>
  );
}
