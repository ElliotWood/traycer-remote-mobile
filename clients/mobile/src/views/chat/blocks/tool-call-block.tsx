/**
 * `tool_call` block (Sprint 2) — mandatory collapsed-by-default. Header shows
 * the host-precomputed `inputSummary` (never raw args); body (on expand)
 * shows `inputDetail`, pure presentational, no fetch. A live/streaming call
 * whose `inputSummary` hasn't been backfilled yet (see `chat-live-turn.ts`)
 * shows `toolName` alone rather than a fabricated summary.
 *
 * A2A treatment: this whole build is agent-to-agent, so the user sees these
 * constantly — a raw `mcp__traycer_a2a__traycer_send_message` card with a
 * JSON args dump reads as noise. `block.agentMessageSend` is a HOST-parsed
 * field (populated only for `traycer_send_message` calls, confirmed against
 * `agent-runtime-accumulator.ts` — the same pattern desktop's
 * `tool-segment.tsx` uses to special-case this exact call) — when present,
 * it drives a purpose-built card. Every OTHER `mcp__traycer_a2a__*` call
 * (create_agent, get_transcript, list_agents, …) has no such structured
 * field, so it gets a lighter humanized-label treatment over the generic
 * `inputDetail.entries`.
 */
import { Bot, Send } from "lucide-react";
import { memo, type ReactElement } from "react";
import type { ToolCallBlock as ToolCallBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { theme } from "@/views/design-tokens";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";
import { StatusBadge } from "../status-badge";

const A2A_PREFIX = "mcp__traycer_a2a__";

function isA2AToolName(toolName: string): boolean {
  return toolName.startsWith(A2A_PREFIX);
}

/** Known method names get friendlier copy; anything new still degrades to a readable label instead of the raw identifier. */
const A2A_LABELS: Readonly<Record<string, string>> = {
  traycer_send_message: "Sent message to agent",
  traycer_create_agent: "Created agent",
  traycer_get_transcript: "Read agent transcript",
  traycer_list_agents: "Listed agents",
  traycer_fork_agent: "Forked agent",
  traycer_get_self: "Checked agent identity",
  traycer_create_worktree: "Created worktree",
  traycer_configure_agent: "Reconfigured agent",
  traycer_list_epic_workspaces: "Listed epic workspaces",
};

function humanizeA2AToolName(toolName: string): string {
  const method = toolName.slice(A2A_PREFIX.length).replace(/^traycer_/, "");
  const known = A2A_LABELS[toolName.slice(A2A_PREFIX.length)];
  if (known !== undefined) return known;
  return method.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A short agent-id display: the full id is a UUID-ish string not meant for reading at a glance. */
function shortAgentId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const ToolCallBlock = memo(function ToolCallBlock({
  block,
}: {
  readonly block: ToolCallBlockType;
}): ReactElement {
  if (block.agentMessageSend !== null) {
    return <A2ASendMessageCard block={block} send={block.agentMessageSend} />;
  }
  if (isA2AToolName(block.toolName)) {
    return <A2AGenericCard block={block} />;
  }

  const header = (
    <>
      <span style={{ fontWeight: 600 }}>{block.toolName}</span>
      {block.inputSummary !== null && (
        <span style={{ color: colors.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {block.inputSummary}
        </span>
      )}
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header}>
      {block.error !== null && (
        <p style={{ color: colors.danger, fontSize: 13 }}>{block.error}</p>
      )}
      {block.inputDetail === null ? (
        <p style={{ color: colors.muted, fontSize: 13 }}>No further detail.</p>
      ) : block.inputDetail.kind === "command" ? (
        <pre
          style={{
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          $ {block.inputDetail.command}
        </pre>
      ) : (
        <dl style={{ margin: 0 }}>
          {block.inputDetail.entries.map((entry) => (
            <div key={entry.key} style={{ marginBottom: 6 }}>
              <dt style={{ color: colors.muted, fontSize: 12 }}>{entry.label}</dt>
              <dd style={{ margin: 0, fontSize: 13, wordBreak: "break-word" }}>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </CollapsibleCard>
  );
});

function A2ASendMessageCard({
  block,
  send,
}: {
  readonly block: ToolCallBlockType;
  readonly send: NonNullable<ToolCallBlockType["agentMessageSend"]>;
}): ReactElement {
  const header = (
    <>
      <Send size={13} color={theme.primary} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>Sent message</span>
      <span style={{ color: colors.muted }}>to agent {shortAgentId(send.receiverAgentId)}</span>
      {send.expectReply && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: theme.primary,
            border: `1px solid ${theme.primary}`,
            borderRadius: 999,
            padding: "0 6px",
            flexShrink: 0,
          }}
        >
          reply expected
        </span>
      )}
      <div style={{ flex: 1 }} />
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header} accentColor={theme.primary}>
      <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {send.message}
      </p>
      {block.error !== null && (
        <p style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{block.error}</p>
      )}
    </CollapsibleCard>
  );
}

function A2AGenericCard({ block }: { readonly block: ToolCallBlockType }): ReactElement {
  const header = (
    <>
      <Bot size={13} color={theme.primary} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>{humanizeA2AToolName(block.toolName)}</span>
      {block.inputSummary !== null && (
        <span style={{ color: colors.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {block.inputSummary}
        </span>
      )}
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header} accentColor={theme.primary}>
      {block.error !== null && (
        <p style={{ color: colors.danger, fontSize: 13 }}>{block.error}</p>
      )}
      {block.inputDetail !== null && block.inputDetail.kind === "fields" && (
        <dl style={{ margin: 0 }}>
          {block.inputDetail.entries.map((entry) => (
            <div key={entry.key} style={{ marginBottom: 6 }}>
              <dt style={{ color: colors.muted, fontSize: 12 }}>{entry.label}</dt>
              <dd style={{ margin: 0, fontSize: 13, wordBreak: "break-word" }}>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </CollapsibleCard>
  );
}
