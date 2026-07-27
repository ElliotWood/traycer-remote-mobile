/**
 * `tool_call` block (Sprint 2) — mandatory collapsed-by-default. Header shows
 * the host-precomputed `inputSummary` (never raw args); body (on expand)
 * shows `inputDetail`, pure presentational, no fetch. A live/streaming call
 * whose `inputSummary` hasn't been backfilled yet (see `chat-live-turn.ts`)
 * shows `toolName` alone rather than a fabricated summary.
 */
import type { ReactElement } from "react";
import type { ToolCallBlock as ToolCallBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";
import { StatusBadge } from "../status-badge";

export function ToolCallBlock({
  block,
}: {
  readonly block: ToolCallBlockType;
}): ReactElement {
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
}
