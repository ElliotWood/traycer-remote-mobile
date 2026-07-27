/**
 * Chat detail view (T6, P2 desktop-fidelity rebuild).
 *
 * P2's core is the BOTTOM-ANCHORED layout (Planner clarification): the
 * transcript flows top→bottom with the newest message at the bottom,
 * scrolling in the region ABOVE a fixed footer; the footer holds the
 * pending-approval/interview block, the lower dock (queue/background
 * items/accumulated changes), and the composer, in that order, closest to
 * the user's thumb. Auto-scrolls to bottom on open and on new content,
 * UNLESS the user has scrolled up — then a "Jump to latest" chip appears
 * instead of yanking their view.
 *
 * Streams one `chat.subscribe` (`useChat`) for the selected epic/chat. When
 * the agent is waiting on the user, the pending item(s) surface in a stable
 * priority (interview → tool approval → file-edit approval), each wired to
 * its OWN reply frame — unchanged from T6/pre-P2, still covered by the same
 * tests.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useCurrentEpicDocOrNull } from "@/host/current-epic-context";
import { buildChatTree } from "@/host/use-epic-doc";
import { collectDescendantIds } from "@/host/agent-ladder";
import { isDescendantRunning, useDescendantAgents } from "@/host/use-descendant-agents";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approvalKey,
  fileEditKey,
  interviewKey,
  useChat,
  type ReplyStatus,
  type UseChatResult,
} from "@/host/use-chat";
import { lastAssistantTurn, pinnedTodoSnapshot, type InterviewBlock } from "@/host/chat-projection";
import type {
  ChatApprovalState,
  ChatFileEditApprovalState,
  ChatPendingInterviewState,
  ChatQueuedItem,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";
import { TranscriptView } from "./chat/transcript-view";
import { useSettledConnectionState } from "@/host/use-settled-connection-state";
import {
  detectBlockedTransitions,
  notifyBlocked,
  type BlockedState,
} from "@/host/notifications";
import { NotificationPermissionButton } from "./notification-permission-button";
import { markSeen } from "@/host/read-tracking-store";
import { Button, radius, theme, type } from "./design-tokens";
import { ConnectionPill } from "./epic-tree/connection-pill";
import { BranchChip } from "./chat/branch-chip";
import { ContextUsageChip } from "./chat/context-usage-chip";
import { RunIndicator } from "./chat/run-indicator";
import { ElapsedFooter } from "./chat/elapsed-footer";
import { ScrollToBottomChip } from "./chat/scroll-to-bottom-chip";
import { LowerDock } from "./chat/lower-dock";
import { Composer } from "./chat/composer";

interface ChatViewProps {
  readonly epicId: string;
  readonly chatId: string;
  /** P2 UX fix: the title as already known from the epic tree that opened this chat (or a freshly-created chat's echo) — shown immediately instead of "Untitled chat" while `chat.subscribe`'s own snapshot is still loading. `null` when reached a way that doesn't know it (e.g. a notification). */
  readonly initialTitle: string | null;
  readonly onBack: () => void;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function ChatView({ epicId, chatId, initialTitle, onBack }: ChatViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const chat = useChat(streamConnection, epicId, chatId, hostClient?.getRequestContextUserId() ?? null);
  // S5 (A, M1b): debounce the indicator so a fast healthy re-dial (forced by
  // liveness-recovery on focus/visibility/online) never visibly flickers.
  const displayConnection = useSettledConnectionState(chat.connection);
  const connectionLive = displayConnection === "live";

  // P1 (Epic tree unread markers): the moment this chat is actually opened,
  // it reads as seen — clears any `done-unread`/`failed` ladder tier the
  // Agents-tree row was showing for it. See `read-tracking-store.ts`.
  useEffect(() => {
    markSeen(epicId, chatId);
  }, [epicId, chatId]);

  const hasPending =
    chat.pendingInterviews.length > 0 ||
    chat.pendingApprovals.length > 0 ||
    chat.pendingFileEditApprovals.length > 0;

  // S5 (C, F1 fix): feed the SAME map-shaped detector EpicView uses — a
  // single-entry map that's `{}` until `hasSnapshot`, so an already-blocked
  // chat's first snapshot after open/switch never fires (chatId absent from
  // the previous map ⇒ no fire, the identical rule EpicView relies on).
  const prevRef = useRef<Readonly<Record<string, BlockedState>>>({});
  useEffect(() => {
    const next: Record<string, BlockedState> = chat.hasSnapshot
      ? { [chatId]: { blocked: hasPending } }
      : {};
    const transitioned = detectBlockedTransitions(prevRef.current, next);
    if (transitioned.length > 0) {
      void notifyBlocked({ epicId, chatId, chatTitle: chat.title });
    }
    prevRef.current = next;
  }, [chat.hasSnapshot, hasPending, chat.title, epicId, chatId]);

  // ---- Bottom-anchored scroll (P2 core) ----
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = (smooth: boolean): void => {
    const el = scrollRef.current;
    if (el === null) return;
    // jsdom (tests) has no `scrollTo` — fall back to the plain assignment,
    // which every real DOM (and jsdom) supports.
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setIsAtBottom(true);
  };

  // Auto-scroll on open.
  useEffect(() => {
    scrollToBottom(false);
    // Only on mount / chat switch — not a dependency on every transcript change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epicId, chatId]);

  // Auto-scroll on new content, but only while already at the bottom — a
  // user who's scrolled up to read history never gets yanked back down.
  useEffect(() => {
    if (isAtBottom) scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.transcriptMessages, chat.liveTurnBlocks]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
    setIsAtBottom(atBottom);
  };

  // ---- Composer draft ----
  // Perf fix: the draft text used to live HERE, so every keystroke re-rendered
  // this whole component — including the transcript below it (hundreds of
  // block cards on a long chat). The Composer now owns its own draft state
  // internally; this component only ever needs to PUSH text into it for the
  // rare "edit a queued item" action, via a prefill token the Composer's own
  // effect picks up (see composer.tsx's `prefillText`/`prefillNonce`).
  const [prefill, setPrefill] = useState<{ readonly text: string; readonly nonce: number } | null>(null);

  const handleSend = (
    text: string,
    settings: Parameters<typeof chat.sendMessage>[0]["settings"],
    attachments: Parameters<typeof chat.sendMessage>[0]["attachments"],
  ): void => {
    chat.sendMessage({ text, settings, attachments });
  };

  const handleEditQueueItem = (item: ChatQueuedItem, text: string): void => {
    chat.dispatchAction((base) => ({ ...base, kind: "queueCancel", queueItemId: item.queueItemId }));
    setPrefill((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const [undoAllPending, setUndoAllPending] = useState(false);
  const handleUndoAll = (): void => {
    setUndoAllPending(true);
    chat.dispatchAction((base) => ({
      ...base,
      kind: "revertFileChanges",
      fromMessageId: null,
      filePaths: null,
      revertArtifacts: true,
    }));
    // No ack tracked for this frame today — clear the pending flag optimistically
    // once the snapshot that follows resolves accumulatedFileChanges away.
    setTimeout(() => setUndoAllPending(false), 3000);
  };

  const canMutate = hostClient !== null && connectionLive && chat.accessRole === "owner";
  const isRunning = chat.runStatus === "running" || chat.runStatus === "stopping";
  const turn = useMemo(() => lastAssistantTurn(chat.transcriptMessages), [chat.transcriptMessages]);
  const todoSnapshot = useMemo(
    () => pinnedTodoSnapshot(chat.transcriptMessages, chat.liveTurnBlocks),
    [chat.transcriptMessages, chat.liveTurnBlocks],
  );

  // Active agents: self (already free from `useChat`) + running descendants,
  // resolved from the SAME shared epic-doc session `CurrentEpicProvider`
  // opens (app-shell.tsx) — never a second epic.subscribe. `null` when this
  // chat wasn't reached through the normal epic->chat nav (e.g. a
  // notification deep-link, or a bare render in a test) — the panel then
  // just never appears, same "absent = not reachable" convention already
  // used for `backgroundItems`.
  const epicDoc = useCurrentEpicDocOrNull();
  const descendantChatIds = useMemo(() => {
    if (epicDoc === null) return [];
    const tree = buildChatTree(epicDoc.chats);
    return collectDescendantIds(chatId, tree.childrenByParent);
  }, [epicDoc, chatId]);
  const descendantAgents = useDescendantAgents(streamConnection, epicId, descendantChatIds);
  const chatTitleById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of epicDoc?.chats ?? []) out[c.chatId] = c.title;
    return out;
  }, [epicDoc]);
  const activeAgentRows = useMemo(() => {
    const rows: { readonly chatId: string; readonly title: string; readonly isSelf: boolean }[] = [];
    if (isRunning) rows.push({ chatId, title: chat.title || initialTitle || "Untitled chat", isSelf: true });
    for (const descendantId of descendantChatIds) {
      if (isDescendantRunning(descendantAgents.states[descendantId])) {
        rows.push({ chatId: descendantId, title: chatTitleById[descendantId] ?? "", isSelf: false });
      }
    }
    return rows;
  }, [isRunning, chatId, chat.title, initialTitle, descendantChatIds, descendantAgents.states, chatTitleById]);
  const handleStopAgent = (targetChatId: string, isSelf: boolean): void => {
    if (isSelf) chat.stopTurn();
    else descendantAgents.stop(targetChatId);
  };
  const handleStopAllAgents = (): void => {
    for (const row of activeAgentRows) handleStopAgent(row.chatId, row.isSelf);
  };

  return (
    <div style={chatLayoutStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="ghost" onClick={onBack}>
            ← Back
          </Button>
        </div>
        <h1 style={{ ...type.titleSm, margin: "6px 0 2px", color: theme.text, wordBreak: "break-word" }}>
          {chat.title || initialTitle || "Untitled chat"}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <ConnectionPill state={displayConnection} />
          <BranchChip binding={chat.worktreeBinding} missingWorktreePaths={chat.missingWorktreePaths} />
          <ContextUsageChip usage={turn?.usage ?? null} />
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} style={scrollAreaStyle}>
        <NotificationPermissionButton compact />
        {chat.transcriptMessages.length === 0 && chat.liveTurnBlocks.length === 0 && !chat.hasSnapshot ? (
          // Cache-seeded content (mobile-v3-cache) paints instantly even
          // before hasSnapshot flips true — the skeleton only ever covers a
          // genuinely blank window (no cache, no live snapshot yet), never a
          // cache-seeded transcript that's already there to show.
          <TranscriptSkeleton />
        ) : (
          <TranscriptView
            messages={chat.transcriptMessages}
            liveBlocks={chat.liveTurnBlocks}
            epicId={epicId}
            chatId={chatId}
          />
        )}
        {isRunning && (
          <RunIndicator
            seed={chat.activeTurn?.turnId ?? chatId}
            runState={chat.activeTurn?.status === "stopping" || chat.runStatus === "stopping" ? "stopping" : "running"}
          />
        )}
        {!isRunning && turn !== null && turn.replyText !== "" && turn.startedAt !== null && (
          <ElapsedFooter
            seed={turn.turnId ?? chatId}
            elapsedMs={Math.max(0, turn.timestamp - turn.startedAt)}
            stopped={false}
            usage={turn.usage}
            replyText={turn.replyText}
          />
        )}
        <ScrollToBottomChip visible={!isAtBottom} onClick={() => scrollToBottom(true)} />
      </div>

      <footer style={footerStyle}>
        {hasPending && <PendingSection chat={chat} />}
        <LowerDock
          todoSnapshot={todoSnapshot}
          activeAgentRows={activeAgentRows}
          onStopAgent={handleStopAgent}
          onStopAllAgents={handleStopAllAgents}
          queue={chat.queue}
          backgroundItems={chat.backgroundItems}
          accumulatedFileChanges={chat.accumulatedFileChanges}
          canMutate={canMutate}
          undoAllPending={undoAllPending}
          onUndoAll={handleUndoAll}
          onStopBackgroundItem={(taskId) =>
            chat.dispatchAction((base) => ({ ...base, kind: "stopBackgroundItem", taskId }))
          }
          onStopAllBackgroundItems={() =>
            chat.dispatchAction((base) => ({ ...base, kind: "stopAllBackgroundItems" }))
          }
          onPauseQueue={() => chat.dispatchAction((base) => ({ ...base, kind: "pauseQueue" }))}
          onResumeQueue={() => chat.dispatchAction((base) => ({ ...base, kind: "resumeQueue" }))}
          onCancelQueueItem={(queueItemId) =>
            chat.dispatchAction((base) => ({ ...base, kind: "queueCancel", queueItemId }))
          }
          onSteerQueueItemNow={(queueItemId) =>
            chat.dispatchAction((base) => ({ ...base, kind: "queueSteerNow", queueItemId, newSettings: null }))
          }
          onEditQueueItem={handleEditQueueItem}
        />
        <Composer
          epicId={epicId}
          client={hostClient}
          prefillText={prefill?.text ?? null}
          prefillNonce={prefill?.nonce ?? 0}
          chatSettings={chat.chatSettings}
          canStop={isRunning}
          stopping={chat.runStatus === "stopping"}
          accessRole={chat.accessRole}
          connectionLive={connectionLive}
          sendDisabledHint={
            !connectionLive ? "Reconnecting to the host…" : chat.accessRole === "viewer" ? "You have view-only access" : null
          }
          onSend={handleSend}
          onStop={chat.stopTurn}
        />
      </footer>
    </div>
  );
}

const chatLayoutStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  maxWidth: 480,
  margin: "0 auto",
  background: theme.background,
  color: theme.text,
  fontFamily: "'Figtree Variable', Figtree, ui-sans-serif, system-ui, -apple-system, sans-serif",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  flexShrink: 0,
  padding: "10px 16px 8px",
  borderBottom: `1px solid ${theme.borderHairline}`,
};

const scrollAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  position: "relative",
  padding: "8px 16px",
};

