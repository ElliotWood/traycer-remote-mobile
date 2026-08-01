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
import { FleetLoading } from "./fleet/fleet-state";
import { AppShell } from "./shell/app-shell";
import { type EpicConnectionState } from "./shell/epic-status-row";
import { useShellStatus } from "./shell/shell-status";
import { EpicDetail } from "./epics/epic-detail";
import { EPICS_FIXTURE, EPICS_FIXTURE_NOW } from "./epics/epics-fixture";
import { EpicsView } from "./epics/epics-view";
import { useEpics, type EpicsState } from "./epics/use-epics";
import { useEpicAgents, type EpicAgentsState } from "./epics/use-epic-agents";
import {
  AGENTS_DEEP_FIXTURE,
  AGENTS_FIXTURE,
  ARTIFACTS_FIXTURE,
  AGENTS_FIXTURE_HOST,
  AGENTS_FIXTURE_NOW,
} from "./epics/agents-fixture";
import { buildChatTree } from "@traycer-clients/shared/epic/epic-doc-chats";
import { buildArtifactTree } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import type { EpicListClient } from "@traycer-clients/shared/epic/epic-list";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import { ApprovalsPreview } from "./chat/approvals-preview";
import { ArtifactMarkdown } from "./artifacts/artifact-markdown";
import { CommentsPanel } from "./comments/comments-panel";
import { AuthorAgent } from "./authoring/author-agent";
import { CreateArtifact } from "./authoring/create-artifact";
import { useCreateAgent } from "./authoring/use-create-agent";
import { CreateEpicForm } from "./authoring/create-epic";
import { EPIC_CREATE_RETRY } from "./authoring/epic-create-rules";
import { useCreateEpic } from "./authoring/use-create-epic";
import { useCreateArtifact } from "./authoring/use-create-artifact";
import type { CreateChatClient } from "@traycer-clients/shared/epic/create-chat";
import type { CreateArtifactClient } from "@traycer-clients/shared/epic/create-artifact";
import {
  COMMENTS_FIXTURE,
  COMMENTS_FIXTURE_NOW,
} from "./comments/comments-fixture";
import {
  ARTIFACT_FIXTURE_BODY,
  ARTIFACT_FIXTURE_TITLE,
} from "./artifacts/artifact-fixture";
import { ChatScreen } from "./chat/chat-screen";
import {
  CHAT_FIXTURE,
  CHAT_FIXTURE_NOW,
  CHAT_FIXTURE_TITLE,
} from "./chat/chat-fixture";
import { useChat } from "./chat/use-chat";
import {
  ATTENTION_FIXTURE,
  ATTENTION_NOW,
} from "./attention/attention-fixture";
import {
  HostStreamConnection,
  type StreamConnectionAuth,
} from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import { CONFIGURED_HOST_ID, HOST_WS_URL } from "./config";
import { useRoute } from "./router/use-route";
import { AttentionView } from "./attention/attention-view";
import { useAttention, type AttentionState } from "./attention/use-attention";
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
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
  /**
   * A screen INSIDE the shell. Same padding and rhythm as `page`, with the
   * `minHeight: 100vh` removed — that is the whole difference and it is the
   * point.
   *
   * Wrapping `page` in the shell without this would have looked done and not
   * worked: a growing child inside a contained body still grows, the frame
   * still stretches, and the header still scrolls away. The frame is
   * necessary and not sufficient; the screens have to stop demanding a
   * viewport each.
   *
   * All eleven screens use this now and  is deleted, so no screen
   * demands a viewport of its own.
   */
  screen: {
    padding: tokens.spacingVerticalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    boxSizing: "border-box",
  },
});

/**
 * One chat, opened from an agent row.
 */
function ChatRoute({
  styles,
  streamConnection,
  epicId,
  chatId,
  entry,
  now,
  onBack,
}: {
  readonly styles: Record<string, string>;
  readonly streamConnection: HostStreamConnection | null;
  readonly epicId: string;
  readonly chatId: string;
  readonly entry: EpicChatEntry | null;
  readonly now: number;
  readonly onBack: () => void;
}): ReactElement {
  const controller = useChat(streamConnection, epicId, chatId);
  return (
    <div className={styles.screen}>
      <ChatScreen
        controller={controller}
        entry={entry}
        configuredHostId={CONFIGURED_HOST_ID}
        now={now}
        onBack={onBack}
      />
    </div>
  );
}

