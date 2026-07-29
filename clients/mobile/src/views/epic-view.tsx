/**
 * Epic detail view (T5, P1 desktop-fidelity rebuild).
 *
 * P1 replaces the old flat chat list + separate "Artifacts" drill-in screen
 * with ONE tree screen, segmented into an Agents section (nested chats, the
 * live-state ladder) and an Artifacts section (nested spec/ticket/story/
 * review, status dots, unread bars) — mirroring desktop's VS Code-style
 * sidebar tree. Both sections read off `useCurrentEpicDoc()` — the ONE
 * `epic.subscribe` session `app-shell.tsx`'s `CurrentEpicProvider` opens for
 * the whole epic↔chat nav transition, not a session this view opens itself
 * (an earlier `ArtifactTreeView` opened a second one alongside this view's,
 * producing a multi-second "Reconnecting…/empty" flash — see
 * `current-epic-context.tsx`'s docblock for the full history).
 *
 * Chat/artifact opening is unchanged from pre-P1: `onOpenChat` drills into
 * the S2 transcript exactly as before; artifact opening now renders
 * `ArtifactBodyView` INLINE (reparented from the old standalone
 * `ArtifactTreeView` screen) rather than via a separate drill screen, but
 * the component itself — and its S3 body / S4 comments — is untouched.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useCurrentEpicDoc } from "@/host/current-epic-context";
import { useArtifactNav } from "@/host/artifact-nav-context";
import { useChatBadges, type ChatBadgeState } from "@/host/use-chat-badges";
import { DEFAULT_THRESHOLD_MS, useSettledConnectionState } from "@/host/use-settled-connection-state";
import { detectBlockedTransitions, notifyBlocked } from "@/host/notifications";
import { defaultStorage, seedUnseen } from "@/host/read-tracking-store";
import { DEFAULT_SORT_MODE, describeSortMode, nextSortMode, type SortMode } from "@/host/tree-sort";
import { AuthorView } from "./author-view";
import { CreateArtifactView } from "./create-artifact-view";
import { NotificationPermissionButton } from "./notification-permission-button";
import { AgentsSection } from "./epic-tree/agents-section";
import { ArtifactsSection } from "./epic-tree/artifacts-section";
import { ConnectionPill } from "./epic-tree/connection-pill";
import { Button, SectionHeading, screen } from "./design-tokens";

interface EpicViewProps {
  readonly epicId: string;
  /** The epic's title, known when opened from Fleet; `null` when reached another way (e.g. a notification). */
  readonly epicTitle: string | null;
  /** P2 UX fix: the tree already knows every chat's title (`EpicChatEntry`) — threading it through means ChatView never shows "Untitled chat" while its own snapshot is still loading. `null` for a brand-new chat (its snapshot lands almost immediately). */
  readonly onOpenChat: (chatId: string, chatTitle: string | null) => void;
}

/** Which full-screen drill-in (if any) currently covers the tree. */
type Drill =
  | { readonly kind: "author"; readonly parentId: string | null }
  | { readonly kind: "create-artifact"; readonly parentId: string | null }
  | null;