/** Bubble-shaped loading placeholder shown until `chat.subscribe`'s first snapshot decodes — an empty transcript area reads as "load finished, nothing here" otherwise. */
function TranscriptSkeleton(): ReactElement {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
      <div style={{ alignSelf: "flex-end", width: "60%" }}>
        <Skeleton className="h-9 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

const footerStyle: CSSProperties = {
  flexShrink: 0,
  padding: "8px 16px 12px",
  borderTop: `1px solid ${theme.borderHairline}`,
  background: theme.background,
};

/**
 * Every pending block, in a stable priority so the ordering never jitters as
 * items resolve: interviews first (they carry the richest ask), then tool
 * approvals, then file-edit approvals. Each item dispatches its OWN reply frame.
 */
function PendingSection({ chat }: { readonly chat: UseChatResult }): ReactElement {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={{ ...type.bodySm, fontWeight: 600, margin: "0 0 8px", color: theme.danger }}>
        Waiting on you
      </h2>
      {chat.pendingInterviews.map((interview) => (
        <InterviewCard
          key={interviewKey(interview.blockId)}
          interview={interview}
          block={chat.resolveInterview(interview.blockId)}
          status={chat.replyStatusFor(interviewKey(interview.blockId))}
          onSubmit={(answers) =>
            chat.sendReply({ kind: "interview", blockId: interview.blockId, answers })
          }
        />
      ))}
      {chat.pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approvalKey(approval.approvalId)}
          approval={approval}
          status={chat.replyStatusFor(approvalKey(approval.approvalId))}
          onDecide={(approved) =>
            chat.sendReply({ kind: "approval", approvalId: approval.approvalId, approved })
          }
        />
      ))}
      {chat.pendingFileEditApprovals.map((approval) => (
        <FileEditApprovalCard
          key={fileEditKey(approval.approvalId)}
          approval={approval}
          status={chat.replyStatusFor(fileEditKey(approval.approvalId))}
          onDecide={(approved) =>
            chat.sendReply({
              kind: "fileEditApproval",
              approvalId: approval.approvalId,
              approved,
            })
          }
        />
      ))}
    </section>
  );
}

