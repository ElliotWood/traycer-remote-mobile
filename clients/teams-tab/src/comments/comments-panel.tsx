/**
 * Comment threads on an artifact: read, reply, resolve.
 *
 * All three RPCs are unary and USER-scoped — `epic.listCommentThreads`,
 * `epic.replyToCommentThread`, `epic.setCommentThreadResolved`. No agent
 * identity, and no locality gate: unlike an owner frame on a chat, a comment
 * is addressed to the epic rather than to a running agent, so it does not
 * depend on which host the agent is on.
 *
 * Worth stating because the surrounding surfaces all needed that gate: this
 * one genuinely does not, and inheriting it "for consistency" would disable
 * commenting on 53 of 56 chats' artifacts for no reason.
 */
import { useState, type ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  CommentMultipleRegular,
} from "@fluentui/react-icons";
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";
import { CommentContent } from "./comment-content";
import { terseTime } from "../fleet/fleet-grid";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  thread: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  /** Resolved threads recede — present, readable, visibly not open. */
  resolved: { opacity: 0.72 },
  head: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  /**
   * The quoted artifact text a thread was anchored to.
   *
   * Rendered when present, because a comment about a passage read without the
   * passage is the untitled-row defect in a third form — the reader supplies
   * the wrong context. `quotedText` is `optional()` on the wire, and its
   * absence means the anchor was lost, not that the thread has no subject.
   */
  quote: {
    borderLeft: `3px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  comment: { display: "flex", flexDirection: "column", gap: "2px" },
  author: { fontWeight: tokens.fontWeightSemibold },
  meta: { color: tokens.colorNeutralForeground3 },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * Never a bare user id — fifth surface for this rule.
 *
 * `fallbackHandle` is nullable on the wire. When it is absent the id is
 * shortened AND labelled, because an unlabelled hex string where a person's
 * name belongs reads as a name, and the reader concludes someone is called
 * "a3f2b1c4".
 */
function authorName(author: {
  readonly userId: string;
  readonly fallbackHandle: string | null;
}): string {
  const handle = author.fallbackHandle?.trim() ?? "";
  if (handle.length > 0) return handle;
  return `Unknown user (${author.userId.slice(0, 8)})`;
}

export interface CommentsPanelProps {
  readonly threads: readonly CommentThreadWire[];
  readonly now: number;
  readonly busyThreadId: string | null;
  readonly onReply: (threadId: string, text: string) => void;
  readonly onSetResolved: (threadId: string, resolved: boolean) => void;
}

export function CommentsPanel({
  threads,
  now,
  busyThreadId,
  onReply,
  onSetResolved,
}: CommentsPanelProps): ReactElement {
  const styles = useStyles();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (threads.length === 0) {
    return (
      <div className={styles.empty}>
        <Body1>No comments on this artifact.</Body1>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {threads.map((thread) => {
        const draft = drafts[thread.threadId] ?? "";
        const busy = busyThreadId === thread.threadId;
        const quoted = thread.data.quotedText;
        return (
          <div
            key={thread.threadId}
            className={
              thread.resolved
                ? `${styles.thread} ${styles.resolved}`
                : styles.thread
            }
          >
            <div className={styles.head}>
              <span aria-hidden className={styles.icon}>
                {thread.resolved ? (
                  <CheckmarkCircleRegular fontSize={16} />
                ) : (
                  <CommentMultipleRegular fontSize={16} />
                )}
              </span>
              <Caption1 className={styles.meta}>
                {thread.resolved ? "Resolved" : "Open"} ·{" "}
                {terseTime(thread.createdAt, now)}
              </Caption1>
            </div>

            {quoted !== undefined && quoted.trim().length > 0 ? (
              <Caption1 className={styles.quote}>{quoted}</Caption1>
            ) : null}

            {thread.comments.map((comment) => (
              <div key={comment.commentId} className={styles.comment}>
                <Caption1 className={styles.author}>
                  {authorName(comment.author)}
                </Caption1>
                <CommentContent content={comment.content} />
              </div>
            ))}

            <Textarea
              value={draft}
              disabled={busy}
              placeholder="Reply…"
              resize="vertical"
              onChange={(_, data) => {
                setDrafts((p) => ({ ...p, [thread.threadId]: data.value }));
              }}
            />
            <div className={styles.actions}>
              <Button
                appearance="primary"
                disabled={busy || draft.trim().length === 0}
                onClick={() => {
                  onReply(thread.threadId, draft.trim());
                  setDrafts((p) => ({ ...p, [thread.threadId]: "" }));
                }}
              >
                {busy ? "Sending…" : "Reply"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  onSetResolved(thread.threadId, !thread.resolved);
                }}
              >
                {thread.resolved ? "Reopen" : "Resolve"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
