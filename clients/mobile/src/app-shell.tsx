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
import { useEffect, useMemo, useReducer, useState, type ReactElement } from "react";
import {
  currentRoute,
  INITIAL_NAV_STACK,
  navReducer,
} from "@/router/nav";
import type { MobileHostClient } from "@/host/host-client-context";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostNotifications } from "@/host/use-host-notifications";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import { FleetView } from "@/views/fleet-view";
import { EpicView } from "@/views/epic-view";
import { ChatView } from "@/views/chat-view";
import { CommentsPanel } from "@/views/comments/comments-panel";
import { parseCommentsHarnessParams } from "@/views/comments/comments-harness-params";
import { ErrorBoundary } from "@/views/error-boundary";
import { CurrentEpicProvider } from "@/host/current-epic-context";
import { TopAppBar } from "@/views/toolbar/top-app-bar";
import { AccountSheet } from "@/views/toolbar/account-sheet";
import { UsageSheet } from "@/views/toolbar/usage-sheet";
import { NotificationsScreen } from "@/views/toolbar/notifications-screen";
import { SettingsScreen } from "@/views/toolbar/settings-screen";

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
  const route = currentRoute(stack);
  const streamConnection = useStreamConnectionOrNull();
  const { summary: notificationsSummary } = useHostNotifications(streamConnection);
  const [accountOpen, setAccountOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);

  // S5 (C, P1): a blocked-chat notification's click posts a message to an
  // existing client (see `src/sw.ts`'s `notificationclick`); this is the one
  // place that turns it into real navigation, reusing the existing nav stack
  // rather than adding URL routing. `goto-chat` replaces the stack outright so
  // clicking a notification can never duplicate an epic/chat frame. Runs
  // unconditionally (before the harness-route early return below) so every
  // hook in this component fires on every render.
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
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  const harnessParams = useMemo(
    () => parseCommentsHarnessParams(window.location.search),
    [],
  );
  if (harnessParams !== null) {
    return <CommentsPanel {...harnessParams} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <TopAppBar
        user={user}
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
            onBack={() => dispatch({ type: "back" })}
            onOpenChat={(epicId, chatId) => dispatch({ type: "goto-chat", epicId, chatId })}
            onOpenEpic={(epicId) => dispatch({ type: "open-epic", epicId, epicTitle: "" })}
          />
        </ErrorBoundary>
      );
    }

    if (route.name === "settings") {
      return (
        <ErrorBoundary label="settings" key={route.name}>
          <SettingsScreen onBack={() => dispatch({ type: "back" })} onSignOut={onSignOut} />
        </ErrorBoundary>
      );
    }

    // "epic" and "chat" both carry `epicId` and share ONE `epic.subscribe`
    // session for the whole epic↔chat transition — `CurrentEpicProvider` is
    // keyed by epicId (not by route.name), so switching between the tree and
    // a chat within the SAME epic never tears the session down or re-decodes
    // the snapshot (see `current-epic-context.tsx`'s docblock).
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
              onBack={() => dispatch({ type: "back" })}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary label="this chat" key={`chat:${route.chatId}`}>
            <ChatView
              epicId={route.epicId}
              chatId={route.chatId}
              initialTitle={route.chatTitle}
              onBack={() => dispatch({ type: "back" })}
            />
          </ErrorBoundary>
        )}
      </CurrentEpicProvider>
    );
  }
}