function ApprovalCard({
  approval,
  status,
  onDecide,
}: {
  readonly approval: ChatApprovalState;
  readonly status: ReplyStatus | undefined;
  readonly onDecide: (approved: boolean) => void;
}): ReactElement {
  return (
    <PendingCardShell
      body={
        <>
          <div style={cardLabel}>
            {approval.kind === "plan" ? "Plan approval" : "Tool approval"}
            {" · "}
            <span style={{ color: theme.text }}>{approval.toolName}</span>
          </div>
          <p style={{ ...cardDescription, margin: 0 }}>{approval.description}</p>
        </>
      }
      footer={
        <>
          <ApproveRejectRow status={status} onDecide={onDecide} />
          <ReplyStatusLine status={status} />
        </>
      }
    />
  );
}

function FileEditApprovalCard({
  approval,
  status,
  onDecide,
}: {
  readonly approval: ChatFileEditApprovalState;
  readonly status: ReplyStatus | undefined;
  readonly onDecide: (approved: boolean) => void;
}): ReactElement {
  return (
    <PendingCardShell
      body={
        <>
          <div style={cardLabel}>
            File edit · <span style={{ color: theme.text }}>{approval.operation}</span>
          </div>
          <p style={cardDescription}>{approval.description}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {approval.paths.map((path) => (
              <li
                key={path}
                style={{ color: theme.text, fontSize: 13, wordBreak: "break-all" }}
              >
                {path}
              </li>
            ))}
          </ul>
        </>
      }
      footer={
        <>
          <ApproveRejectRow status={status} onDecide={onDecide} />
          <ReplyStatusLine status={status} />
        </>
      }
    />
  );
}

