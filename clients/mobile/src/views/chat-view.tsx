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
import { isForeignHostChat } from "@/host/connection";
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
import type { InterviewAnswer, InterviewQuestion } from "@traycer/protocol/persistence/epic/content-blocks";
import { TranscriptView } from "./chat/transcript-view";
import { DEFAULT_THRESHOLD_MS, useSettledConnectionState } from "@/host/use-settled-connection-state";
import {
  detectBlockedTransitions,
  notifyBlocked,
  type BlockedState,
} from "@/host/notifications";
import { NotificationPermissionButton } from "./notification-permission-button";
import { defaultStorage, markSeen } from "@/host/read-tracking-store";
import { radius, theme, type } from "./design-tokens";
import { ConnectionPill } from "./epic-tree/connection-pill";
import { BindingChip } from "./chat/binding-chip";
import { ContextUsageChip } from "./chat/context-usage-chip";
import { RunIndicator } from "./chat/run-indicator";
import { ElapsedFooter } from "./chat/elapsed-footer";
import { ScrollToBottomChip } from "./chat/scroll-to-bottom-chip";
import { LowerDock } from "./chat/lower-dock";
import { Composer } from "./chat/composer";
import { NextStepsProvider, type NextStepsValue } from "./chat/next-steps-context";
import { useScreenWakeLock, useWakeLockPreference } from "@/host/use-screen-wake-lock";

