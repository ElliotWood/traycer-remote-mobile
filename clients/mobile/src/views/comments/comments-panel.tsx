/**
 * Comment threads panel (S4, F4): read + create/reply/resolve for one
 * artifact's comment threads, over the existing unary `HostClient` — no new
 * transport, bearer-only, pull-based (refetch after every write, no push
 * stream).
 *
 * Deliberately embeddable: props are exactly `{epicId, artifactType,
 * artifactId}` — the client itself comes from `useHostClientOrNull()`
 * (matching `EpicView`/`ChatView`'s pattern of sourcing shared services from
 * context, not props), so a future artifact view (Sprint 3) can mount this
 * directly. This sprint proves it via a standalone harness route
 * (`app-shell.tsx`'s `?comments=1&epicId=&artifactType=&artifactId=`).
 *
 * Every thread renders always-expanded (no collapse/expand toggle) - mobile
 * has no sidebar real-estate pressure to manage, so desktop's collapsed-by-
 * default affordance is deliberately not ported.
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import type { EpicArtifactKind } from "@traycer/protocol/common/registry";
import type { CommentThreadWire } from "@traycer/protocol/host/epic/unary-schemas";
import { useHostClientOrNull, type MobileHostClient } from "@/host/host-client-context";
import { useCommentThreads } from "@/host/use-comment-threads";
import {
  useCreateCommentThread,
  useReplyToCommentThread,
  useSetCommentThreadResolved,
} from "@/host/use-comment-thread-mutations";
import { plainTextContent } from "@/host/use-create-chat";
import { colors, screen, secondaryButton } from "../ui";
import { CommentContent } from "./comment-content";

export interface CommentsPanelProps {
  readonly epicId: string;
  readonly artifactType: EpicArtifactKind;
  readonly artifactId: string;
}

export function CommentsPanel(props: CommentsPanelProps): ReactElement {
  const client = useHostClientOrNull();
  if (client === null) {
    return (
      <main style={screen}>
        <p style={{ color: colors.muted }}>Not connected to a host.</p>
      </main>
    );
  }
  return <ConnectedCommentsPanel {...props} client={client} />;
}

interface ConnectedCommentsPanelProps extends CommentsPanelProps {
  readonly client: MobileHostClient;
}

function ConnectedCommentsPanel({
  client,
  epicId,
  artifactType,
  artifactId,
}: ConnectedCommentsPanelProps): ReactElement {
  const { threads, isLoading, isError, refetch } = useCommentThreads(client, {
    epicId,
    artifactType,
    artifactId,
  });

  if (isLoading) {
    return (
      <main style={screen}>
        <p style={{ color: colors.muted }}>Loading comments…</p>
      </main>
    );
  }

  if (isError) {
    return (
      <main style={screen}>
        <p role="alert" style={{ color: colors.danger, marginBottom: 12 }}>
          Couldn't load comments.
        </p>
        <button
          type="button"
          style={{ ...secondaryButton, minHeight: 44 }}
          onClick={refetch}
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <main style={screen}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Comments</h1>

      <NewThreadComposer
        client={client}
        epicId={epicId}
        artifactType={artifactType}
        artifactId={artifactId}
      />

      {threads.length > 0 ? (
        <ul style={threadListStyle}>
          {threads.map((thread) => (
            <ThreadCard
              key={thread.threadId}
              client={client}
              epicId={epicId}
              artifactType={artifactType}
              artifactId={artifactId}
              thread={thread}
            />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

interface ScopeProps {
  readonly client: MobileHostClient;
  readonly epicId: string;
  readonly artifactType: EpicArtifactKind;
  readonly artifactId: string;
}

/**
 * "Start a thread" composer, always visible at the top (an empty thread list
 * shows only this - no separate placeholder copy). Creates always send
 * `quotedText: ""` - mobile has no text-selection/anchor-capture UI yet (a
 * future Sprint 3 integration point, not this sprint's scope).
 */
function NewThreadComposer({
  client,
  epicId,
  artifactType,
  artifactId,
}: ScopeProps): ReactElement {
  const createMutation = useCreateCommentThread(client);
  const [text, setText] = useState("");
  const canSubmit = text.trim().length > 0 && !createMutation.isPending;

  const handleSubmit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || createMutation.isPending) return;
    createMutation.mutate(
      {
        epicId,
        artifactType,
        artifactId,
        content: plainTextContent(trimmed),
        quotedText: "",
      },
      { onSuccess: () => setText("") },
    );
  };

  return (
    <section style={composerSectionStyle} aria-label="Start a thread">
      <textarea
        value={text}
        disabled={createMutation.isPending}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start a thread…"
        aria-label="New comment"
        rows={3}
        style={textareaStyle}
      />
      <button
        type="button"
        disabled={!canSubmit}
        style={touchButton(colors.accent, !canSubmit)}
        onClick={handleSubmit}
      >
        {createMutation.isPending ? "Posting…" : "Add comment"}
      </button>
      {createMutation.isError ? (
        <p role="alert" style={errorTextStyle}>
          Couldn't post comment.
        </p>
      ) : null}
    </section>
  );
}

