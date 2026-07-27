/**
 * P1 — Epic tree Agents section: chats nested by `parentId`, each row
 * showing the live-state ladder icon (`agent-ladder.ts`), with a
 * collapsed-parent rollup mirroring desktop's `ChatSidebarNodeIconWithNestedStatus`.
 * Terminal-agents are OUT this round (see the P1 contract — `tuiAgents` are
 * never projected into the epic doc mobile reads).
 */
import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  buildChatTree,
  type ChatTree,
  type EpicChatEntry,
} from "@/host/use-epic-doc";
import type { ChatBadgeState } from "@/host/use-chat-badges";
import {
  collectDescendantIds,
  computeChatDescendantRollup,
  resolveLadderTier,
  rollupOutranksSelf,
  summarizeChatDescendantRollup,
  type LadderTier,
} from "@/host/agent-ladder";
import { getLastSeenAt, isUnread } from "@/host/read-tracking-store";
import { resortTree, type SortMode } from "@/host/tree-sort";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useRenameChat, useDeleteChat } from "@/host/use-node-mutations";
import { LADDER_TIER_LABELS, LadderIcon } from "@/views/kind-tokens";
import { theme, type } from "@/views/design-tokens";
import {
  GuideRails,
  RowActionsButton,
  TreeChevron,
  TreeRowSkeleton,
  rowIndentStyle,
  rowOpenButtonStyle,
  rowShellStyle,
  sectionHeaderStyle,
  sectionLabelStyle,
} from "./tree-primitives";
import { NodeActionSheet, RenamePrompt } from "./node-action-sheet";

export interface AgentsSectionProps {
  readonly epicId: string;
  readonly chats: readonly EpicChatEntry[];
  readonly badges: Readonly<Record<string, ChatBadgeState>>;
  readonly connectionLive: boolean;
  /** `false` while the epic snapshot is still decoding — renders a skeleton instead of a premature "no chats" empty-state. */
  readonly docLoaded: boolean;
  readonly sortMode: SortMode;
  readonly onOpenChat: (chatId: string, chatTitle: string | null) => void;
  readonly onAddChild: (parentChatId: string | null) => void;
}

function tierFor(
  chat: EpicChatEntry,
  badge: ChatBadgeState,
  epicId: string,
): LadderTier {
  const lastSeenAt = getLastSeenAt(epicId, chat.chatId);
  const hasUnreadFailure = badge.lastErrorAt !== null && isUnread(epicId, chat.chatId, badge.lastErrorAt);
  const hasUnreadDone = lastSeenAt !== null && isUnread(epicId, chat.chatId, chat.updatedAt);
  return resolveLadderTier({ badge, hasUnreadFailure, hasUnreadDone });
}

