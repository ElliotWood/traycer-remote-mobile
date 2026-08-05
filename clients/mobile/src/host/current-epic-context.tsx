/**
 * ONE shared `epic.subscribe` session for the currently-open epic, hoisted
 * above the epic-tree ↔ chat nav transition (`app-shell.tsx`) so both
 * `EpicView` and `ChatView` read the SAME live doc instead of each opening
 * their own.
 *
 * This exists to avoid two real, previously-hit regressions:
 *   - A double-subscribe bug (an earlier `ArtifactTreeView` opened a SECOND
 *     `epic.subscribe` alongside `EpicView`'s, producing a 6-9s
 *     "Reconnecting…/empty" flash) — keyed correctly, this hook structurally
 *     enforces "one session per open epic" rather than relying on every
 *     future consumer to remember not to open their own.
 *   - A re-decode tax on every chat open: this epic's own snapshot measured
 *     3.2MB / ~8.3s to decode. If opening a chat re-subscribed from scratch,
 *     every chat open would pay that cost. `app-shell.tsx` renders this
 *     provider ONCE per epicId (`key={route.epicId}`), wrapping BOTH the
 *     "epic" and "chat" route cases, so switching between them never tears
 *     the session down or re-decodes anything.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useStreamConnectionOrNull } from "./stream-connection-context";
import { useEpicDoc, type UseEpicDocResult } from "./use-epic-doc";

const CurrentEpicContext = createContext<UseEpicDocResult | null>(null);

export function CurrentEpicProvider({
  epicId,
  children,
}: {
  readonly epicId: string;
  readonly children: ReactNode;
}): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const epicDoc = useEpicDoc(streamConnection, epicId);
  return <CurrentEpicContext.Provider value={epicDoc}>{children}</CurrentEpicContext.Provider>;
}

/** For consumers that structurally require the epic doc (the tree has nothing to render without it) — throws outside a provider rather than silently rendering empty. */
export function useCurrentEpicDoc(): UseEpicDocResult {
  const ctx = useContext(CurrentEpicContext);
  if (ctx === null) {
    throw new Error("useCurrentEpicDoc must be used within a CurrentEpicProvider");
  }
  return ctx;
}

/** For OPTIONAL consumers (e.g. ChatView's active-agents panel) that degrade gracefully when no epic context is available — mirrors this codebase's `useStreamConnectionOrNull`/`useHostClientOrNull` convention. */
export function useCurrentEpicDocOrNull(): UseEpicDocResult | null {
  return useContext(CurrentEpicContext);
}
