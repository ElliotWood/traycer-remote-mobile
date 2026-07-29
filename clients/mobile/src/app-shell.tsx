/**
 * The signed-in app shell (T4): routes the Fleet → Epic → Chat drilldown.
 *
 * Owns the in-memory navigation stack (`navReducer`) and renders the view for
 * the current route. Fleet is live now; the Epic and Chat cases are route slots
 * that T5/T6 replace with their real views. The `client` is guaranteed non-null
 * by the gate (`selectAppScreen` only reaches here when a host is configured).
 *
 * Sprint 4's proof surface: `?comments=1&epicId=&artifactType=&artifactId=`
 * renders the standalone `CommentsPanel` full-screen instead of the drilldown
 * - reachable only after this real sign-in gate (a real bearer, no auth
 * bypass), so the Evaluator can drive comments live in a real browser without
 * Sprint 3's artifact tree existing in this worktree.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useState, type ReactElement } from "react";
import {
  currentRoute,
  INITIAL_NAV_STACK,
  navReducer,
  type Route,
} from "@/router/nav";
import type { MobileHostClient } from "@/host/host-client-context";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostNotifications } from "@/host/use-host-notifications";
import { useScreenWakeLock, useWakeLockPreference } from "@/host/use-screen-wake-lock";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import { FleetView } from "@/views/fleet-view";
import { EpicView } from "@/views/epic-view";
import { CommentsPanel } from "@/views/comments/comments-panel";
import { parseCommentsHarnessParams } from "@/views/comments/comments-harness-params";
import { ErrorBoundary } from "@/views/error-boundary";
import { CurrentEpicProvider } from "@/host/current-epic-context";
import { ArtifactNavProvider } from "@/host/artifact-nav-context";
import { TopAppBar } from "@/views/toolbar/top-app-bar";
import { AccountSheet } from "@/views/toolbar/account-sheet";
import { UsageSheet } from "@/views/toolbar/usage-sheet";
import { NotificationsScreen } from "@/views/toolbar/notifications-screen";
import { SettingsScreen } from "@/views/toolbar/settings-screen";

/**
 * Perf batch 2 (B2-2): `ChatView` and `ArtifactRouteView` (→ `ArtifactBodyView`)
 * are the only routes that pull in the markdown stack (`react-markdown` +
 * `unified` + `micromark` + `parse5` via `rehypeRaw` — 316,198 raw / 98,493
 * gzip measured) — the first screen after sign-in is Fleet, which renders no
 * markdown at all. Lazy-loading these two keeps that stack out of the entry
 * chunk until the user actually opens a chat or artifact.
 */
const ChatView = lazy(() => import("@/views/chat-view").then((mod) => ({ default: mod.ChatView })));
const ArtifactRouteView = lazy(() =>
  import("@/views/artifact-route-view").then((mod) => ({ default: mod.ArtifactRouteView })),
);

/** Minimal, brief-by-design fallback — chunk load, not a data fetch (the real "Loading…" states live inside the lazy views themselves). */
function RouteLoadingFallback(): ReactElement {
  return (
    <div role="status" style={{ padding: 16, color: "var(--muted-foreground)", fontSize: 14 }}>
      Loading…
    </div>
  );
}

/** Live chat title override, scoped to a `chatId` so a screen change can never leak a stale title into the newly-rendered route for one frame (U2). */
interface LiveChatTitle {
  readonly chatId: string;
  readonly title: string | null;
}

/**
 * U2: the top bar always shows a title next to its back button — Fleet has
 * none to go back to, so it keeps the wordmark. `chat` prefers the LIVE
 * title (`liveTitle`, pushed by `ChatView` as `chat.title` resolves) over
 * the nav-time snapshot, but only when it's for the SAME chat currently
 * routed — a stale push from a just-left chat must never show through.
 */
function computeScreenTitle(route: Route, liveTitle: LiveChatTitle | null): string {
  switch (route.name) {
    case "fleet":
      return "Traycer";
    case "epic":
      return route.epicTitle ?? "Epic";
    case "chat":
      if (liveTitle !== null && liveTitle.chatId === route.chatId && liveTitle.title !== null) {
        return liveTitle.title;
      }
      return route.chatTitle ?? "Untitled chat";
    case "artifact":
      return "Artifact";
    case "notifications":
      return "Notifications";
    case "settings":
      return "Settings";
  }
}

interface AppShellProps {
  readonly client: MobileHostClient;
  readonly user: AuthenticatedUser | null;
  readonly onSignOut: () => void;
}

/** The shape `src/sw.ts`'s `notificationclick` handler posts to an open client. */
interface OpenChatMessage {
  readonly type: "open-chat";
  readonly epicId: string;
  readonly chatId: string;
}

function isOpenChatMessage(data: unknown): data is OpenChatMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "open-chat" &&
    typeof (data as { epicId?: unknown }).epicId === "string" &&
    typeof (data as { chatId?: unknown }).chatId === "string"
  );
}

