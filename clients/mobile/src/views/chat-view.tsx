/**
 * Chat detail view (T6, Flow 4): the payoff surface where a blocked agent gets
 * its answer from the phone.
 *
 * Streams one `chat.subscribe` (`useChat`) for the selected epic/chat and shows
 * `runStatus` + recent activity + connection state. When the agent is waiting on
 * the user it surfaces the pending item(s) prominently, in a stable priority
 * (interview → tool approval → file-edit approval), each wired to its OWN reply
 * frame:
 *   - tool approval      → Approve / Reject (`approvalDecision`)
 *   - file-edit approval → Approve / Reject, showing the file(s)/operation
 *     (`fileEditApprovalDecision` — a DISTINCT frame)
 *   - interview          → the resolved question + options, free-form or
 *     multi-select, submitting an `interviewAnswer`; a loading state (never an
 *     empty one) until the prompt block resolves from the chat tree.
 *
 * A reply is optimistic ("Submitting…") until the `actionAck` of record: an
 * `accepted` ack lets the streamed resolve-delta drop the item (agent unblocks);
 * a `rejected` ack shows an inline error against the still-true pending state.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import { useStreamConnectionOrNull } from "@/host/stream-connection-context";
import {
  approvalKey,
  fileEditKey,
  interviewKey,
  useChat,
  type ReplyStatus,
  type UseChatResult,
} from "@/host/use-chat";
import type { InterviewBlock } from "@/host/chat-projection";
import type {
  ChatApprovalState,
  ChatFileEditApprovalState,
  ChatPendingInterviewState,
  ChatRunStatus,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";
import type { StreamConnectionState } from "@/host/stream-connection";
import { TranscriptView } from "./chat/transcript-view";
import { colors, screen, secondaryButton } from "./ui";

interface ChatViewProps {
  readonly epicId: string;
  readonly chatId: string;
  readonly onBack: () => void;
}

export function ChatView({ epicId, chatId, onBack }: ChatViewProps): ReactElement {
  const streamConnection = useStreamConnectionOrNull();
  const chat = useChat(streamConnection, epicId, chatId);

  const hasPending =
    chat.pendingInterviews.length > 0 ||
    chat.pendingApprovals.length > 0 ||
    chat.pendingFileEditApprovals.length > 0;

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
        <h1 style={{ fontSize: 20, margin: 0, wordBreak: "break-word" }}>
          {chat.title || "Untitled chat"}
        </h1>
        <RunStatusLine runStatus={chat.runStatus} blocked={hasPending} />
        <ConnectionIndicator state={chat.connection} />
      </header>

      {chat.recentActivity !== "" && (
        <p
          style={{
            color: colors.muted,
            fontSize: 13,
            margin: "0 0 16px",
            whiteSpace: "pre-wrap",
          }}
        >
          {chat.recentActivity}
        </p>
      )}

      {hasPending ? (
        <PendingSection chat={chat} />
      ) : (
        <p style={{ color: colors.muted }}>
          Nothing is waiting on you in this chat right now.
        </p>
      )}

      <TranscriptView
        messages={chat.transcriptMessages}
        liveBlocks={chat.liveTurnBlocks}
        epicId={epicId}
        chatId={chatId}
      />
    </main>
  );
}

/**
 * Every pending block, in a stable priority so the ordering never jitters as
 * items resolve: interviews first (they carry the richest ask), then tool
 * approvals, then file-edit approvals. Each item dispatches its OWN reply frame.
 */
function PendingSection({ chat }: { readonly chat: UseChatResult }): ReactElement {
  return (
    <section>
      <h2 style={{ fontSize: 15, margin: "0 0 8px", color: colors.danger }}>
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
    <article style={card}>
      <div style={cardLabel}>
        {approval.kind === "plan" ? "Plan approval" : "Tool approval"}
        {" · "}
        <span style={{ color: colors.text }}>{approval.toolName}</span>
      </div>
      <p style={cardDescription}>{approval.description}</p>
      <ApproveRejectRow status={status} onDecide={onDecide} />
      <ReplyStatusLine status={status} />
    </article>
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
    <article style={card}>
      <div style={cardLabel}>
        File edit · <span style={{ color: colors.text }}>{approval.operation}</span>
      </div>
      <p style={cardDescription}>{approval.description}</p>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
        {approval.paths.map((path) => (
          <li
            key={path}
            style={{ color: colors.text, fontSize: 13, wordBreak: "break-all" }}
          >
            {path}
          </li>
        ))}
      </ul>
      <ApproveRejectRow status={status} onDecide={onDecide} />
      <ReplyStatusLine status={status} />
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
        style={decisionButton(colors.accent, busy)}
        onClick={() => onDecide(true)}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        style={decisionButton(colors.danger, busy)}
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
    <article style={card}>
      <div style={cardLabel}>Interview</div>
      {block.title !== null && <p style={cardDescription}>{block.title}</p>}
      {block.questions.map((question, qi) => (
        <fieldset
          key={question.questionId ?? qi}
          style={{ border: 0, margin: 0, padding: "0 0 12px" }}
        >
          {question.header !== null && (
            <div style={{ color: colors.muted, fontSize: 12 }}>{question.header}</div>
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
                        style={{ display: "block", color: colors.muted, fontSize: 12 }}
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
      <button
        type="button"
        disabled={!canSubmit}
        style={decisionButton(colors.accent, !canSubmit)}
        onClick={() => onSubmit(answers)}
      >
        Submit answer
      </button>
      <ReplyStatusLine status={status} />
    </article>
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
      <p role="status" style={{ color: colors.muted, fontSize: 13, margin: "8px 0 0" }}>
        Submitting…
      </p>
    );
  }
  return (
    <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "8px 0 0" }}>
      {status.message}
    </p>
  );
}

function RunStatusLine({
  runStatus,
  blocked,
}: {
  readonly runStatus: ChatRunStatus;
  readonly blocked: boolean;
}): ReactElement {
  if (blocked) {
    return (
      <p role="status" style={{ color: colors.danger, margin: "4px 0 0", fontSize: 13 }}>
        Blocked — waiting on you
      </p>
    );
  }
  const label =
    runStatus === "running"
      ? "Running"
      : runStatus === "stopping"
        ? "Stopping"
        : "Idle";
  return (
    <p role="status" style={{ color: colors.muted, margin: "4px 0 0", fontSize: 13 }}>
      {label}
    </p>
  );
}

function ConnectionIndicator({
  state,
}: {
  readonly state: StreamConnectionState;
}): ReactElement {
  const { label, color } = CONNECTION_LABEL[state];
  return (
    <p role="status" style={{ color, margin: "4px 0 0", fontSize: 13 }}>
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

const card: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};

const cardLabel: CSSProperties = {
  fontSize: 12,
  color: colors.muted,
  marginBottom: 6,
};

const cardDescription: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  wordBreak: "break-word",
};

const textInput: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: "transparent",
  color: colors.text,
};

function decisionButton(color: string, disabled: boolean): CSSProperties {
  return {
    flex: "1 1 0",
    padding: "10px 14px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 8,
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
    borderRadius: 8,
    border: `1px solid ${selected ? colors.accent : colors.border}`,
    background: "transparent",
    color: colors.text,
    cursor: disabled ? "default" : "pointer",
  };
}
