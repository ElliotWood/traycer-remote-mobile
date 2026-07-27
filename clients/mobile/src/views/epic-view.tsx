/**
 * Epic detail view (T5, Flow 3): the chat list for one epic with live badges.
 *
 * Streams the epic's Y.Doc (`useEpicDoc`) to enumerate its chats, and opens a
 * bounded `chat.subscribe` per chat (`useChatBadges`) to show whether each is
 * running or BLOCKED (waiting on the user — a pending approval or interview).
 * Blocked chats sort to the top and are visually distinct, so a glance answers
 * "what needs me?". The epic stream's connection state (live / reconnecting /
 * disconnected) is shown so the list never implies freshness it can't back.
 *
 * Tapping a chat drills into the chat detail (T6); this view only wires the
 * navigation. All streams (the epic stream + every per-chat badge stream) are
 * torn down by the hooks' effect cleanups when the user backs out.
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useEpicDoc, type EpicChatEntry } from "@/host/use-epic-doc";
import {
  DEFAULT_CHAT_BADGE,
  useChatBadges,
  type ChatBadgeState,
} from "@/host/use-chat-badges";
import type { StreamConnectionState } from "@/host/stream-connection";
import { AuthorView } from "./author-view";
import { ArtifactTreeView } from "./artifact-tree-view";
import { colors, row, screen, secondaryButton } from "./ui";

interface EpicViewProps {
  readonly epicId: string;
  readonly onOpenChat: (chatId: string) => void;
  readonly onBack: () => void;
}

export function EpicView({
  epicId,
  onOpenChat,
  onBack,
}: EpicViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const { chats, artifacts, artifactRooms, connection } = useEpicDoc(streamConnection, epicId);
  // The badge streams follow the exact chat-id set the doc reports.
  const chatIds = useMemo(() => chats.map((c) => c.chatId), [chats]);
  const badges = useChatBadges(streamConnection, epicId, chatIds);

  // Blocked chats to the top; otherwise keep the doc's order. A stable sort
  // preserves relative order within each group.
  const ordered = useMemo(() => sortByBlocked(chats, badges), [chats, badges]);

  const [authoring, setAuthoring] = useState(false);
  // Sprint 3: artifact browse is a local drill-in (like `authoring`), not a
  // `nav.ts` route — `ArtifactTreeView` owns its own further drill-in into a
  // body render.
  const [browsingArtifacts, setBrowsingArtifacts] = useState(false);

  // The author flow needs a bound host client to dispatch `epic.createChat`;
  // when one is present (always so under the signed-in shell) the "+ New agent
  // here" entry point drills into it (T7).
  if (authoring && hostClient !== null) {
    return (
      <AuthorView
        epicId={epicId}
        client={hostClient}
        onCreated={onOpenChat}
        onCancel={() => setAuthoring(false)}
      />
    );
  }

  if (browsingArtifacts) {
    return (
      <ArtifactTreeView
        epicId={epicId}
        artifacts={artifacts}
        artifactRooms={artifactRooms}
        connection={connection}
        onBack={() => setBrowsingArtifacts(false)}
      />
    );
  }

  return (
    <main style={screen}>
      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 16 }}
        onClick={onBack}
      >
        ← Back
      </button>

      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Chats</h1>
        <p
          style={{
            color: colors.muted,
            margin: "4px 0 0",
            fontSize: 13,
            wordBreak: "break-all",
          }}
        >
          {epicId}
        </p>
        <ConnectionIndicator state={connection} />
      </header>

      {hostClient !== null && (
        <button
          type="button"
          style={{ ...secondaryButton, marginBottom: 12 }}
          onClick={() => setAuthoring(true)}
        >
          + New agent here
        </button>
      )}

      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 12 }}
        onClick={() => setBrowsingArtifacts(true)}
      >
        Artifacts
      </button>

      <ChatList ordered={ordered} badges={badges} onOpenChat={onOpenChat} />
    </main>
  );
}

function ChatList({
  ordered,
  badges,
  onOpenChat,
}: {
  readonly ordered: readonly EpicChatEntry[];
  readonly badges: Readonly<Record<string, ChatBadgeState>>;
  readonly onOpenChat: (chatId: string) => void;
}): ReactElement {
  if (ordered.length === 0) {
    return (
      <p style={{ color: colors.muted }}>
        No chats in this epic yet. Start one from the Traycer desktop app.
      </p>
    );
  }
  return (
    <div>
      {ordered.map((chat) => (
        <ChatRow
          key={chat.chatId}
          chat={chat}
          badge={badges[chat.chatId] ?? DEFAULT_CHAT_BADGE}
          onOpen={() => onOpenChat(chat.chatId)}
        />
      ))}
    </div>
  );
}

function ChatRow({
  chat,
  badge,
  onOpen,
}: {
  readonly chat: EpicChatEntry;
  readonly badge: ChatBadgeState;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <button type="button" style={row} onClick={onOpen}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 600 }}>{chat.title || "Untitled chat"}</span>
        <ChatBadge badge={badge} />
      </div>
    </button>
  );
}

/**
 * The single most important signal per row. Blocked outranks running: a chat
 * waiting on the user needs attention even if a turn is also mid-flight. Idle
 * chats show no badge (nothing to triage).
 */
function ChatBadge({ badge }: { readonly badge: ChatBadgeState }): ReactElement | null {
  if (badge.blocked) {
    return (
      <span role="status" style={badgeStyle(colors.danger, colors.dangerBg)}>
        Blocked
      </span>
    );
  }
  if (badge.runStatus === "running" || badge.runStatus === "stopping") {
    return (
      <span role="status" style={badgeStyle(colors.accent, "transparent")}>
        {badge.runStatus === "stopping" ? "Stopping" : "Running"}
      </span>
    );
  }
  return null;
}

function ConnectionIndicator({
  state,
}: {
  readonly state: StreamConnectionState;
}): ReactElement {
  const { label, color } = CONNECTION_LABEL[state];
  return (
    <p role="status" style={{ color, margin: "8px 0 0", fontSize: 13 }}>
      {label}
    </p>
  );
}

const CONNECTION_LABEL: Record<
  StreamConnectionState,
  { readonly label: string; readonly color: string }
> = {
  live: { label: "Live", color: colors.accent },
  reconnecting: { label: "Reconnecting…", color: colors.muted },
  disconnected: { label: "Disconnected", color: colors.danger },
};

function badgeStyle(fg: string, bg: string): CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    color: fg,
    background: bg,
    border: `1px solid ${fg}`,
    borderRadius: 999,
    padding: "2px 8px",
    whiteSpace: "nowrap",
  };
}

/**
 * Stable partition: blocked chats first (in doc order), then the rest (in doc
 * order). `Array.prototype.sort` is stable in every supported engine, so equal
 * keys keep their input order.
 */
function sortByBlocked(
  chats: readonly EpicChatEntry[],
  badges: Readonly<Record<string, ChatBadgeState>>,
): readonly EpicChatEntry[] {
  const rank = (chat: EpicChatEntry): number =>
    (badges[chat.chatId] ?? DEFAULT_CHAT_BADGE).blocked ? 0 : 1;
  return [...chats].sort((a, b) => rank(a) - rank(b));
}
