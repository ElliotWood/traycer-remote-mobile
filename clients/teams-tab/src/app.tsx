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
import { useCallback, useEffect, useState, type ReactElement } from "react";
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
import { ErrorBoundary } from "./shell/error-boundary";
import { type EpicConnectionState } from "./shell/epic-status-row";
import { useShellStatus } from "./shell/shell-status";
import { toEpicConnectionState } from "./shell/epic-connection";
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
import { CHAT_FIXTURE_BLOCK_TREES } from "./chat/chat-blocks-fixture";
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
import {
  toAttentionState,
  type AttentionState,
} from "./attention/attention-state";
import {
  useNotifications,
  type NotificationsState,
} from "./notifications/use-notifications";
import { NotificationsScreen } from "./notifications/notifications-screen";
import { NOTIFICATIONS_FIXTURE, NOTIFICATIONS_NOW } from "./notifications/notifications-fixture";
import { useShellNotifications } from "./shell/shell-notifications";
import { epicDisplayName, type FleetEpic } from "@traycer-clients/shared/epic/epic-list";
import { CanvasScreen } from "./canvas/canvas-screen";
import { EMPTY_CANVAS, type CanvasState } from "./canvas/canvas-state";
import {
  createTabHostConnection,
  type HostConnectionAuth,
} from "./host/connection";
import { themeFor } from "./theme/teams-theme";
import { configProblems } from "./config";
import { SignIn } from "./auth/sign-in";
import { SignOutButton } from "./auth/sign-out-button";
import { useAuthService, useAuthStatus } from "./auth/use-auth";
import { useTeamsTheme } from "./theme/use-teams-theme";

/**
 * One timestamp for every preview fixture, captured at module load.
 *
 * `Date.now()` at these call sites was an impure call DURING RENDER - caught
 * by `react-hooks`, and wrong for a second reason the lint rule does not
 * know about: it re-evaluates every render, so a `stale` fixture's age would
 * tick upward while the user looks at it, which is a live clock dressed as a
 * frozen fixture. A screenshot taken twice would differ.
 */
const PREVIEW_EPOCH = Date.now();

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
  diffClient,
  epicId,
  chatId,
  entry,
  now,
  onBack,
}: {
  readonly styles: Record<string, string>;
  readonly streamConnection: HostStreamConnection | null;
  /** The unary client — the transcript's diff bodies are requests, not frames. */
  readonly diffClient: EpicListClient | null;
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
        diffClient={diffClient}
        now={now}
        onBack={onBack}
      />
    </div>
  );
}

/**
 * "Waiting on you" — the cross-epic attention slice.
 *
 * NO LONGER OWNS A SUBSCRIPTION. It used to open
 * `host.notifications.feed.subscribe` itself, which was right while it was the
 * only consumer and became wrong when the frame's bell arrived: the bell needs
 * a count on every screen, and this component only mounts on one route. The
 * stream is hoisted to `EpicsScreen` and this is now a projection of it — see
 * `notifications/use-notifications.ts`.
 */