interface ChatViewProps {
  readonly epicId: string;
  readonly chatId: string;
  /** P2 UX fix: the title as already known from the epic tree that opened this chat (or a freshly-created chat's echo) — shown immediately instead of "Untitled chat" while `chat.subscribe`'s own snapshot is still loading. `null` when reached a way that doesn't know it (e.g. a notification). */
  readonly initialTitle: string | null;
  /** U2: pushes the live title up to `app-shell.tsx`'s `TopAppBar` as `chat.title` resolves — the screen itself no longer renders its own title/back button (the top bar is the one affordance). */
  readonly onTitleChange: (chatId: string, title: string | null) => void;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function ChatView({ epicId, chatId, initialTitle, onTitleChange }: ChatViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const hostClient = useHostClientOrNull();
  const chat = useChat(streamConnection, epicId, chatId, hostClient?.getRequestContextUserId() ?? null);
  const liveTitle = chat.title || initialTitle || null;
  useEffect(() => {
    onTitleChange(chatId, liveTitle);
  }, [chatId, liveTitle, onTitleChange]);
  // S5 (A, M1b): debounce the indicator so a fast healthy re-dial (forced by
  // liveness-recovery on focus/visibility/online) never visibly flickers.
  const displayConnection = useSettledConnectionState(chat.connection, DEFAULT_THRESHOLD_MS);
  const connectionLive = displayConnection === "live";

  // P1 (Epic tree unread markers): the moment this chat is actually opened,
  // it reads as seen — clears any `done-unread`/`failed` ladder tier the
  // Agents-tree row was showing for it. See `read-tracking-store.ts`.
  useEffect(() => {
    markSeen(epicId, chatId, Date.now(), defaultStorage());
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

  // Next-step options push into the SAME composer prefill channel as
  // "edit a queued item" — deliberately reusing it rather than adding a
  // second path into the composer's draft. Memoized on nothing but the
  // stable setter so the provider value doesn't change identity per render
  // (which would defeat B2-3's memoized transcript below it).
  const nextStepsValue = useMemo<NextStepsValue>(
    () => ({
      insertPrompt: (prompt: string) => {
        setPrefill((prev) => ({ text: prompt, nonce: (prev?.nonce ?? 0) + 1 }));
      },
    }),
    [],
  );

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
  // The "while-running" preference — hold the screen awake only while a turn
  // is actually in flight. "always" is handled once, app-wide, in AppShell.
  useScreenWakeLock(useWakeLockPreference() === "while-running" && isRunning);
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
  // H2: this chat's durable host binding, read from the SAME shared epic-doc
  // session (never a second RPC just to check this). `null` degrades to
  // "assume local" — see `isForeignHostChat`'s doc.
  const isForeignHost = isForeignHostChat(
    epicDoc?.chats.find((c) => c.chatId === chatId)?.hostId ?? null,
  );
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
    <NextStepsProvider value={nextStepsValue}>
    <div style={chatLayoutStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <ConnectionPill state={displayConnection} />
          <BindingChip binding={chat.worktreeBinding} missingWorktreePaths={chat.missingWorktreePaths} />
          <ContextUsageChip usage={turn?.usage ?? null} />
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} style={scrollAreaStyle}>
        {isForeignHost && (
          <div style={foreignHostBannerStyle} role="status">
            Runs on another device — history only; live status and approvals aren't available here.
          </div>
        )}
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
            sendStatusFor={chat.sendStatusFor}
            onRetrySend={chat.retrySend}
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
          chatId={chatId}
          client={hostClient}
          prefillText={prefill?.text ?? null}
          prefillNonce={prefill?.nonce ?? 0}
          chatSettings={chat.chatSettings}
          canStop={isRunning}
          stopping={chat.runStatus === "stopping"}
          // H2: a foreign-host chat has no reachable runtime to send a turn
          // to — reusing the existing viewer-only gate (rather than adding a
          // new Composer prop) keeps this additive and small.
          accessRole={isForeignHost ? "viewer" : chat.accessRole}
          connectionLive={connectionLive}
          sendDisabledHint={
            isForeignHost
              ? "This chat runs on another device"
              : !connectionLive
                ? "Reconnecting to the host…"
                : chat.accessRole === "viewer"
                  ? "You have view-only access"
                  : null
          }
          onSend={handleSend}
          onStop={chat.stopTurn}
        />
      </footer>
    </div>
    </NextStepsProvider>
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

const foreignHostBannerStyle: CSSProperties = {
  ...type.bodyXs,
  padding: "8px 12px",
  margin: "10px 0",
  borderRadius: radius.md,
  background: "color-mix(in oklch, var(--muted-foreground) 12%, transparent)",
  color: theme.mutedText,
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
  // `max()` so the home-indicator inset only adds space when it's actually
  // bigger than the existing 12px — a notched phone gets real clearance
  // instead of the composer sitting under the home indicator; a
  // non-notched device (env() unsupported or zero) just keeps the 12px.
  paddingBottom: "max(12px, env(safe-area-inset-bottom))",
  borderTop: `1px solid ${theme.borderHairline}`,
  background: theme.background,
};

/**
 * Every pending block, in a stable priority so the ordering never jitters as
 * items resolve: interviews first (they carry the richest ask), then tool
 * approvals, then file-edit approvals. Each item dispatches its OWN reply frame.
 *
 * `pendingListStyle` caps and scrolls the WHOLE list, not each card
 * individually — `PendingCardShell`'s own `50dvh` cap only bounds a single
 * card; with N pending cards (two interviews arriving together, or an
 * interview alongside a tool/file-edit approval — all real, all observed)
 * nothing bounded their SUM, so N cards could add up to N×50dvh and push the
 * composer out of the viewport regardless of any one card's own size. This
 * wrapper is the actual footer-height guarantee: whatever the card count,
 * `PendingSection`'s own footprint is capped, and it scrolls internally —
 * every card and every option stays reachable via scroll, none of them
 * shrunk or hidden (unlike a per-card cap, which can't help once there's
 * more than one card).
 */
function PendingSection({ chat }: { readonly chat: UseChatResult }): ReactElement {
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 style={{ ...type.bodySm, fontWeight: 600, margin: "0 0 8px", color: theme.danger }}>
        Waiting on you
      </h2>
      <div style={pendingListStyle}>
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
      </div>
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

/**
 * A key per question, unique across the CURRENT `questions` array.
 * `questionId` is nullable in the schema (`content-blocks.ts`) — and per
 * gui-app's `interview-segment.tsx:119-120`, a null id is the NORMAL case
 * for `AskUserQuestion` answers, not a corner one. `question` (the text)
 * never is, so it's always available as a base identity when `questionId`
 * is absent — never the question's ARRAY POSITION, which is what let a
 * reorder under a stable count silently misattribute one question's answer
 * to another (measured: submitted verbatim against the wrong `question`
 * text, no crash, no warning).
 *
 * `header` folds into that fallback too: it exists specifically to
 * disambiguate otherwise-identical questions, so two null-id questions with
 * the SAME text but DIFFERENT headers are distinct here, not duplicates —
 * without it they'd wrongly take the lossy `::dup:` path below and lose an
 * answered draft across every reconnect for no reason (they were never
 * actually ambiguous).
 *
 * Only questions with a null id, identical text, AND identical header
 * produce the same base key — genuinely indistinguishable from each other,
 * since nothing else in the schema tells them apart. Rather than let them
 * share ONE draft (an even more visible bug: ticking an option for one
 * instantly shows it ticked for the other too), they get disambiguated by
 * occurrence order WITHIN the current render — accepted knowingly as the
 * narrower fix: a reorder that swaps two truly-identical-looking questions
 * relative to each other can still misattribute between JUST that pair,
 * since there is no signal left to tell them apart. `InterviewForm`
 * additionally drops (never carries forward) any draft under a `::dup:` key
 * whenever a NEW snapshot's block object arrives, rather than risk pairing
 * it to the wrong occurrence — losing an in-progress answer to a duplicate
 * question is the accepted cost of never guessing which one it belonged to.
 */
function computeQuestionKeys(questions: readonly InterviewQuestion[]): readonly string[] {
  const baseKeys = questions.map((q) => q.questionId ?? JSON.stringify([q.question, q.header]));
  const counts = new Map<string, number>();
  for (const key of baseKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const seen = new Map<string, number>();
  return baseKeys.map((key) => {
    if ((counts.get(key) ?? 0) <= 1) return key;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return `${key}::dup:${occurrence}`;
  });
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
  const keys = computeQuestionKeys(block.questions);
  // One draft per question, keyed by identity — NOT by array position. A
  // streamed/cache-seeded interview block can change shape after this
  // already mounted (a reconnect's fresh snapshot, or a cache-seeded partial
  // block replaced by a longer live one): more questions arrive, options
  // arrive later for an already-open question, or — per the schema, nothing
  // rules it out — the same questions arrive in a different order. Indexing
  // `drafts[qi]` positionally broke on the first (crashed past this chat's
  // ErrorBoundary) and silently mis-happened on the third (Q1's answer
  // submitted as Q2's, no cue). Keying by identity makes every one of those
  // a non-event: a question keeps its own draft regardless of where it sits
  // in the array.
  const [drafts, setDrafts] = useState<Readonly<Record<string, QuestionDraft>>>(() =>
    Object.fromEntries(keys.map((key) => [key, { selected: [], text: "" }])),
  );
  // Compares against the PREVIOUS render's `block` — the official React
  // pattern for "adjust state when a prop changes" (see useState's
  // reference docs): both pieces of state update together, conditionally,
  // during render.
  const [prevBlock, setPrevBlock] = useState(block);
  const isNewBlock = block !== prevBlock;

  // Reconciled DURING render, not in an effect — an effect runs after
  // commit, so it would still let this same render crash (or read a missing
  // key) once before it could ever fire. Explicitly mutable (not inferred
  // from `drafts`'s `Readonly<...>`) — this is a fresh, locally-owned copy
  // once cloned below, never the state object itself.
  let effectiveDrafts: Record<string, QuestionDraft> = drafts;
  const keysToReset = keys.filter((key) => {
    if (!(key in drafts)) return true; // never seen — needs a default entry
    // A `::dup:` key's PREVIOUS entry may belong to a different occurrence
    // than the one now claiming this key (see `computeQuestionKeys`'s
    // docblock) — only trust it across a snapshot boundary if it's the
    // SAME block object, i.e. nothing changed and this is just an
    // unrelated re-render.
    return key.includes("::dup:") && isNewBlock;
  });
  if (keysToReset.length > 0) {
    effectiveDrafts = { ...drafts };
    for (const key of keysToReset) effectiveDrafts[key] = { selected: [], text: "" };
    setDrafts(effectiveDrafts);
  }
  if (isNewBlock) setPrevBlock(block);
  const busy = status?.phase === "submitting";

  const toggleOption = (key: string, label: string, multiSelect: boolean): void => {
    setDrafts((prev) => {
      const draft = prev[key];
      if (draft === undefined) return prev;
      if (!multiSelect) return { ...prev, [key]: { ...draft, selected: [label] } };
      const has = draft.selected.includes(label);
      return {
        ...prev,
        [key]: {
          ...draft,
          selected: has ? draft.selected.filter((l) => l !== label) : [...draft.selected, label],
        },
      };
    });
  };

  const setText = (key: string, text: string): void => {
    setDrafts((prev) => {
      const draft = prev[key];
      if (draft === undefined) return prev;
      return { ...prev, [key]: { ...draft, text } };
    });
  };

  const answers = block.questions.map((question, qi): InterviewAnswer => {
    const draft = effectiveDrafts[keys[qi]];
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
          {block.questions.map((question, qi) => {
            const key = keys[qi];
            const draft = effectiveDrafts[key];
            // A question that had no options yet (rendered as free text)
            // can gain them in a later snapshot at the SAME question count
            // — the branch below flips to option buttons, and a typed
            // answer sitting in `draft.text` would otherwise vanish from
            // the screen with no explanation. The text itself is never
            // deleted (kept in state, not submitted while unselected — see
            // `values` above), but the user needs to be told it no longer
            // counts as their answer.
            const strandedText =
              question.options.length > 0 && draft.selected.length === 0 && draft.text.trim() !== "";
            return (
              <fieldset key={key} style={{ border: 0, margin: 0, padding: "0 0 12px" }}>
                {question.header !== null && (
                  <div style={{ color: theme.mutedText, fontSize: 12 }}>{question.header}</div>
                )}
                <legend style={{ fontWeight: 600, padding: 0, marginBottom: 6 }}>
                  {question.question}
                </legend>
                {question.options.length > 0 ? (
                  <>
                    {strandedText && (
                      <p style={{ margin: "0 0 6px", fontSize: 12, color: theme.danger }}>
                        You typed “{draft.text.trim()}” before options were added — pick one below
                        to answer.
                      </p>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {question.options.map((option) => {
                        const selected = draft.selected.includes(option.label);
                        return (
                          <button
                            key={option.label}
                            type="button"
                            disabled={busy}
                            aria-pressed={selected}
                            style={optionButton(selected, busy)}
                            onClick={() => toggleOption(key, option.label, question.multiSelect)}
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
                  </>
                ) : (
                  <input
                    type="text"
                    disabled={busy}
                    value={draft.text}
                    placeholder="Type your answer"
                    aria-label={question.question}
                    style={textInput}
                    onChange={(e) => setText(key, e.target.value)}
                  />
                )}
              </fieldset>
            );
          })}
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
 * Conservative reserved budget (px) for everything ELSE in the footer's
 * column besides the pending-card list: `headerStyle`'s row, this section's
 * own "Waiting on you" label, `LowerDock`'s collapsed chip strip when
 * present, the composer at its tallest (its toolbar row wraps to two lines
 * on a narrow screen or a long model name — `composer.tsx`'s `flexWrap:
 * "wrap"`), and the footer's own padding. Measured against the real
 * rendered chrome (`tests/layout/measure.mjs`) rather than guessed; errs
 * generous on purpose — a slightly shorter card list is a fine trade for
 * the composer never leaving the viewport.
 */
const PENDING_LIST_RESERVED_PX = 260;

/**
 * The shared scroll/cap for the WHOLE pending-card list — see
 * `PendingSection`'s docblock for why this replaces relying on each card's
 * own independent `50dvh` cap.
 */
const pendingListStyle: CSSProperties = {
  overflowY: "auto",
  maxHeight: `min(50dvh, calc(100dvh - ${PENDING_LIST_RESERVED_PX}px))`,
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
