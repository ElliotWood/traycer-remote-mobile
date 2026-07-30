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
  MessageBar,
  MessageBarBody,
  Subtitle1,
  Text,
  tokens,
} from "@fluentui/react-components";
import { FleetGrid } from "./fleet/fleet-grid";
import type { FleetAgent } from "./fleet/fleet-types";
import {
  FIXTURE_NOW,
  FLEET_FIXTURE,
  REAL_FLEET_FIXTURE,
} from "./fleet/fleet-fixture";
import { themeFor } from "./theme/teams-theme";
import { configProblems } from "./config";
import { SignIn } from "./auth/sign-in";
import { useAuthService, useAuthStatus } from "./auth/use-auth";
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
  const auth = useAuthService();
  const status = useAuthStatus(auth);

  // Nothing paints until initialize settles either way — a flash of the light
  // theme before switching to dark is the sort of thing that reads as cheap.
  if (!ready) return <FluentProvider theme={themeFor("default")} />;

  // Config problems are reported BEFORE anything is attempted. A tab that
  // starts and then fails on its first RPC is far harder to diagnose from
  // inside Teams than one that names the missing build variable — there is
  // no address bar and no easy console in there.
  const problems = configProblems();
  if (problems.length > 0) {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <Subtitle1>Traycer isn&rsquo;t configured</Subtitle1>
          {problems.map((p) => (
            <Text key={p.key} className={styles.subtle}>
              <strong>{p.key}</strong> — {p.detail}
            </Text>
          ))}
        </div>
      </FluentProvider>
    );
  }

  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);

  /**
   * Renders the FIXTURE fleet without signing in, so the surface can still be
   * screenshotted and reviewed. Adding the auth gate silently killed the
   * shoot-before-wire loop — the loop that has caught nearly every UI defect
   * on this project — and losing it would cost more than it saves.
   *
   * Three hard constraints, stated as PROPERTIES rather than mechanisms —
   * the distinction matters and the first draft got it wrong.
   *
   * 1. **Never reachable inside Teams.** `inTeams` comes from a successful
   *    host handshake, so a query param on a real tab cannot get here.
   *
   * 2. **No code path reachable from here ever reads the host.** The first
   *    version said "it renders fixtures only", which is a mechanism, not a
   *    property: a future change that reads the host while still calling
   *    itself the fixture path satisfies that wording exactly and breaks
   *    the thing it was meant to protect. Phrased as the property, the
   *    constraint still bites after the wiring lands.
   *
   * 3. **Nothing rendered here is real.** Also a property, and it is why the
   *    fixtures contain invented titles and synthetic host ids: this URL is
   *    served unauthenticated, so anything in a fixture is public. That is
   *    a constraint on the FIXTURES, not on this flag.
   */
  const previewingFleet = !inTeams && params.get("preview") === "fleet";

  if (status.kind !== "signed-in" && !previewingFleet) {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <SignIn
          status={status}
          onSignIn={() => void auth.signIn()}
          onCancel={() => {
            auth.cancelSignIn();
          }}
        />
      </FluentProvider>
    );
  }

  // `?fleet=real` and `?view=grid|list` are the same out-of-Teams preview
  // affordance as `?theme`: they answer layout questions from images at a
  // FIXED width, rather than by resizing a window and trusting a memory of
  // what the other one looked like. Never consulted inside Teams.
  const fleet =
    params.get("fleet") === "real" ? REAL_FLEET_FIXTURE : FLEET_FIXTURE;
  const rawView = params.get("view");
  const forceView =
    rawView === "grid" || rawView === "list" ? rawView : undefined;

  const blocked = fleet.filter(
    (a: FleetAgent) => a.pendingApprovals + a.pendingInterviews > 0,
  ).length;
  const local = fleet.filter((a: FleetAgent) => a.isLocal).length;
  const remote = fleet.length - local;

  return (
    <FluentProvider theme={themeFor(themeName)}>
      <div className={styles.page}>
        {/*
          UNMISSABLE, and deliberately not a footnote.

          The previous marker only rendered when Teams was ABSENT — which is
          exactly backwards. Inside Teams `app.initialize()` succeeds, the
          marker disappears, and the user sees eight plausible agents with
          real-looking titles and nothing saying they are invented. That is a
          surface stating something false, and no line of code in it is
          dishonest — the same shape as a fleet reporting 53 agents idle.

          This is removed in the commit that wires real data, not before.
        */}
        <MessageBar intent="warning">
          <MessageBarBody>
            <strong>Sample data.</strong> This fleet is a fixture — these agents
            are not real and nothing here reflects your host yet.
          </MessageBarBody>
        </MessageBar>

        <div className={styles.header}>
          <Subtitle1>Fleet</Subtitle1>
          <Text size={200} className={styles.subtle}>
            {blocked > 0
              ? `${String(blocked)} waiting on you · ${String(fleet.length)} agents`
              : `${String(fleet.length)} agents`}
          </Text>
        </div>

        {/*
          The honest fleet is 3 local agents and 53 read-only ones, all idle.
          Every row is true and the whole thing reads as dead — which is only
          half the job. Said ONCE here rather than inferred from 53 identical
          badges, because "why is everything read-only" is the first question
          the surface should answer, not the last.

          Counts by host, because "which agents can this host actually drive"
          is the real situation and today it has to be inferred.
        */}
        {remote > 0 ? (
          <MessageBar intent="info">
            <MessageBarBody>
              <strong>
                {local} on this host · {remote} elsewhere.
              </strong>{" "}
              Agents running on another machine can be read but not messaged
              from here, and their activity isn&rsquo;t visible — so they show
              as read-only rather than idle.
            </MessageBarBody>
          </MessageBar>
        ) : null}

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
            Running outside Teams — {themeName} theme.
          </Text>
        ) : null}
      </div>
    </FluentProvider>
  );
}
