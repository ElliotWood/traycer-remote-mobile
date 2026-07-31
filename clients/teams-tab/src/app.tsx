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
import { useState, type ReactElement } from "react";
import {
  FluentProvider,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Subtitle1,
  Text,
  tokens,
} from "@fluentui/react-components";
import { FleetLoading } from "./fleet/fleet-state";
import { EpicDetail } from "./epics/epic-detail";
import { EPICS_FIXTURE, EPICS_FIXTURE_NOW } from "./epics/epics-fixture";
import { EpicsView } from "./epics/epics-view";
import { useEpics, type EpicsState } from "./epics/use-epics";
import { useRoute } from "./router/use-route";
import type { FleetEpic } from "@traycer-clients/shared/epic/epic-list";
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
  preview,
}: {
  readonly styles: Record<string, string>;
  readonly auth: HostConnectionAuth;
  /**
   * Forces a state instead of talking to the host, so every state has a URL
   * that can be opened, screenshotted and argued about.
   *
   * Same properties as the other preview affordances: unreachable inside
   * Teams, and no code path from here reads the host — with `preview` set the
   * connection is never built at all, so this is a property of the wiring and
   * not a promise in a comment.
   */
  readonly preview: EpicsState | null;
}): ReactElement {
  const [connection] = useState(() =>
    preview === null ? createTabHostConnection(auth) : null,
  );
  const live = useEpics(connection?.hostClient ?? null);
  const { state, reload, loadMore } = preview === null
    ? live
    : { state: preview, reload: () => undefined, loadMore: () => undefined };
  const { route, navigate } = useRoute();
  // One clock for the whole render, so two rows never disagree about "now".
  const [now] = useState(() => (preview === null ? Date.now() : EPICS_FIXTURE_NOW));
  // Remembered so the detail screen can show a real title immediately. NOT
  // required by it: a deep link or reload arrives with only the id, and a
  // detail view that renders solely when navigated to from the list is one
  // that breaks on refresh.
  const [opened, setOpened] = useState<FleetEpic | null>(null);

  if (route.name === "epic") {
    return (
      <div className={styles.page}>
        <EpicDetail
          epic={opened !== null && opened.id === route.epicId ? opened : null}
          epicId={route.epicId}
          onBack={() => {
            navigate({ name: "epics" });
          }}
        />
      </div>
    );
  }

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
        onOpen={(epic) => {
          setOpened(epic);
          navigate({ name: "epic", epicId: epic.id });
        }}
      />
    </div>
  );
}

export function App(): ReactElement {
  const styles = useStyles();
  const { themeName, inTeams, ready } = useTeamsTheme();
  const { auth, restoring } = useAuthService();
  const status = useAuthStatus(auth);

  // Nothing paints until initialize settles either way — a flash of the light
  // theme before switching to dark is the sort of thing that reads as cheap.
  if (!ready) return <FluentProvider theme={themeFor("default")} />;

  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);

  /**
   * `?preview=epics[&state=…]` renders the FIXTURE epics without signing in.
   *
   * The states that ship broken are the ones that are hard to reach —
   * `loading` lasts 200ms, `error` needs the host down, `empty` needs an
   * account with no epics. A query param turns each into a URL.
   *
   * Constraints as PROPERTIES, not mechanisms:
   *   1. Never reachable inside Teams — `inTeams` comes from a successful
   *      host handshake, so a query param on a real tab cannot get here.
   *   2. No code path from here reads the host. Enforced by the WIRING: with
   *      a preview state set, the connection is never constructed.
   *   3. Nothing rendered here is real, which is a constraint on the FIXTURES
   *      (this URL is served unauthenticated), not on this flag.
   */
  const previewState = ((): EpicsState | null => {
    if (inTeams || params.get("preview") !== "epics") return null;
    switch (params.get("state")) {
      case "loading":
        return { kind: "loading" };
      case "error":
        return {
          kind: "error",
          detail: "host unreachable — connect ECONNREFUSED 127.0.0.1:55945",
        };
      case "empty":
        return {
          kind: "ready",
          epics: [],
          hasMore: false,
          loadingMore: false,
          stale: false,
          loadedAt: EPICS_FIXTURE_NOW,
        };
      case "disconnected":
        return {
          kind: "ready",
          epics: EPICS_FIXTURE,
          hasMore: false,
          loadingMore: false,
          stale: true,
          loadedAt: EPICS_FIXTURE_NOW - 4 * 60_000,
        };
      default:
        return {
          kind: "ready",
          epics: EPICS_FIXTURE,
          hasMore: true,
          loadingMore: false,
          stale: false,
          loadedAt: EPICS_FIXTURE_NOW,
        };
    }
  })();

  // Config problems are reported BEFORE anything is attempted. A tab that
  // starts and then fails on its first RPC is far harder to diagnose from
  // inside Teams than one that names the missing build variable — there is
  // no address bar and no easy console in there.
  // The PREVIEW path skips this gate, and that is a property of the wiring
  // rather than a convenience: with a preview state set the host connection
  // is never constructed, so deployment config cannot affect what renders.
  // Gating it anyway cost real time — a shoot built without the build-time
  // variables produced fifteen images of this very screen, which would have
  // been reported as the epics surface if I had not opened one.
  const problems = previewState === null ? configProblems() : [];
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
  // Nothing about sign-in paints while the session is still being restored.
  // Offering a "Sign in" button to someone who is already signed in is how
  // Elliot ended up starting a device flow he did not need — and it is what
  // would make a reload look like a lost session when it is not.
  if (restoring && previewState === null) {
    return (
      <FluentProvider theme={themeFor(themeName)}>
        <div className={styles.page}>
          <FleetLoading rows={3} />
        </div>
      </FluentProvider>
    );
  }

  if (status.kind !== "signed-in" && previewState === null) {
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


  return (
    <FluentProvider theme={themeFor(themeName)}>
      <EpicsScreen styles={styles} auth={auth} preview={previewState} />
    </FluentProvider>
  );
}