export function AgentsSection({
  epicId,
  chats,
  badges,
  connectionLive,
  docLoaded,
  sortMode,
  onOpenChat,
  onAddChild,
}: AgentsSectionProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionsForChatId, setActionsForChatId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const hostClient = useHostClientOrNull();

  const tree = useMemo(
    () => resortTree(buildChatTree(chats), sortMode),
    [chats, sortMode],
  );
  const tierById = useMemo(() => {
    const out: Record<string, LadderTier> = {};
    for (const chat of chats) {
      out[chat.chatId] = tierFor(chat, badges[chat.chatId] ?? DEFAULT_BADGE, epicId);
    }
    return out;
  }, [chats, badges, epicId]);

  const toggleExpanded = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const actionsChat = actionsForChatId === null ? null : tree.byId[actionsForChatId];
  const renamingChat = renamingChatId === null ? null : tree.byId[renamingChatId];

  // Both hooks target "the currently acted-on node" — always called (rules
  // of hooks), targeting "" when nothing is selected; only actually invoked
  // once a real sheet/prompt is open. `client: null` (no host configured)
  // no-ops inside the hook rather than throwing.
  const renameChat = useRenameChat(hostClient, epicId, renamingChatId ?? "", () => setRenamingChatId(null));
  const deleteChat = useDeleteChat(hostClient, epicId, actionsForChatId ?? "", () => setActionsForChatId(null));

  const canMutate = hostClient !== null && connectionLive;

  return (
    <section style={{ marginBottom: 2 }}>
      <button type="button" style={sectionHeaderStyle} onClick={() => setCollapsed((c) => !c)}>
        <span style={sectionLabelStyle}>Agents</span>
        {collapsed ? (
          <ChevronRight size={14} color={theme.primary} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} color={theme.primary} aria-hidden="true" />
        )}
      </button>

      {!collapsed && (
        <>
          {!docLoaded ? (
            <TreeRowSkeleton />
          ) : tree.roots.length === 0 ? (
            <p style={{ ...type.bodySm, color: theme.mutedText, padding: "0 8px" }}>
              No chats in this epic yet. Start one from the Traycer desktop app.
            </p>
          ) : (
            <ul role="tree" aria-label="Agents" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {tree.roots.map((id) => (
                <ChatNode
                  key={id}
                  id={id}
                  depth={0}
                  tree={tree}
                  tierById={tierById}
                  expandedIds={expandedIds}
                  onToggleExpanded={toggleExpanded}
                  onOpen={onOpenChat}
                  onOpenActions={setActionsForChatId}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {actionsChat !== undefined && actionsChat !== null && (
        <NodeActionSheet
          title={actionsChat.title || "Untitled chat"}
          canMutate={canMutate}
          deleting={deleteChat.phase === "submitting"}
          deleteError={deleteChat.error}
          deleteCascadeCount={collectDescendantIds(actionsChat.chatId, tree.childrenByParent).length}
          onRename={() => setRenamingChatId(actionsChat.chatId)}
          onAddChild={() => onAddChild(actionsChat.chatId)}
          onDeleteConfirmed={deleteChat.deleteNode}
          onClose={() => setActionsForChatId(null)}
        />
      )}

      {renamingChat !== undefined && renamingChat !== null && (
        <RenamePrompt
          initialTitle={renamingChat.title}
          submitting={renameChat.phase === "submitting"}
          error={renameChat.error}
          onSubmit={renameChat.rename}
          onClose={() => setRenamingChatId(null)}
        />
      )}
    </section>
  );
}

const DEFAULT_BADGE: ChatBadgeState = {
  runStatus: "idle",
  pendingInterview: false,
  pendingApproval: false,
  blocked: false,
  background: false,
  accessRole: "owner",
  lastErrorAt: null,
};

function ChatNode({
  id,
  depth,
  tree,
  tierById,
  expandedIds,
  onToggleExpanded,
  onOpen,
  onOpenActions,
}: {
  readonly id: string;
  readonly depth: number;
  readonly tree: ChatTree;
  readonly tierById: Readonly<Record<string, LadderTier>>;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggleExpanded: (id: string) => void;
  readonly onOpen: (id: string, title: string | null) => void;
  readonly onOpenActions: (id: string) => void;
}): ReactElement | null {
  const chat = tree.byId[id];
  if (chat === undefined) return null;

  const childIds = tree.childrenByParent[id] ?? [];
  const hasChildren = childIds.length > 0;
  const isExpanded = expandedIds.has(id);
  const selfTier = tierById[id] ?? "idle";

  const rollup = hasChildren && !isExpanded
    ? computeChatDescendantRollup(id, tree.childrenByParent, (descId) => tierById[descId] ?? "idle")
    : { kind: null, counts: { failure: 0, interview: 0, approval: 0, running: 0, background: 0, done: 0 } };
  const showRollup = rollupOutranksSelf(rollup, selfTier);

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div style={rowShellStyle}>
        <GuideRails depth={depth} />
        <TreeChevron
          hasChildren={hasChildren}
          expanded={isExpanded}
          onToggle={() => onToggleExpanded(id)}
          depth={depth}
        />
        <button
          type="button"
          data-testid={`chat-row-${id}`}
          style={{
            ...rowOpenButtonStyle(),
            ...rowIndentStyle(0),
            background: "color-mix(in oklch, var(--primary) 6%, transparent)",
          }}
          onClick={() => onOpen(id, chat.title || null)}
        >
          <span role="status" title={LADDER_TIER_LABELS[selfTier]} aria-label={LADDER_TIER_LABELS[selfTier]}>
            <LadderIcon tier={selfTier} size={15} />
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {chat.title || "Untitled chat"}
          </span>
          {showRollup && (
            <span title={summarizeChatDescendantRollup(rollup)} aria-label={summarizeChatDescendantRollup(rollup)}>
              <LadderIcon tier={descendantKindToTier(rollup.kind)} muted size={14} />
            </span>
          )}
        </button>
        <RowActionsButton label={`Actions for ${chat.title || "chat"}`} onOpen={() => onOpenActions(id)} />
      </div>
      {hasChildren && isExpanded && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {childIds.map((childId) => (
            <ChatNode
              key={childId}
              id={childId}
              depth={depth + 1}
              tree={tree}
              tierById={tierById}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onOpen={onOpen}
              onOpenActions={onOpenActions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The rollup only ever carries the six urgency kinds — mapped back to a displayable tier for the muted glyph. */
function descendantKindToTier(kind: ReturnType<typeof computeChatDescendantRollup>["kind"]): LadderTier {
  switch (kind) {
    case "failure":
      return "failed";
    case "interview":
      return "needs-interview";
    case "approval":
      return "needs-approval";
    case "running":
      return "running";
    case "background":
      return "background";
    case "done":
      return "done-unread";
    case null:
      return "idle";
  }
}