interface ThreadCardProps extends ScopeProps {
  readonly thread: CommentThreadWire;
}

function ThreadCard({
  client,
  epicId,
  artifactType,
  artifactId,
  thread,
}: ThreadCardProps): ReactElement {
  const replyMutation = useReplyToCommentThread(client);
  const resolvedMutation = useSetCommentThreadResolved(client);
  const [replyText, setReplyText] = useState("");
  const quotedText = thread.data.quotedText ?? "";
  const canReply = replyText.trim().length > 0 && !replyMutation.isPending;

  const handleReply = (): void => {
    const trimmed = replyText.trim();
    if (trimmed.length === 0 || replyMutation.isPending) return;
    replyMutation.mutate(
      {
        epicId,
        artifactType,
        artifactId,
        threadId: thread.threadId,
        content: plainTextContent(trimmed),
      },
      { onSuccess: () => setReplyText("") },
    );
  };

  const handleToggleResolved = (): void => {
    resolvedMutation.mutate({
      epicId,
      artifactType,
      artifactId,
      threadId: thread.threadId,
      resolved: !thread.resolved,
    });
  };

  return (
    <li
      style={cardStyle}
      data-testid="comment-thread-card"
      data-resolved={thread.resolved ? "true" : "false"}
    >
      {quotedText.length > 0 ? (
        <blockquote style={quoteStyle}>{quotedText}</blockquote>
      ) : null}

      <ul style={commentListStyle}>
        {thread.comments.map((comment) => (
          <li key={comment.commentId} style={commentItemStyle}>
            <div style={commentMetaStyle}>
              <span style={{ fontWeight: 600 }}>
                {comment.author.fallbackHandle ?? comment.author.userId}
              </span>
              <span style={{ color: colors.muted }}>
                {formatRelativeTime(comment.createdAt)}
              </span>
            </div>
            <CommentContent content={comment.content} />
          </li>
        ))}
      </ul>

      <div style={statusRowStyle}>
        {thread.resolved ? <span style={resolvedBadgeStyle}>Resolved</span> : null}
        <button
          type="button"
          disabled={resolvedMutation.isPending}
          style={touchButton(colors.muted, resolvedMutation.isPending)}
          onClick={handleToggleResolved}
        >
          {resolvedMutation.isPending
            ? thread.resolved
              ? "Reopening…"
              : "Resolving…"
            : thread.resolved
              ? "Reopen"
              : "Resolve"}
        </button>
      </div>
      {resolvedMutation.isError ? (
        <p role="alert" style={errorTextStyle}>
          Couldn't update the thread.
        </p>
      ) : null}

      <textarea
        value={replyText}
        disabled={replyMutation.isPending}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="Reply…"
        aria-label="Reply"
        rows={2}
        style={textareaStyle}
      />
      <button
        type="button"
        disabled={!canReply}
        style={touchButton(colors.accent, !canReply)}
        onClick={handleReply}
      >
        {replyMutation.isPending ? "Replying…" : "Reply"}
      </button>
      {replyMutation.isError ? (
        <p role="alert" style={errorTextStyle}>
          Couldn't post reply.
        </p>
      ) : null}
    </li>
  );
}

/** Same relative-time buckets as gui-app's comment sidebar. */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes.toString()}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toString()}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days.toString()}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** ≥44px touch target (rubric §2) - explicit, not an eyeballed padding guess. */
function touchButton(color: string, disabled: boolean): CSSProperties {
  return {
    minHeight: 44,
    padding: "10px 16px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    marginTop: 8,
  };
}

const threadListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const cardStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};

const quoteStyle: CSSProperties = {
  margin: "0 0 10px",
  padding: "2px 0 2px 10px",
  borderLeft: `2px solid ${colors.muted}`,
  color: colors.muted,
  fontStyle: "italic",
  fontSize: 13,
  overflowWrap: "anywhere",
};

const commentListStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const commentItemStyle: CSSProperties = { marginBottom: 10 };

const commentMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  marginBottom: 2,
};

const statusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 4,
};

const resolvedBadgeStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: colors.text,
  background: colors.border,
  borderRadius: 999,
  padding: "2px 8px",
};

const composerSectionStyle: CSSProperties = { marginBottom: 20 };

const textareaStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 14,
  lineHeight: 1.4,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: "transparent",
  color: colors.text,
  resize: "vertical",
  fontFamily: "inherit",
};

const errorTextStyle: CSSProperties = {
  color: colors.danger,
  fontSize: 13,
  margin: "6px 0 0",
};
