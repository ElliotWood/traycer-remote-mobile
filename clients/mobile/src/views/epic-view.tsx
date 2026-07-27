/**
 * Epic detail view (T5, P1 desktop-fidelity rebuild).
 *
 * P1 replaces the old flat chat list + separate "Artifacts" drill-in screen
 * with ONE tree screen, segmented into an Agents section (nested chats, the
 * live-state ladder) and an Artifacts section (nested spec/ticket/story/
 * review, status dots, unread bars) — mirroring desktop's VS Code-style
 * sidebar tree. Both sections read straight off the SAME `useEpicDoc`
 * session this view already opens (no second `epic.subscribe` — the
 * eval-round-1 regression this file already guards against).
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
import { useEpicDoc } from "@/host/use-epic-doc";
import { useChatBadges, type ChatBadgeState } from "@/host/use-chat-badges";
import { useSettledConnectionState } from "@/host/use-settled-connection-state";
import { detectBlockedTransitions, notifyBlocked } from "@/host/notifications";
import { markSeen, seedUnseen } from "@/host/read-tracking-store";
import { DEFAULT_SORT_MODE, describeSortMode, nextSortMode, type SortMode } from "@/host/tree-sort";
import { AuthorView } from "./author-view";
import { CreateArtifactView } from "./create-artifact-view";
import { ArtifactBodyView } from "./artifact-body-view";
import { NotificationPermissionButton } from "./notification-permission-button";
import { AgentsSection } from "./epic-tree/agents-section";
import {
  ArtifactsSection,
  DEFAULT_ARTIFACT_FILTER,
  type ArtifactFilter,
} from "./epic-tree/artifacts-section";
import { ArtifactFilterPanel } from "./epic-tree/artifact-filter-panel";
import { ConnectionPill } from "./epic-tree/connection-pill";
import { Button, SectionHeading, screen, theme, type } from "./design-tokens";

interface EpicViewProps {
  readonly epicId: string;
  /** The epic's title, known when opened from Fleet; `null` when reached another way (e.g. a notification). */
  readonly epicTitle: string | null;
  readonly onOpenChat: (chatId: string) => void;
  readonly onBack: () => void;
}

/** Which full-screen drill-in (if any) currently covers the tree. */
type Drill =
  | { readonly kind: "author"; readonly parentId: string | null }
  | { readonly kind: "create-artifact"; readonly parentId: string | null }
  | { readonly kind: "artifact-body"; readonly artifactId: string }
  | null;

export function EpicView({
  epicId,
  epicTitle,
  onOpenChat,
  onBack,
}: EpicViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const { chats, artifacts, artifactRooms, connection: rawConnection } = useEpicDoc(
    streamConnection,
    epicId,
  );
  // S5 (A, M1b): debounce the indicator so a fast healthy re-dial (forced by
  // liveness-recovery on focus/visibility/online) never visibly flickers.
  const connection = useSettledConnectionState(rawConnection);
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
    seedUnseen(epicId, updatedAtById);
  }, [epicId, chats]);
  useEffect(() => {
    const updatedAtById: Record<string, number> = {};
    for (const a of artifacts) updatedAtById[a.id] = a.updatedAt;
    seedUnseen(epicId, updatedAtById);
  }, [epicId, artifacts]);

  const [drill, setDrill] = useState<Drill>(null);
  const [artifactFilter, setArtifactFilter] = useState<ArtifactFilter>(DEFAULT_ARTIFACT_FILTER);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(DEFAULT_SORT_MODE);

  // The artifact body drill marks itself seen the moment it opens (mirrors
  // ChatView doing the same for chats — see `read-tracking-store.ts`).
  useEffect(() => {
    if (drill?.kind === "artifact-body") {
      markSeen(epicId, drill.artifactId);
    }
  }, [epicId, drill]);

  if (drill?.kind === "author" && hostClient !== null) {
    return (
      <AuthorView
        epicId={epicId}
        client={hostClient}
        parentId={drill.parentId}
        onCreated={onOpenChat}
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
        onCreated={(artifactId) => setDrill({ kind: "artifact-body", artifactId })}
        onCancel={() => setDrill(null)}
      />
    );
  }

  // A stale `drill.artifactId` (its artifact left the tree — deleted
  // elsewhere) falls through to the tree view below rather than calling
  // `setDrill` during render — mirrors the pre-P1 `ArtifactTreeView`'s same
  // stale-id handling.
  if (drill?.kind === "artifact-body") {
    const artifact = artifacts.find((a) => a.id === drill.artifactId);
    if (artifact !== undefined) {
      return (
        <ArtifactBodyView
          epicId={epicId}
          artifact={artifact}
          artifactRooms={artifactRooms}
          onBack={() => setDrill(null)}
        />
      );
    }
  }

  return (
    <main style={screen}>
      <Button variant="ghost" onClick={onBack}>
        ← Back
      </Button>

      <header style={{ margin: "16px 0 12px" }}>
        <SectionHeading>{epicTitle ?? "Epic"}</SectionHeading>
        <ConnectionPill state={connection} />
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {hostClient !== null && (
          <Button variant="secondary" onClick={() => setDrill({ kind: "author", parentId: null })}>
            + New agent
          </Button>
        )}
        {hostClient !== null && (
          <Button
            variant="secondary"
            onClick={() => setDrill({ kind: "create-artifact", parentId: null })}
          >
            + New artifact
          </Button>
        )}
        <Button variant="ghost" onClick={() => setSortMode(nextSortMode(sortMode))}>
          Sort: {describeSortMode(sortMode)}
        </Button>
      </div>

      <NotificationPermissionButton />

      <AgentsSection
        epicId={epicId}
        chats={chats}
        badges={badges}
        connectionLive={connectionLive}
        sortMode={sortMode}
        onOpenChat={onOpenChat}
        onAddChild={(parentId) => setDrill({ kind: "author", parentId })}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 4px" }}>
        <button
          type="button"
          onClick={() => setShowFilterPanel((v) => !v)}
          style={{
            ...type.bodyXs,
            border: "none",
            background: "transparent",
            color: showFilterPanel || hasActiveFilter(artifactFilter) ? theme.primary : theme.mutedText,
            cursor: "pointer",
            padding: "6px 4px",
          }}
        >
          Filter
        </button>
      </div>
      {showFilterPanel && (
        <ArtifactFilterPanel filter={artifactFilter} onChange={setArtifactFilter} />
      )}

      <ArtifactsSection
        epicId={epicId}
        artifacts={artifacts}
        connectionLive={connectionLive}
        filter={artifactFilter}
        sortMode={sortMode}
        onOpenArtifact={(artifactId) => setDrill({ kind: "artifact-body", artifactId })}
        onAddChild={(parentId) => setDrill({ kind: "create-artifact", parentId })}
      />
    </main>
  );
}

function hasActiveFilter(filter: ArtifactFilter): boolean {
  return filter.statuses.size > 0 || filter.kinds.size > 0 || filter.read !== "all";
}
