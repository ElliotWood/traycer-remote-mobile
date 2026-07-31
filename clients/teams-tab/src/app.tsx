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
import {
  FleetEmpty,
  FleetError,
  FleetLoading,
  FleetStale,
} from "./fleet/fleet-state";
import { EpicsView } from "./epics/epics-view";
import { useEpics } from "./epics/use-epics";
import {
  createTabHostConnection,
  type HostConnectionAuth,
} from "./host/connection";
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

/**
 * The signed-in screen: the user's real epics.
 *
 * A separate component because the host connection is built ONCE and must not
 * be rebuilt on every render of `App` — a new `HostClient` per render would
 * re-dial the socket continuously. `useState`'s initialiser gives it app
 * lifetime, matching how the PWA holds its connection.
 *
 * Not disposed on unmount, deliberately and for the same reason mobile
 * doesn't: this only unmounts on full page teardown, and disposing in an
 * effect cleanup would tear the connection down under StrictMode's simulated
 * remount.
 */
function EpicsScreen({
  styles,
  auth,
}: {
  readonly styles: Record<string, string>;
  readonly auth: HostConnectionAuth;
}): ReactElement {
  const [connection] = useState(() => createTabHostConnection(auth));
  const { state, reload, loadMore } = useEpics(connection?.hostClient ?? null);
  // One clock for the whole render, so two rows never disagree about "now".
  const [now] = useState(() => Date.now());

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Subtitle1>Epics</Subtitle1>
        {state.kind === "ready" ? (
          <Text size={200} className={styles.subtle}>
            {state.epics.length} {state.epics.length === 1 ? "epic" : "epics"}
          </Text>
        ) : null}
      </div>
      <EpicsView
        state={state}
        now={now}
        onReload={reload}
        onLoadMore={loadMore}
        onOpen={() => {
          // Epic detail lands next; a no-op keeps the row affordance honest
          // about being unfinished rather than silently doing nothing.
        }}
      />
    </div>
  );
}

export function App(): ReactElement {
  const styles = useStyles();
  const { themeName, inTeams, ready } = useTeamsTheme();
  const width = useViewportWidth();
  const { auth, restoring } = useAuthService();
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
          {/*
            Says WHOSE problem it is and what resolves it, not just which
            variable is unset.

            Elliot hit this screen and it named all three missing variables —
            correct, and useless to him: he cannot set a build-time variable
            from inside Teams, and nothing on screen said so. A person told
            only what is broken, with no way to tell whether they broke it,
            assumes they did.

            The variable names stay, because whoever fixes this needs them.
            The sentence above is for whoever is merely LOOKING at it.
          */}
          <MessageBar intent="error">
            <MessageBarBody>
              <strong>This isn&rsquo;t something you can fix from here.</strong>{" "}
              The app was built without its deployment settings, so it
              doesn&rsquo;t know which Traycer host to talk to. It needs to be
              rebuilt and redeployed with the values below set — nothing is
              wrong with your account or your agents.
            </MessageBarBody>
          </MessageBar>
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

  // Nothing about sign-in paints while the session is still being restored.
  // Offering a "Sign in" button to someone who is already signed in is how
  // Elliot ended up starting a device flow he did not need — and it is what
  // would make a reload look like a lost session when it is not.
  if (restoring && !previewingFleet) {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <FleetLoading rows={3} />
        </div>
      </FluentProvider>
    );
  }

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

  /**
   * `?state=loading|empty|error|disconnected` — previews a state the happy
   * path cannot reach on demand.
   *
   * These are the states that are HARD to see and therefore the ones that
   * ship broken: `loading` lasts 200ms, `error` needs the host down, and
   * `empty` needs an account with no agents. Every one of them shipped
   * unreviewed in the PWA for exactly that reason. A query param makes each
   * one a URL that can be opened, screenshotted and argued about.
   *
   * Same constraints as `?preview` — never reachable inside Teams, and it
   * only ever chooses which of these components renders. Once the fleet is
   * wired, this selects a state to DISPLAY; it never induces one, so it
   * cannot be used to fake a healthy fleet into looking broken or back.
   */
  const forcedState = params.get("state");

  if (forcedState === "loading") {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <div className={styles.header}>
            <Subtitle1>Fleet</Subtitle1>
          </div>
          <FleetLoading />
        </div>
      </FluentProvider>
    );
  }
  if (forcedState === "empty") {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <div className={styles.header}>
            <Subtitle1>Fleet</Subtitle1>
          </div>
          <FleetEmpty hostId="this host" />
        </div>
      </FluentProvider>
    );
  }
  if (forcedState === "error") {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <div className={styles.header}>
            <Subtitle1>Fleet</Subtitle1>
          </div>
          <FleetError
            detail="host unreachable — connect ECONNREFUSED 127.0.0.1:55945"
            onRetry={() => {
              // Wired with the host; the button is here so the state is
              // reviewed with its affordance rather than without it.
            }}
          />
        </div>
      </FluentProvider>
    );
  }

  /**
   * FIXTURES ARE FOR `?preview=` ONLY, never for a signed-in user.
   *
   * Elliot signed in — device code and all — and landed on eight invented
   * agents behind the sample-data warning. The warning was doing its job,
   * which is the only reason this was a defect rather than a disaster: the
   * bar is honest that the rows are invented, and says nothing about why
   * they are on screen after authenticating. Sample data before sign-in is a
   * placeholder; the same rows after sign-in are the app implying it has
   * fetched your fleet.
   *
   * Same family as everything else here — a surface that looks like an
   * answer and is not one. Removed with the host wiring, which replaces this
   * branch rather than deleting it.
   */
  if (!previewingFleet) {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <EpicsScreen styles={styles} auth={auth} />
      </FluentProvider>
    );
  }

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

        {/*
          Stale rows UNDER a banner, never a blank grid. Blanking would render
          zero rows, which is the empty state's pixels and a claim we have
          lost the basis for — "we last saw this" and "there is nothing" are
          opposite statements.
        */}
        {forcedState === "disconnected" ? (
          <FleetStale since="4 minutes ago" onRetry={() => undefined} />
        ) : null}

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
