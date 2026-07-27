/**
 * The signed-in app shell (T4): routes the Fleet → Epic → Chat drilldown.
 *
 * Owns the in-memory navigation stack (`navReducer`) and renders the view for
 * the current route. Fleet is live now; the Epic and Chat cases are route slots
 * that T5/T6 replace with their real views. The `client` is guaranteed non-null
 * by the gate (`selectAppScreen` only reaches here when a host is configured).
 */
import { useReducer, type ReactElement } from "react";
import {
  currentRoute,
  INITIAL_NAV_STACK,
  navReducer,
} from "@/router/nav";
import type { MobileHostClient } from "@/host/host-client-context";
import { FleetView } from "@/views/fleet-view";
import { EpicView } from "@/views/epic-view";
import { ChatView } from "@/views/chat-view";

interface AppShellProps {
  readonly client: MobileHostClient;
  readonly onSignOut: () => void;
}

export function AppShell({ client, onSignOut }: AppShellProps): ReactElement {
  const [stack, dispatch] = useReducer(navReducer, INITIAL_NAV_STACK);
  const route = currentRoute(stack);

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
