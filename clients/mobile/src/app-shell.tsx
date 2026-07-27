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
import { useMemo, useReducer, type ReactElement } from "react";
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

export function AppShell({ client, onSignOut }: AppShellProps): ReactElement {
  const [stack, dispatch] = useReducer(navReducer, INITIAL_NAV_STACK);
  const route = currentRoute(stack);

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