function WaitingScreen({
  styles,
  state,
  now,
}: {
  readonly styles: Record<string, string>;
  readonly state: AttentionState;
  readonly now: number;
}): ReactElement {
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
  /*
   * The mapping moved to `shell/epic-connection.ts`. It lived here as a
   * ternary chain that produced THREE of `EpicConnectionState`'s four
   * members - `stale` was never constructed, so the strip's `stale` branch,
   * which renders the age and says in its own comment that the age is the
   * whole decision, could not appear on screen.
   *
   * A chain is where that hides: adding a union member does not break one,
   * it just quietly never produces it.
   */
  const connection: EpicConnectionState = toEpicConnectionState({
    agents,
    now,
  });
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
  notificationsPreview,
  hostClientType,
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
  readonly notificationsPreview: NotificationsState | null;
  /** Threaded to the temporary viewport readout. See that file. */
  readonly hostClientType: string | null;
}): ReactElement {
  /**
   * ANY preview suppresses the connection, not just the epics one.
   *
   * This gate read `preview === null`, and `preview` is the EPICS preview
   * specifically — so `?preview=waiting`, `?preview=agents` and
   * `?preview=notifications` all fell through it and built a real
   * `HostClient`, with `useEpics` then issuing a live `epic.listTasks`. The
   * screens still rendered their fixtures, so nothing looked wrong.
   *
   * That made App's stated property — *"no code path reachable from here ever
   * reads the host … enforced by the WIRING"* — true only of the one preview
   * it was first written for. It is the same instance-versus-class mistake
   * recorded a few lines below it, where naming `previewState` rather than the
   * class sent `?preview=agents` to the config screen for the second time.
   *
   * Widened to the class here. Any preview state set means no connection is
   * constructed at all, which is what the docblock has always claimed.
   */
  const previewing =
    preview !== null ||
    agentsPreview !== null ||
    waitingPreview !== null ||
    notificationsPreview !== null;
  const [connection] = useState(() =>
    previewing ? null : createTabHostConnection(auth),
  );
  // One stream client for the screen's lifetime — a new one per render would
  // re-dial the socket continuously. Not built at all in preview, so the
  // "no path from here reads the host" property holds for the stream too.
  const [streamConnection] = useState(() =>
    !previewing && HOST_WS_URL !== ""
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
  /*
   * The canvas layout, held here rather than inside `CanvasScreen`, so it
   * survives navigating away to a chat and back. Not persisted yet — see the
   * `canvas` case below and `canvas-screen.tsx`'s docblock for why that is one
   * more commit rather than one more line.
   */
  const [canvas, setCanvas] = useState<CanvasState>(EMPTY_CANVAS);
  // Null under preview, so no path from this screen can create against a host.
  const epicAuthoring = useCreateEpic(
    connection?.hostClient ?? null,
    CONFIGURED_HOST_ID,
    userId,
    // The real clock, stated. The hook no longer defaults it — see its
    // docblock; a defaulted `Date.now` is how a test ends up reading the wall
    // clock without anyone having chosen that.
    Date.now,
  );
  // The list is the confirmation. Reloading on success means the new epic
  // appears as the HOST's row rather than as our echo of the request.
  const createdEpicId = epicAuthoring.createdEpicId;
  useEffect(() => {
    if (createdEpicId === null) return;
    reload();
  }, [createdEpicId, reload]);

  /**
   * THE ONE notification subscription, opened here rather than on the screens
   * that render it.
   *
   * Here because this is the component that owns the connection AND outlives
   * every route below it — which is what an app-level bell requires. Opening
   * it on the waiting screen (where it used to live) gave the bell a count
   * only while you were already looking at the list.
   *
   * Null connection under preview, so no path from a preview reaches the host.
   */
  // Both are already `null` under any preview — the gate is the wiring above,
  // not a second conditional here. Re-checking `previewing` at every use is
  // how the first version ended up guarding one preview and missing three.
  const notificationsLive = useNotifications(
    streamConnection,
    connection?.hostClient ?? null,
  );
  const notifications: NotificationsState =
    notificationsPreview ?? notificationsLive;

  /**
   * Stable, and it has to be: it sits in the publishing effect's dependency
   * list, so a fresh closure each render would republish each render. See
   * `shell/shell-notifications.tsx`.
   */
  const openNotifications = useCallback(() => {
    navigate({ name: "notifications" });
  }, [navigate]);

  /**
   * Into the FRAME's trailing cluster.
   *
   * PUBLISHED UNDER PREVIEW TOO, deliberately, and it is the one host-touching
   * rule this file has that this does not break: `openNotifications` is
   * `navigate`, which is `history.pushState` and nothing else. No host, no
   * socket, no request. Withholding it would have cost the bell its only
   * reviewable states — the badge, the unread dot and the not-yet-known dot
   * are exactly what the preview URLs exist to photograph.
   */
  useShellNotifications(
    notifications.kind === "ready" ? notifications.summary : null,
    openNotifications,
  );

  /*
   * EXHAUSTIVE DISPATCH, and it takes a `switch` for that word to mean
   * anything.
   *
   * This was a chain of `if (route.name === …)` returns with an unguarded
   * trailing `return` for the epics list. That shape compiles clean when
   * `Route` grows a member and renders the TRAILING branch for it — so a new
   * route deep-links to the epics list, which is indistinguishable from the
   * user having typed a bad URL.
   *
   * MEASURED BEFORE CHANGING IT, because "the union is discriminated so the
   * compiler will find every consumer" is exactly the kind of claim this
   * project has learned to distrust. A probe member added to `Route` and
   * `tsc -b --force` run produced ONE error — `routeToPath`, the path builder.
   * This file, the thing that puts a route on a screen, produced none.
   *
   * It is the defect this file already documents about ITSELF thirty lines
   * up, in the opposite direction: `toEpicConnectionState` was extracted
   * because a ternary chain never PRODUCES a new union member. A dispatch
   * chain never CONSUMES one. The `never` below is what turns the next
   * addition into a compile error instead of a wrong screen.
   */
  switch (route.name) {
    case "waiting":
      return (
        <WaitingScreen
          styles={styles}
          state={waitingPreview ?? toAttentionState(notifications)}
          // The FIXTURE clock under preview. Passing the real one floors every
          // age to "now" — the fixture timestamps sit ahead of it, so
          // `max(0, now - at)` is zero for all of them and the oldest-first
          // sort becomes unverifiable. Caught in the image, not the types.
          now={waitingPreview === null ? now : ATTENTION_NOW}
        />
      );

    case "notifications":
      return (
        <div className={styles.screen}>
          <NotificationsScreen
            state={notifications}
            // Already null under any preview, so the writes are disabled rather
            // than faked — the same property every other preview surface holds.
            client={connection?.hostClient ?? null}
            now={notificationsPreview === null ? now : NOTIFICATIONS_NOW}
            onOpenChat={(epicId, chatId) => {
              navigate({ name: "chat", epicId, chatId });
            }}
            onOpenEpic={(epicId) => {
              navigate({ name: "epic", epicId });
            }}
          />
        </div>
      );

    case "chat":
      return (
        <ChatRoute
          styles={styles}
          streamConnection={streamConnection}
          diffClient={connection?.hostClient ?? null}
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

    case "epic":
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

    /*
     * BESIDE the `epic` case above, not replacing it. Both routes address the
     * same epic and mean different things: `epic` is a list you read, this is
     * a workspace you arrange. Nothing above changed.
     *
     * The layout is held in THIS component's state rather than the canvas's,
     * so it survives navigating to a chat and back — and it is deliberately
     * not persisted yet. `browserCanvasStorage(epicId)` is per-epic and the
     * naive wiring shows one epic's layout under another's key; that lands
     * with its own test rather than as a line in this one.
     */
    case "canvas":
      return (
        <CanvasScreen
          epicId={route.epicId}
          // Same rule as the detail screen: the row that was clicked when
          // there was one, and nothing invented when there was not.
          epicName={
            opened !== null && opened.id === route.epicId
              ? epicDisplayName(opened)
              : null
          }
          state={canvas}
          onChange={setCanvas}
          onBack={() => {
            navigate({ name: "epic", epicId: route.epicId });
          }}
        />
      );

    /*
     * NAMED, not trailing. This was the fallthrough `return` at the bottom of
     * the function, which made it the screen for the epics route AND the
     * screen for every route nobody had written yet. Those are two jobs and
     * only one of them was intended.
     *
     * Unknown PATHS still resolve here — `parseRoute` maps them to `epics`
     * deliberately, with its reason on the record. That is a decision about
     * strings arriving from outside. This is a decision about members of a
     * union we control, and it is the opposite one.
     */
    case "epics":
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
            hostClientType={hostClientType}
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
            would mean either inventing a `FleetEpic` from the request we just
            sent (a row claiming to be replicated state) or landing on a detail
            screen with nothing to show. Reloading asks the host and lets its
            own row arrive in the list above.
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

    default: {
      // The whole point of the switch. `route` is `never` here only while
      // every member above is handled; the day one is not, this line is the
      // error — instead of a new route quietly rendering the epics list.
      const unhandled: never = route;
      return unhandled;
    }
  }
}

export function App(): ReactElement {
  const styles = useStyles();
  const { themeName, inTeams, ready, hostClientType } = useTeamsTheme();
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
      <AppShell
        leading={<Text weight="semibold">Traycer</Text>}
        /*
         * SIGN-OUT LIVES IN THE FRAME, not on a screen.
         *
         * The states where you most want out — signed in as the wrong
         * principal, a screen throwing, a shared machine — are exactly the
         * states where navigating to a settings screen is least reliable. The
         * trailing slot survives navigation and survives a screen error,
         * because the in-frame boundary below replaces the SCREEN and leaves
         * the header standing.
         *
         * Absent unless genuinely signed in: under preview there is no
         * session to end, and rendering a dead control would be the
         * "affordance that silently does nothing" this project keeps finding.
         */
        trailing={
          status.kind === "signed-in" ? (
            <SignOutButton
              userId={status.user.user.id}
              onSignOut={() => {
                auth.signOut();
              }}
            />
          ) : null
        }
      >
        {/*
          THE IN-FRAME BOUNDARY, and it belongs here rather than around each
          returned screen for the same reason the shell itself does.
          Twelve wrappers would be twelve boundaries at twelve positions;
          this is ONE, at one reconciled position, so the header still
          survives navigation and `shell-contract`'s property is untouched.

          What it buys over the root boundary in `main.tsx`: a screen that
          throws loses the SCREEN, not the frame. The header, the theme and
          the status region stay, so the tab still looks like Traycer and the
          user can see where they are — where the root boundary replaces the
          entire document with a message on a bare background.

          The root one is still the backstop for this one: its fallback is
          plain DOM but it renders inside `FluentProvider`, so if the throw
          came from the provider or the theme, this boundary goes down with
          it and `main.tsx` catches what is left.
        */}
        <ErrorBoundary label="this screen">{content}</ErrorBoundary>
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

  /**
   * `?preview=notifications[&state=…]` renders the bell surface without a host.
   *
   * The states that ship broken are the ones that are hard to reach: `empty`
   * needs an account nothing has happened on, `loading` lasts a moment, and
   * the four severities together need four different things to go wrong at
   * once. A query param turns each into a URL — the loop that has caught
   * nearly every UI defect on this project.
   */
  const notificationsPreview = ((): NotificationsState | null => {
    if (inTeams || params.get("preview") !== "notifications") return null;
    switch (params.get("state")) {
      case "loading":
        return { kind: "loading" };
      case "error":
        return { kind: "error", detail: "stream closed — host unreachable" };
      case "empty":
        // A summary of ZEROES, not null: this is the "you're all caught up"
        // shot, and null would render the still-loading bell instead.
        return {
          kind: "ready",
          entries: [],
          summary: { unreadCount: 0, attentionCount: 0 },
          epicTitles: {},
        };
      /*
       * NO `unknown` STATE HERE, and its absence is the finding.
       *
       * There was one — `ready` with a null summary — meant to photograph the
       * bell before its first snapshot. The image showed the bell's grey
       * not-yet-known dot above a body reading "You're all caught up.", which
       * is the conflation the bell exists to prevent, on the same screen.
       *
       * It is unreachable now: `use-notifications` refuses to leave `loading`
       * for a frame that carried no feed state, which was the only way to
       * reach `ready` without a summary. Modelling it here would be a preview
       * URL for a state the client cannot produce — and it rendered the wrong
       * copy while pretending otherwise.
       *
       * The bell's not-yet-known dot is `loading`'s, and `?state=loading`
       * already shoots it.
       */
      default:
        return {
          kind: "ready",
          entries: NOTIFICATIONS_FIXTURE,
          summary: { unreadCount: 4, attentionCount: 2 },
          epicTitles: {},
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
          updatedAt: PREVIEW_EPOCH,
          connected: true,
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
          updatedAt: PREVIEW_EPOCH,
          connected: true,
        };
      /*
       * THE STATE THAT COULD NOT BE PRODUCED ON DEMAND, which is part of why
       * it went unbuilt: `stale` had a renderer, an age, and a comment
       * explaining that the age is the whole decision - and no route, no
       * fixture and no producer. Nobody could look at it.
       *
       * Seventeen minutes so the label is a real interval rather than
       * "0s ago", which reads as a rendering fault rather than as an age.
       */
      case "stale":
        return {
          kind: "ready",
          chats: AGENTS_FIXTURE,
          tree: buildChatTree(AGENTS_FIXTURE),
          artifacts: buildArtifactTree(ARTIFACTS_FIXTURE),
          updatedAt: PREVIEW_EPOCH - 17 * 60_000,
          connected: false,
        };
      default:
        return {
          kind: "ready",
          chats: AGENTS_FIXTURE,
          tree: buildChatTree(AGENTS_FIXTURE),
          artifacts: buildArtifactTree(ARTIFACTS_FIXTURE),
          updatedAt: PREVIEW_EPOCH,
          connected: true,
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
    notificationsPreview !== null ||
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
                blockTrees: CHAT_FIXTURE_BLOCK_TREES,
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
            // No host under preview, so the diff bodies report that rather
            // than spinning. The cards themselves are the subject here.
            diffClient={null}
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
        notificationsPreview={notificationsPreview}
        hostClientType={hostClientType}
      />,
  );
}
