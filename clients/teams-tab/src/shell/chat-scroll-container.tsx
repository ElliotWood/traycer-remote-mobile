/**
 * The shell's single scroll region, exposed to whichever screen needs to
 * drive it directly — today, only the full-screen chat route, for
 * auto-scroll-to-bottom.
 *
 * A CONTEXT rather than a prop threaded through `App` → `EpicsScreen` →
 * `ChatRoute`, because the ref is born and owned inside `AppShell` (the
 * component that renders the body div in the first place) and every route
 * between it and the consumer would otherwise carry a prop it never reads.
 */
import { createContext, useContext, type RefObject } from "react";

const ChatScrollContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(
  null,
);

export const ChatScrollContainerProvider = ChatScrollContainerContext.Provider;

/** `null` when read outside `AppShell` — callers must treat that as "no scroll driving today", not throw. */
export function useChatScrollContainer(): RefObject<HTMLDivElement | null> | null {
  return useContext(ChatScrollContainerContext);
}