/**
 * Shared shell for every "waiting on you" card (interview/approval/
 * file-edit-approval): a bounded-height flex column with an internally
 * SCROLLABLE body and a pinned, always-visible footer for the action row.
 * Fixes a real bug — a long interview question / many options / a long
 * file-edit path list could push Submit/Approve/Reject below the fold with
 * no way to reach it, since the outer `<footer>` this renders inside
 * doesn't scroll and the flex layout just let the card overflow off-screen.
 * `dvh` (not `vh`) so the mobile URL bar / on-screen keyboard resizing the
 * visual viewport doesn't strand the cap at the wrong height.
 */
function PendingCardShell({
  body,
  footer,
}: {
  readonly body: ReactElement;
  readonly footer: ReactElement;
}): ReactElement {
  return (
    <article style={pendingCardShellStyle}>
      <div style={pendingCardBodyStyle}>{body}</div>
      <div style={pendingCardFooterStyle}>{footer}</div>
    </article>
  );
}

function ApproveRejectRow({
  status,
  onDecide,
}: {
  readonly status: ReplyStatus | undefined;
  readonly onDecide: (approved: boolean) => void;
}): ReactElement {
  const busy = status?.phase === "submitting";
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        disabled={busy}
        style={decisionButton(theme.primary, busy)}
        onClick={() => onDecide(true)}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        style={decisionButton(theme.danger, busy)}
        onClick={() => onDecide(false)}
      >
        Reject
      </button>
    </div>
  );
}

