/**
 * `approval` block, RESOLVED transcript view (Sprint 2). A still-pending
 * approval is NOT rendered here — it stays in `ChatView`'s existing
 * `PendingSection`, untouched. This only shows a decided approval as a
 * historical record.
 */
import type { ReactElement } from "react";
import type { ApprovalBlock as ApprovalBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";

export function ApprovalBlock({
  block,
}: {
  readonly block: ApprovalBlockType;
}): ReactElement | null {
  if (block.decision === null) return null;
  const approved = block.decision.approved;

  const header = (
    <>
      <span style={{ color: approved ? "#3fb950" : colors.danger }}>{approved ? "✓" : "✗"}</span>
      <span style={{ fontWeight: 600 }}>{block.toolName ?? "Tool"}</span>
      {block.inputSummary !== null && (
        <span style={{ color: colors.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {block.inputSummary}
        </span>
      )}
    </>
  );

  return (
    <CollapsibleCard header={header}>
      {block.description !== null && (
        <p style={{ fontSize: 13, margin: "0 0 6px" }}>{block.description}</p>
      )}
      {block.inputDetail !== null &&
        (block.inputDetail.kind === "command" ? (
          <pre style={{ margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
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
        ))}
      {block.decision.reason !== null && (
        <p style={{ fontSize: 13, color: approved ? colors.text : colors.danger, margin: "6px 0 0" }}>
          Reason: {block.decision.reason}
        </p>
      )}
    </CollapsibleCard>
  );
}
