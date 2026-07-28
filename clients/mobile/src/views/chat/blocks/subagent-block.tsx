/**
 * `subagent` block (Sprint 2) — mandatory collapsed-by-default. Nested
 * children (recursed via `parentBlockId` in `transcript-model.ts`) render
 * inside an indented rail, any depth. `workflowMeta`, when present, appends
 * activity/agent-count/token lines to the SAME card rather than a distinct
 * component.
 */
import { memo, type ReactElement } from "react";
import type { SubAgentBlock as SubAgentBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";
import { StatusBadge } from "../status-badge";
import type { RenderableBlock } from "../transcript-model";
import { BlockList } from "../block-list";

function summaryLine(block: SubAgentBlockType): string {
  if (block.result !== null) return block.result;
  const last = block.progressUpdates[block.progressUpdates.length - 1];
  return last ?? "Starting…";
}

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const SubagentBlock = memo(function SubagentBlock({
  node,
  epicId,
  chatId,
}: {
  readonly node: RenderableBlock;
  readonly epicId: string;
  readonly chatId: string;
}): ReactElement {
  const block = node.block;
  if (block.type !== "subagent") {
    throw new Error("SubagentBlock received a non-subagent node");
  }

  const header = (
    <>
      <span style={{ fontWeight: 600 }}>{block.name ?? "Sub-agent"}</span>
      {block.agentType !== null && (
        <span style={{ color: colors.muted, fontSize: 11 }}>{block.agentType}</span>
      )}
      <span
        style={{
          color: colors.muted,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {summaryLine(block)}
      </span>
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header} accentColor={colors.accent}>
      {block.task !== null && (
        <p style={{ fontSize: 13, margin: "0 0 6px" }}>
          <strong>Task: </strong>
          {block.task}
        </p>
      )}
      {block.workflowMeta !== null && (
        <div style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
          {block.workflowMeta.intent !== null && <p style={{ margin: "0 0 4px" }}>{block.workflowMeta.intent}</p>}
          <p style={{ margin: 0 }}>
            {block.workflowMeta.agentsStarted ?? 0} agents started ·{" "}
            {block.workflowMeta.agentsFinished ?? 0} finished
            {block.workflowMeta.totalTokens !== null ? ` · ${block.workflowMeta.totalTokens} tokens` : ""}
          </p>
        </div>
      )}
      {block.progressUpdates.length > 0 && (
        <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 12, color: colors.muted }}>
          {block.progressUpdates.map((update, index) => (
            <li key={index}>{update}</li>
          ))}
        </ul>
      )}
      {node.children.length > 0 && (
        <div
          style={{
            borderLeft: `2px solid ${colors.border}`,
            paddingLeft: 10,
            marginTop: 8,
          }}
        >
          <BlockList nodes={node.children} epicId={epicId} chatId={chatId} />
        </div>
      )}
      {block.result !== null && <p style={{ fontSize: 13, margin: "6px 0 0" }}>{block.result}</p>}
    </CollapsibleCard>
  );
});