/**
 * The resolved interview prompt (or a loading state until the block arrives from
 * the chat tree — never an empty card). Collects one answer per question and
 * submits them together as a single `interviewAnswer`.
 */
function InterviewCard({
  interview,
  block,
  status,
  onSubmit,
}: {
  readonly interview: ChatPendingInterviewState;
  readonly block: InterviewBlock | null;
  readonly status: ReplyStatus | undefined;
  readonly onSubmit: (answers: readonly InterviewAnswer[]) => void;
}): ReactElement {
  if (block === null) {
    return (
      <article style={card}>
        <div style={cardLabel}>Interview</div>
        <p role="status" style={cardDescription}>
          Loading question… ({interview.blockId})
        </p>
      </article>
    );
  }
  return <InterviewForm block={block} status={status} onSubmit={onSubmit} />;
}

function InterviewForm({
  block,
  status,
  onSubmit,
}: {
  readonly block: InterviewBlock;
  readonly status: ReplyStatus | undefined;
  readonly onSubmit: (answers: readonly InterviewAnswer[]) => void;
}): ReactElement {
  // One draft entry per question: `selected` labels (options) plus `text`
  // (free-form). Indexed by question position, which is stable for a block.
  const [drafts, setDrafts] = useState<readonly QuestionDraft[]>(() =>
    block.questions.map(() => ({ selected: [], text: "" })),
  );
  const busy = status?.phase === "submitting";

  const toggleOption = (qi: number, label: string, multiSelect: boolean): void => {
    setDrafts((prev) =>
      prev.map((draft, i) => {
        if (i !== qi) return draft;
        if (!multiSelect) return { ...draft, selected: [label] };
        const has = draft.selected.includes(label);
        return {
          ...draft,
          selected: has
            ? draft.selected.filter((l) => l !== label)
            : [...draft.selected, label],
        };
      }),
    );
  };

  const setText = (qi: number, text: string): void => {
    setDrafts((prev) => prev.map((draft, i) => (i === qi ? { ...draft, text } : draft)));
  };

  const answers = block.questions.map((question, qi): InterviewAnswer => {
    const draft = drafts[qi];
    const values =
      question.options.length > 0
        ? [...draft.selected]
        : draft.text.trim() === ""
          ? []
          : [draft.text.trim()];
    return {
      questionId: question.questionId,
      question: question.question,
      values,
      notes: null,
    };
  });
  const canSubmit = !busy && answers.every((a) => a.values.length > 0);

  return (
    <PendingCardShell
      body={
        <>
          <div style={cardLabel}>Interview</div>
          {block.title !== null && <p style={cardDescription}>{block.title}</p>}
          {block.questions.map((question, qi) => (
            <fieldset
              key={question.questionId ?? qi}
              style={{ border: 0, margin: 0, padding: "0 0 12px" }}
            >
              {question.header !== null && (
                <div style={{ color: theme.mutedText, fontSize: 12 }}>{question.header}</div>
              )}
              <legend style={{ fontWeight: 600, padding: 0, marginBottom: 6 }}>
                {question.question}
              </legend>
              {question.options.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {question.options.map((option) => {
                    const selected = drafts[qi].selected.includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={busy}
                        aria-pressed={selected}
                        style={optionButton(selected, busy)}
                        onClick={() =>
                          toggleOption(qi, option.label, question.multiSelect)
                        }
                      >
                        <span style={{ fontWeight: 600 }}>{option.label}</span>
                        {option.description !== null && (
                          <span
                            style={{ display: "block", color: theme.mutedText, fontSize: 12 }}
                          >
                            {option.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  disabled={busy}
                  value={drafts[qi].text}
                  placeholder="Type your answer"
                  aria-label={question.question}
                  style={textInput}
                  onChange={(e) => setText(qi, e.target.value)}
                />
              )}
            </fieldset>
          ))}
        </>
      }
      footer={
        <>
          <button
            type="button"
            disabled={!canSubmit}
            style={decisionButton(theme.primary, !canSubmit)}
            onClick={() => onSubmit(answers)}
          >
            Submit answer
          </button>
          <ReplyStatusLine status={status} />
        </>
      }
    />
  );
}

interface QuestionDraft {
  readonly selected: readonly string[];
  readonly text: string;
}

function ReplyStatusLine({
  status,
}: {
  readonly status: ReplyStatus | undefined;
}): ReactElement | null {
  if (status === undefined) return null;
  if (status.phase === "submitting") {
    return (
      <p role="status" style={{ color: theme.mutedText, fontSize: 13, margin: "8px 0 0" }}>
        Submitting…
      </p>
    );
  }
  return (
    <p role="alert" style={{ color: theme.danger, fontSize: 13, margin: "8px 0 0" }}>
      {status.message}
    </p>
  );
}

const card: CSSProperties = {
  border: `1px solid ${theme.borderHairline}`,
  background: theme.surface,
  borderRadius: radius.lg,
  padding: 12,
  marginBottom: 12,
};

/**
 * `PendingCardShell`'s outer article: bounded height (`dvh`, not `vh` — see
 * the shell's own docblock) so a long interview/approval never exceeds a
 * fraction of the viewport, `overflow: hidden` so the rounded corners clip
 * the scrollable body cleanly instead of the body's own scrollbar poking
 * out past them.
 */
const pendingCardShellStyle: CSSProperties = {
  ...card,
  display: "flex",
  flexDirection: "column",
  maxHeight: "50dvh",
  padding: 0,
  overflow: "hidden",
};

/** The classic flex-child-won't-shrink trap needs `minHeight: 0` here, or this never actually scrolls — it just grows past the parent's `maxHeight`. */
const pendingCardBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: 12,
};

/** Pinned footer — outside the scrollable body, so Approve/Reject/Submit stay reachable regardless of how much the body content scrolls. */
const pendingCardFooterStyle: CSSProperties = {
  flexShrink: 0,
  padding: 12,
  borderTop: `1px solid ${theme.borderHairline}`,
  background: theme.surface,
};

const cardLabel: CSSProperties = {
  fontSize: 12,
  color: theme.mutedText,
  marginBottom: 6,
};

const cardDescription: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  wordBreak: "break-word",
  color: theme.text,
};

const textInput: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: radius.md,
  border: `1px solid ${theme.border}`,
  background: "transparent",
  color: theme.text,
};

function decisionButton(color: string, disabled: boolean): CSSProperties {
  return {
    flex: "1 1 0",
    padding: "10px 14px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: radius.md,
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function optionButton(selected: boolean, disabled: boolean): CSSProperties {
  return {
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: radius.md,
    border: `1px solid ${selected ? theme.primary : theme.border}`,
    background: "transparent",
    color: theme.text,
    cursor: disabled ? "default" : "pointer",
  };
}