/**
 * "Waiting on you" — the cross-epic attention feed.
 *
 * Its own component for the same reason as the epic screen: the subscription
 * is a hook, and the route that selects it is a conditional.
 */
function WaitingScreen({
  styles,
  streamConnection,
  listClient,
  now,
  preview,
}: {
  readonly styles: Record<string, string>;
  readonly streamConnection: HostStreamConnection | null;
  readonly listClient: EpicListClient | null;
  readonly now: number;
  readonly preview: AttentionState | null;
}): ReactElement {
  const live = useAttention(
    preview === null ? streamConnection : null,
    preview === null ? listClient : null,
  );
  const state = preview ?? live;
  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <Subtitle1>Waiting on you</Subtitle1>
        {state.kind === "ready" && state.items.length > 0 ? (
          <Text size={200} className={styles.subtle}>
            {state.items.length}
          </Text>
        ) : null}
      </div>
      <AttentionView
        state={state}
        now={now}
        onOpen={() => {
          // Chat lands next; a no-op keeps the affordance honest about being
          // unfinished rather than silently doing nothing.
        }}
      />
    </div>
  );
}

/**
 * One epic: its agents, from `epic.subscribe`.
 *
 * A separate component because the subscription must not be opened by a
 * conditional branch of a larger component — hooks cannot live behind an
 * `if`, and the epic route is exactly that.
 */