export function EpicView({
  epicId,
  epicTitle,
  onOpenChat,
}: EpicViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const { chats, artifacts, docLoaded, connection: rawConnection } = useCurrentEpicDoc();
  const { openArtifact } = useArtifactNav();
  // S5 (A, M1b): debounce the indicator so a fast healthy re-dial (forced by
  // liveness-recovery on focus/visibility/online) never visibly flickers.
  const connection = useSettledConnectionState(rawConnection, DEFAULT_THRESHOLD_MS);
  const connectionLive = connection === "live";

  // The badge streams follow the exact chat-id set the doc reports.
  const chatIds = useMemo(() => chats.map((c) => c.chatId), [chats]);
  const badges = useChatBadges(streamConnection, epicId, chatIds);

  // S5 (C): fire a foreground alert on a real false→true blocked transition —
  // never on a chat that's already blocked the moment it's first observed
  // (see `detectBlockedTransitions`'s doc comment). Fed the RAW badge map,
  // never one padded with `DEFAULT_CHAT_BADGE` filler.
  const prevBadgesRef = useRef<Readonly<Record<string, ChatBadgeState>>>({});
  useEffect(() => {
    const transitioned = detectBlockedTransitions(prevBadgesRef.current, badges);
    for (const chatId of transitioned) {
      const chat = chats.find((c) => c.chatId === chatId);
      void notifyBlocked({ epicId, chatId, chatTitle: chat?.title ?? "" });
    }
    prevBadgesRef.current = badges;
  }, [badges, chats, epicId]);

  // P1 tighten #1: seed every never-seen node to ITS OWN updatedAt so the
  // tree never opens with everything reading as unread — only activity
  // AFTER this point should ever flip a marker.
  useEffect(() => {
    const updatedAtById: Record<string, number> = {};
    for (const c of chats) updatedAtById[c.chatId] = c.updatedAt;
    seedUnseen(epicId, updatedAtById, defaultStorage());
  }, [epicId, chats]);
  useEffect(() => {
    const updatedAtById: Record<string, number> = {};
    for (const a of artifacts) updatedAtById[a.id] = a.updatedAt;
    seedUnseen(epicId, updatedAtById, defaultStorage());
  }, [epicId, artifacts]);

  const [drill, setDrill] = useState<Drill>(null);
  const [sortMode, setSortMode] = useState<SortMode>(DEFAULT_SORT_MODE);

  if (drill?.kind === "author" && hostClient !== null) {
    return (
      <AuthorView
        epicId={epicId}
        client={hostClient}
        parentId={drill.parentId}
        onCreated={(chatId) => onOpenChat(chatId, null)}
        onCancel={() => setDrill(null)}
      />
    );
  }

  if (drill?.kind === "create-artifact" && hostClient !== null) {
    return (
      <CreateArtifactView
        epicId={epicId}
        parentId={drill.parentId}
        client={hostClient}
        onCreated={(artifactId) => {
          setDrill(null);
          openArtifact(epicId, artifactId);
        }}
        onCancel={() => setDrill(null)}
      />
    );
  }

  return (
    <main style={screen}>
      <header style={{ margin: "12px 0 10px" }}>
        <SectionHeading>{epicTitle ?? "Epic"}</SectionHeading>
        <ConnectionPill state={connection} />
      </header>

      {/* Compact toolbar: New-agent is the primary (teal-filled) CTA, the rest are tight secondary/ghost chips packed close together. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {hostClient !== null && (
          <Button variant="primary" onClick={() => setDrill({ kind: "author", parentId: null })}>
            + New agent
          </Button>
        )}
        {hostClient !== null && (
          <Button
            variant="outline"
            onClick={() => setDrill({ kind: "create-artifact", parentId: null })}
          >
            + Artifact
          </Button>
        )}
        <Button variant="ghost" onClick={() => setSortMode(nextSortMode(sortMode))}>
          {describeSortMode(sortMode)}
        </Button>
        <NotificationPermissionButton compact />
      </div>

      <AgentsSection
        epicId={epicId}
        chats={chats}
        badges={badges}
        connectionLive={connectionLive}
        docLoaded={docLoaded}
        sortMode={sortMode}
        onOpenChat={onOpenChat}
        onAddChild={(parentId) => setDrill({ kind: "author", parentId })}
      />

      <ArtifactsSection
        epicId={epicId}
        artifacts={artifacts}
        connectionLive={connectionLive}
        docLoaded={docLoaded}
        sortMode={sortMode}
        onOpenArtifact={(artifactId) => openArtifact(epicId, artifactId)}
        onAddChild={(parentId) => setDrill({ kind: "create-artifact", parentId })}
      />
    </main>
  );
}