export function AppShell({ client, user, onSignOut }: AppShellProps): ReactElement {
  const [stack, dispatch] = useReducer(navReducer, INITIAL_NAV_STACK);
  // "always" is held here, app-wide. The "while-running" variant lives in
  // ChatView instead, since only it knows whether a turn is in flight — the
  // two are mutually exclusive, so at most one lock is ever held.
  useScreenWakeLock(useWakeLockPreference() === "always");
  const route = currentRoute(stack);
  const streamConnection = useStreamConnectionOrNull();
  const { summary: notificationsSummary } = useHostNotifications(streamConnection);
  const [accountOpen, setAccountOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [liveChatTitle, setLiveChatTitle] = useState<LiveChatTitle | null>(null);
  // Stable identity (never reconstructed) so `ChatView`'s effect that calls
  // this doesn't refire on every AppShell render.
  const handleChatTitleChange = useCallback((chatId: string, title: string | null) => {
    setLiveChatTitle({ chatId, title });
  }, []);
  const canGoBack = stack.length > 1;

  // S5 (C, P1): a blocked-chat / background-push notification's click posts a
  // message to an existing client (see `src/sw.ts`'s `notificationclick`);
  // this is the one place that turns it into real navigation, reusing the
  // existing nav stack rather than adding URL routing. `goto-chat` replaces
  // the stack outright so clicking a notification can never duplicate an
  // epic/chat frame. Runs unconditionally (before the harness-route early
  // return below) so every hook in this component fires on every render.
  //
  // Push sprint: the SW sends this over a `MessageChannel` port and waits up
  // to 1s for an ack (see `sw.ts`'s `postOpenChatWithAck`) — if this listener
  // hasn't mounted yet (a narrow boot race right after a fresh tab opens),
  // the SW falls back to a real `navigate()` instead of the tap silently
  // doing nothing. Acking here is what lets the SW tell the two cases apart.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      if (!isOpenChatMessage(event.data)) {
        return;
      }
      dispatch({
        type: "goto-chat",
        epicId: event.data.epicId,
        chatId: event.data.chatId,
      });
      event.ports[0]?.postMessage({ type: "ack" });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  // Push sprint: cold-open deep-link. `sw.ts`'s `notificationclick` carries
  // the target chat in the reopen URL (`/?epicId=…&chatId=…`) when no
  // existing client was found to `postMessage` — precedented by this file's
  // own `?comments=1&…` harness params and `main.tsx`'s `?showcase=1`, both
  // boot-time `window.location.search` reads. One-shot (empty deps): fires
  // once on mount, then strips the params so they don't linger in the URL bar
  // or re-trigger on an unrelated re-render. Malformed/incomplete params
  // (only one of the two present, or either empty) are left alone — no
  // dispatch, the default Fleet stack stands.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const epicId = params.get("epicId");
    const chatId = params.get("chatId");
    if (epicId === null || epicId.length === 0 || chatId === null || chatId.length === 0) {
      return;
    }
    dispatch({ type: "goto-chat", epicId, chatId });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const harnessParams = useMemo(
    () => parseCommentsHarnessParams(window.location.search),
    [],
  );
  if (harnessParams !== null) {
    return <CommentsPanel {...harnessParams} />;
  }

  return (
    <ArtifactNavProvider dispatch={dispatch}>
      <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
        <TopAppBar
          user={user}
          title={computeScreenTitle(route, liveChatTitle)}
          onBack={canGoBack ? () => dispatch({ type: "back" }) : null}
          notificationsSummary={notificationsSummary}
          onOpenUsage={() => setUsageOpen(true)}
          onOpenNotifications={() => dispatch({ type: "open-notifications" })}
          onOpenAccount={() => setAccountOpen(true)}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{renderRoute()}</div>
        {accountOpen && (
          <AccountSheet
            user={user}
            onClose={() => setAccountOpen(false)}
            onOpenSettings={() => {
              setAccountOpen(false);
              dispatch({ type: "open-settings" });
            }}
            onSignOut={onSignOut}
          />
        )}
        {usageOpen && <UsageSheet onClose={() => setUsageOpen(false)} />}
      </div>
    </ArtifactNavProvider>
  );

  function renderRoute(): ReactElement {
    if (route.name === "fleet") {
      return (
        <ErrorBoundary label="the fleet" key={route.name}>
          <FleetView
            client={client}
            onSignOut={onSignOut}
            onOpenEpic={(epicId, epicTitle) =>
              dispatch({ type: "open-epic", epicId, epicTitle })
            }
          />
        </ErrorBoundary>
      );
    }

    if (route.name === "notifications") {
      return (
        <ErrorBoundary label="notifications" key={route.name}>
          <NotificationsScreen
            onOpenChat={(epicId, chatId) => dispatch({ type: "goto-chat", epicId, chatId })}
            onOpenEpic={(epicId) => dispatch({ type: "open-epic", epicId, epicTitle: "" })}
          />
        </ErrorBoundary>
      );
    }

    if (route.name === "settings") {
      return (
        <ErrorBoundary label="settings" key={route.name}>
          <SettingsScreen onSignOut={onSignOut} />
        </ErrorBoundary>
      );
    }

    // "epic" / "chat" / "artifact" all carry `epicId` and share ONE
    // `epic.subscribe` session for the whole nav transition —
    // `CurrentEpicProvider` is keyed by epicId (not by route.name), so
    // switching between the tree, a chat, and an artifact within the SAME
    // epic never tears the session down or re-decodes the snapshot (see
    // `current-epic-context.tsx`'s docblock).
    return (
      <CurrentEpicProvider epicId={route.epicId} key={route.epicId}>
        {route.name === "epic" ? (
          <ErrorBoundary label="this epic" key={`epic:${route.epicId}`}>
            <EpicView
              epicId={route.epicId}
              epicTitle={route.epicTitle}
              onOpenChat={(chatId, chatTitle) =>
                dispatch({ type: "open-chat", epicId: route.epicId, chatId, chatTitle })
              }
            />
          </ErrorBoundary>
        ) : route.name === "chat" ? (
          <ErrorBoundary label="this chat" key={`chat:${route.chatId}`}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <ChatView
                epicId={route.epicId}
                chatId={route.chatId}
                initialTitle={route.chatTitle}
                onTitleChange={handleChatTitleChange}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary label="this artifact" key={`artifact:${route.artifactId}`}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <ArtifactRouteView epicId={route.epicId} artifactId={route.artifactId} />
            </Suspense>
          </ErrorBoundary>
        )}
      </CurrentEpicProvider>
    );
  }
}
