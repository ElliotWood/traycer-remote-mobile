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
import { useEffect, useMemo, useReducer, type ReactElement } from "react";
import {
  currentRoute,
  INITIAL_NAV_STACK,
  navReducer,
} from "@/router/nav";
import type { MobileHostClient } from "@/host/host-client-context";
import { FleetView } from "@/views/fleet-view";
import { EpicView } from "@/views/epic-view";
import { ChatView } from "@/views/chat-view";
import { CommentsPanel } from "@/views/comments/comments-panel";
import { parseCommentsHarnessParams } from "@/views/comments/comments-harness-params";

interface AppShellProps {
  readonly client: MobileHostClient;
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

export function AppShell({ client, onSignOut }: AppShellProps): ReactElement {
  const [stack, dispatch] = useReducer(navReducer, INITIAL_NAV_STACK);
  const route = currentRoute(stack);

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

  switch (route.name) {
    case "fleet":
      return (
        <FleetView
          client={client}
          onSignOut={onSignOut}
          onOpenEpic={(epicId) => dispatch({ type: "open-epic", epicId })}
        />
      );
    case "epic":
      return (
        <EpicView
          epicId={route.epicId}
          onOpenChat={(chatId) =>
            dispatch({ type: "open-chat", epicId: route.epicId, chatId })
          }
          onBack={() => dispatch({ type: "back" })}
        />
      );
    case "chat":
      return (
        <ChatView
          epicId={route.epicId}
          chatId={route.chatId}
          onBack={() => dispatch({ type: "back" })}
        />
      );
  }
}