function EpicScreen({
  styles,
  streamConnection,
  hostClient,
  epicId,
  epic,
  now,
  onBack,
  onOpenAgent,
  preview,
}: {
  readonly styles: Record<string, string>;
  readonly streamConnection: HostStreamConnection | null;
  /**
   * The unary requester, feeding BOTH creates. Named as both rather than as
   * one: the two client types are structurally identical, so declaring only
   * `CreateChatClient` compiles perfectly while telling the next reader this
   * screen creates chats and nothing else.
   */
  readonly hostClient: (CreateChatClient & CreateArtifactClient) | null;
  readonly epicId: string;
  readonly epic: FleetEpic | null;
  readonly now: number;
  readonly onBack: () => void;
  readonly onOpenAgent: (chatId: string, entry: EpicChatEntry) => void;
  readonly preview: EpicAgentsState | null;
}): ReactElement {
  // The hook runs either way — hooks cannot be conditional — but it is handed
  // a null connection under preview, so it opens no stream.
  const live = useEpicAgents(preview === null ? streamConnection : null, epicId);
  const agents = preview ?? live.agents;
  const configuredHostId =
    preview === null ? CONFIGURED_HOST_ID : AGENTS_FIXTURE_HOST;
  const authoring = useCreateAgent(hostClient, epicId, configuredHostId);
  const artifactAuthoring = useCreateArtifact(hostClient, epicId);
  /*
   * THE FIRST SCREEN IN THE SHELL, and deliberately the only one for now.
   *
   * This is the surface with the ~40s wait, so it is the only one where the
   * acceptance test — the frame is on screen BEFORE the epic data is — means
   * anything. The other ten would migrate on faith, and if the frame is wrong
   * we unpick one screen instead of eleven.
   *
   * The status derives from the SAME state the body renders from, so the
   * strip cannot say "live" while the list is still loading.
   */
  const connection: EpicConnectionState =
    agents.kind === "loading"
      ? { kind: "loading" }
      : agents.kind === "error"
        ? { kind: "error" }
        : { kind: "live" };
  // Into the FRAME's status region. Cleared automatically when this screen
  // unmounts, so a "live" pill never outlives the epic it describes.
  useShellStatus(connection);
  return (
    /*
     * NO NESTED SHELL. This rendered its own <AppShell> before the hoist,
     * so after it there were TWO — App's and this one, nested — and
     * navigating mounted the inner one. The mount counter read 1 -> 2 and
     * caught it; the DOM probe had reported the header as the same node
     * throughout, which is the measurement lying rather than the app.
     *
     * The status row is PUBLISHED to the frame, not rendered here. It used to
     * sit at the top of this screen's content, which kept one shell — the
     * property that matters — and cost the row its pinning: it scrolled away
     * as soon as the epic's rows arrived, so the pill vanished exactly when
     * there was something to be status about. `useShellStatus` is the slot
     * that debt bought.
     */
    <div className={styles.screen}>
      <EpicDetail
        // The row that was clicked, else the header from `earlyMeta` — which
        // lands in ~543ms, so a DEEP LINK stops showing a bare id after half a
        // second instead of after forty-seven.
        epic={epic ?? live.header}
        epicId={epicId}
        onBack={onBack}
        agents={agents}
        configuredHostId={configuredHostId}
        now={preview === null ? now : AGENTS_FIXTURE_NOW}
        onOpenArtifact={() => {
          // Artifact reading lands next; a no-op keeps the affordance honest
          // about being unfinished rather than silently doing nothing.
        }}
        onOpenAgent={onOpenAgent}
      />
      {/*
        NO NAVIGATION ON SUCCESS, deliberately. Jumping to the new chat would
        need an `EpicChatEntry`, and the only way to have one here is to
        fabricate it from the request we just sent — inventing a row that
        claims to be replicated state. The agents stream is already open on
        this screen and delivers the real entry within its normal update, so
        the new agent appears in the tree above on its own. Slower by a beat,
        and it is the host's row rather than our guess at it.
      */}
      <Subtitle1>New agent</Subtitle1>
      <AuthorAgent
        configuredHostId={configuredHostId}
        phase={authoring.phase}
        onCreate={authoring.create}
      />
      <Subtitle1>New artifact</Subtitle1>
      <CreateArtifact
        phase={artifactAuthoring.phase}
        onCreate={artifactAuthoring.create}
      />
    </div>
  );
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
  userId,
  preview,
  agentsPreview,
  waitingPreview,
}: {
  readonly styles: Record<string, string>;
  readonly auth: HostConnectionAuth & StreamConnectionAuth;
  /**
   * The signed-in user's id, stamped as a new epic's `createdBy`.
   *
   * Empty under preview and while the identity is still resolving, which
   * REFUSES the create rather than substituting a placeholder — `createdBy` is
   * what `epic.listTasks`' ownership filter compares against, so a wrong value
   * makes an epic its own creator cannot see.
   */
  readonly userId: string;
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
  readonly agentsPreview: EpicAgentsState | null;
  readonly waitingPreview: AttentionState | null;
}): ReactElement {
  const [connection] = useState(() =>
    preview === null ? createTabHostConnection(auth) : null,
  );
  // One stream client for the screen's lifetime — a new one per render would
  // re-dial the socket continuously. Not built at all in preview, so the
  // "no path from here reads the host" property holds for the stream too.
  const [streamConnection] = useState(() =>
    preview === null && HOST_WS_URL !== ""
      ? new HostStreamConnection(auth, {
          hostWsUrl: HOST_WS_URL,
          hostId: CONFIGURED_HOST_ID,
        })
      : null,
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
  const [openedChat, setOpenedChat] = useState<EpicChatEntry | null>(null);
  // Null under preview, so no path from this screen can create against a host.
  const epicAuthoring = useCreateEpic(
    connection?.hostClient ?? null,
    CONFIGURED_HOST_ID,
    userId,
  );
  // The list is the confirmation. Reloading on success means the new epic
  // appears as the HOST's row rather than as our echo of the request.
  const createdEpicId = epicAuthoring.createdEpicId;
  useEffect(() => {
    if (createdEpicId === null) return;
    reload();
  }, [createdEpicId, reload]);

  if (route.name === "waiting") {
    return (
      <WaitingScreen
        styles={styles}
        streamConnection={streamConnection}
        listClient={connection?.hostClient ?? null}
        // The FIXTURE clock under preview. Passing the real one floors every
        // age to "now" — the fixture timestamps sit ahead of it, so
        // `max(0, now - at)` is zero for all of them and the oldest-first
        // sort becomes unverifiable. Caught in the image, not the types.
        now={waitingPreview === null ? now : ATTENTION_NOW}
        preview={waitingPreview}
      />
    );
  }

  if (route.name === "chat") {
    return (
      <ChatRoute
        styles={styles}
        streamConnection={streamConnection}
        epicId={route.epicId}
        chatId={route.chatId}
        // The agent row that opened it, so locality is known immediately. A
        // DEEP LINK has none, and the chat screen treats that as unknown —
        // not actionable — rather than assuming local.
        entry={openedChat}
        now={now}
        onBack={() => {
          navigate({ name: "epic", epicId: route.epicId });
        }}
      />
    );
  }

  if (route.name === "epic") {
    return (
      <EpicScreen
        styles={styles}
        preview={agentsPreview}
        streamConnection={streamConnection}
        // The UNARY client, not the stream one: `epic.createChat` is a
        // request/response call, and it is null under preview so the
        // "no path from here reaches the host" property still holds.
        hostClient={connection?.hostClient ?? null}
        epicId={route.epicId}
        epic={opened !== null && opened.id === route.epicId ? opened : null}
        now={now}
        onBack={() => {
          navigate({ name: "epics" });
        }}
        onOpenAgent={(chatId, entry) => {
          setOpenedChat(entry);
          navigate({ name: "chat", epicId: route.epicId, chatId });
        }}
      />
    );
  }

  return (
    <div className={styles.screen}>
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
      {/*
        NO NAVIGATION ON SUCCESS, and no fabricated row — the same rule the
        agent create follows, reached the same way. Jumping to the new epic
        would mean either inventing a `FleetEpic` from the request we just sent
        (a row claiming to be replicated state) or landing on a detail screen
        with nothing to show. Reloading asks the host and lets its own row
        arrive in the list above.
      */}
      <Subtitle1>New epic</Subtitle1>
      <CreateEpicForm
        configuredHostId={CONFIGURED_HOST_ID}
        userId={userId}
        phase={epicAuthoring.phase}
        onCreate={(instruction) => {
          epicAuthoring.create(instruction);
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

  /**
   * ONE frame, for every route.
   *
   * Before this, each of ten routes returned its own `<FluentProvider>` — nine
   * providers and zero shells, which is "the thing that should be common is
   * per-route and the thing that should differ is identical", one level up
   * from the eleven `page` styles.
   *
   * WHY A HELPER RATHER THAN TEN `<AppShell>` WRAPPERS. Wrapping each route
   * individually gives ten shells. Each would subtract its viewport height
   * correctly, pass the containment gate, and screenshot perfectly — and the
   * header would REMOUNT on every navigation, so "persistent region" would be
   * false in exactly the way that matters. A verification agreeing with the
   * wrong answer.
   *
   * Every route now renders `FluentProvider > AppShell > content` at the same
   * position with the same element types, so React reconciles them as one
   * instance and the header node SURVIVES navigation. That is a runtime
   * property, not a source-count one: a single shell rendered conditionally,
   * keyed by route, or remounted by a parent would still tear down and the
   * count would stay 1. There is a test that navigates and asserts the header
   * is the SAME NODE, because a remount produces an identical-looking element
   * that passes every assertion about content.
   */
  const shell = (content: ReactElement | null): ReactElement => (
    <FluentProvider theme={themeFor(ready ? themeName : "default")}>
      <AppShell leading={<Text weight="semibold">Traycer</Text>}>
        {content}
      </AppShell>
    </FluentProvider>
  );

  // Nothing paints until initialize settles either way — a flash of the light
  // theme before switching to dark is the sort of thing that reads as cheap.
  if (!ready) return shell(null);

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
  // Every action phase at once. Not a route: it is a review surface for the
  // states that are hardest to reach by hand.
  const showApprovals = !inTeams && params.get("preview") === "approvals";

  /**
   * The chat surface with a realistic block mix. The chips, the interview
   * card and the approval row have never been seen together at phone width,
   * and that is the densest combination in the app.
   */
  const showChat = !inTeams && params.get("preview") === "chat";
  const showArtifact = !inTeams && params.get("preview") === "artifact";
  const showComments = !inTeams && params.get("preview") === "comments";
  const showAuthoring = !inTeams && params.get("preview") === "authoring";

  const waitingPreview = ((): AttentionState | null => {
    if (inTeams || params.get("preview") !== "waiting") return null;
    switch (params.get("state")) {
      case "loading":
        return { kind: "loading" };
      case "error":
        return { kind: "error", detail: "stream closed — host unreachable" };
      // The state most users see most often, and the reason it has its own
      // URL: "nothing is waiting" is unreachable on demand otherwise.
      case "empty":
        return { kind: "ready", items: [], summary: null, epicTitles: {} };
      default:
        return {
          kind: "ready",
          items: ATTENTION_FIXTURE,
          summary: null,
          // One title resolved and one deliberately MISSING, so the shot
          // shows both the resolved name and the labelled-id fallback.
          epicTitles: {
            "e1000000-0000-4000-8000-000000000001": "Streaming Transport Reconnect",
          },
        };
    }
  })();

  const agentsPreview = ((): EpicAgentsState | null => {
    if (inTeams || params.get("preview") !== "agents") return null;
    switch (params.get("state")) {
      case "loading":
        return { kind: "loading", phase: "connecting" };
      // The state that was unreachable and therefore unreviewed until it
      // reached Elliot as a thirty-second lie.
      case "retrying":
        return { kind: "loading", phase: "retrying" };
      // Five levels, so the indent cap is reviewable at 380px rather than
      // discovered there.
      case "deep":
        return {
          kind: "ready",
          chats: AGENTS_DEEP_FIXTURE,
          tree: buildChatTree(AGENTS_DEEP_FIXTURE),
          artifacts: buildArtifactTree(ARTIFACTS_FIXTURE),
        };
      case "error":
        return {
          kind: "error",
          detail: "stream closed — host unreachable",
        };
      case "empty":
        return {
          kind: "ready",
          chats: [],
          tree: buildChatTree([]),
          artifacts: buildArtifactTree([]),
        };
      default:
        return {
          kind: "ready",
          chats: AGENTS_FIXTURE,
          tree: buildChatTree(AGENTS_FIXTURE),
          artifacts: buildArtifactTree(ARTIFACTS_FIXTURE),
        };
    }
  })();

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
  // ANY preview skips the gate, not just the epics one. The first version
  // named `previewState` specifically, so `?preview=agents` still hit the
  // config screen — and fifteen agent screenshots came out as that screen,
  // for the second time. Fixing the instance rather than the class is what
  // let it recur; `previewing` is the class.
  const previewing =
    previewState !== null ||
    agentsPreview !== null ||
    waitingPreview !== null ||
    showApprovals ||
    showChat ||
    showArtifact ||
    showComments ||
    showAuthoring;
  const problems = previewing ? [] : configProblems();
  if (problems.length > 0) {
    return shell(
        <div className={styles.screen}>
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
        </div>,
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
  if (restoring && !previewing) {
    return shell(
        <div className={styles.screen}>
          <FleetLoading rows={3} />
        </div>,
    );
  }

  if (showAuthoring) {
    // `state=nohost` renders the REFUSAL — the state nobody hits by hand and
    // the one that matters most, since it is what prevents a permanent wrong
    // host id in someone's data.
    // SYNTHETIC, and it must stay that way. This was a real host GUID, copied
    // in to make the disclosure look right — a host id identifies a MACHINE,
    // which the OSS rule names, and `oss-hygiene` did not catch it because
    // that gate matches known values and this one was not on the list.
    //
    // The tell was the shape: every other fixture in this file is
    // `a1000000-…-000000000001`, and this was the only UUID here with real
    // random entropy. Entropy in a fixture means it was copied from
    // somewhere. Keeping the house pattern is what makes the next one
    // visible at a glance.
    const hostForPreview =
      params.get("state") === "nohost" ? "" : "f1000000-0000-4000-8000-000000000001";
    // `state=unconfirmed` puts the two creates side by side in their failed
    // state, which is the ONLY view where the finding is visible: identical
    // forms, identical failure, opposite instructions. Nobody reaches this
    // pair by hand — it needs two RPCs to fail — and it is the thing most
    // worth looking at, so it gets a preview rather than a description.
    const unconfirmed = params.get("state") === "unconfirmed";
    // `state=noidentity` is the epic form's OWN refusal, and it has no
    // counterpart above: the other two creates need only a host, while
    // `epic.create` also stamps `createdBy`. Empty means the identity has not
    // resolved yet, and creating then files the epic under an owner that
    // `epic.listTasks` will not match — an epic its own creator cannot see.
    // Synthetic, house pattern, per the note above.
    const userForPreview =
      params.get("state") === "noidentity"
        ? ""
        : "a1000000-0000-4000-8000-000000000001";
    return shell(
        <div className={styles.screen}>
          <Subtitle1>New agent</Subtitle1>
          <AuthorAgent
            configuredHostId={hostForPreview}
            phase={
              unconfirmed
                ? {
                    kind: "unconfirmed",
                    reason: "socket closed",
                    retry: "idempotent",
                  }
                : { kind: "idle" }
            }
            onCreate={() => undefined}
          />
          <Subtitle1>New artifact</Subtitle1>
          <CreateArtifact
            phase={
              unconfirmed
                ? {
                    kind: "unconfirmed",
                    reason: "socket closed",
                    // SAME failure as the agent above, opposite advice. The
                    // difference is `createArtifact` taking no client id.
                    retry: "may-duplicate",
                  }
                : { kind: "idle" }
            }
            onCreate={() => undefined}
          />
          {/*
            THE THIRD ADVICE, and the reason this form belongs in the same
            preview rather than one of its own. Under `state=unconfirmed` the
            screen now shows three identical-looking creates failing the same
            way: the agent says press it again, the artifact and the epic say
            go and look. That the epic sides with the artifact is not obvious
            from the UI — `epicLightSchema.id` simply carries no dedupe rule —
            so the comparison is the only place it is legible.
          */}
          <Subtitle1>New epic</Subtitle1>
          <CreateEpicForm
            configuredHostId={hostForPreview}
            userId={userForPreview}
            phase={
              unconfirmed
                ? {
                    kind: "unconfirmed",
                    reason: "socket closed",
                    // Not a copy of the artifact's — `EPIC_CREATE_RETRY` is
                    // the value the hook actually sends, so this preview
                    // cannot drift from the wording a real failure produces.
                    retry: EPIC_CREATE_RETRY,
                  }
                : { kind: "idle" }
            }
            onCreate={() => undefined}
          />
        </div>,
    );
  }

  if (showComments) {
    return shell(
        <div className={styles.screen}>
          <Subtitle1>Comments</Subtitle1>
          <CommentsPanel
            threads={COMMENTS_FIXTURE}
            now={COMMENTS_FIXTURE_NOW}
            busyThreadId={params.get("state") === "pending" ? "th-1" : null}
            onReply={() => undefined}
            onSetResolved={() => undefined}
          />
        </div>,
    );
  }

  if (showArtifact) {
    return shell(
        <div className={styles.screen}>
          <Subtitle1>{ARTIFACT_FIXTURE_TITLE}</Subtitle1>
          <ArtifactMarkdown body={ARTIFACT_FIXTURE_BODY} />
        </div>,
    );
  }

  if (showChat) {
    const phase = params.get("state");
    return shell(
        <div className={styles.screen}>
          <ChatScreen
            controller={{
              state: {
                kind: "ready",
                approvals: [
                  {
                    approvalId: "ap-1",
                    toolName: "Edit",
                    description:
                      "Write clients/teams-tab/src/config.ts (+34 −6). Adds the zod schema and keeps the per-variable messages.",
                    input: null,
                    requestedAt: CHAT_FIXTURE_NOW - 3 * 60_000,
                    kind: "tool",
                    planId: null,
                    actions: [],
                  },
                ],
                messages: CHAT_FIXTURE,
                title: CHAT_FIXTURE_TITLE,
                access: { canAct: true, role: "owner" },
              },
              phases:
                phase === "pending"
                  ? { "ap-1": { kind: "pending", verb: "Approving" } }
                  : phase === "unconfirmed"
                    ? {
                        "ap-1": {
                          kind: "unconfirmed",
                          reason: "reconcile window expired",
                        },
                      }
                    : {},
              approve: () => undefined,
              reject: () => undefined,
              answerInterview: () => undefined,
            }}
            entry={{
              chatId: "c1",
              title: CHAT_FIXTURE_TITLE,
              parentId: null,
              createdAt: CHAT_FIXTURE_NOW,
              updatedAt: CHAT_FIXTURE_NOW,
              hostId: "h-alpha",
            }}
            configuredHostId="h-alpha"
            now={CHAT_FIXTURE_NOW}
            onBack={() => undefined}
          />
        </div>,
    );
  }

  if (showApprovals) {
    return shell(
        <div className={styles.screen}>
          <Subtitle1>Approval states</Subtitle1>
          <ApprovalsPreview />
        </div>,
    );
  }

  if (status.kind !== "signed-in" && !previewing) {
    return shell(
        <SignIn
          status={status}
          onSignIn={() => void auth.signIn()}
          onCancel={() => {
            auth.cancelSignIn();
          }}
        />,
    );
  }


  return shell(
      <EpicsScreen
        styles={styles}
        auth={auth}
        // Empty unless genuinely signed in — under preview this is "" and the
        // create refuses, which keeps "no path from preview reaches the host"
        // true for authoring as well as for reading.
        userId={status.kind === "signed-in" ? status.user.user.id : ""}
        preview={previewState}
        agentsPreview={agentsPreview}
        waitingPreview={waitingPreview}
      />,
  );
}
