/**
 * `compaction` block (Sprint 2) — a divider line; collapsible only when it
 * carries a `summary`.
 */
import { memo, type ReactElement } from "react";
import type { CompactionBlock as CompactionBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { MobileMarkdown } from "../../markdown/mobile-markdown";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";

function summaryLine(block: CompactionBlockType): string {
  if (block.status === "streaming") return "Compacting…";
  if (block.error !== null) return "Compaction failed";
  const pre = block.preTokens;
  const post = block.postTokens;
  const tokens = pre !== null && post !== null ? ` · ${pre}→${post} tokens` : "";
  const duration = block.durationMs !== null ? ` · ${Math.round(block.durationMs / 1000)}s` : "";
  return `Compacted${tokens}${duration}`;
}

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const CompactionBlock = memo(function CompactionBlock({
  block,
}: {
  readonly block: CompactionBlockType;
}): ReactElement {
  const label = summaryLine(block);
  const divider = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.muted, fontSize: 12 }}>
      <span style={{ flex: 1, borderTop: `1px dashed ${colors.border}` }} />
      <span>{label}</span>
      <span style={{ flex: 1, borderTop: `1px dashed ${colors.border}` }} />
    </div>
  );

  if (block.summary === null) {
    return <div style={{ margin: "8px 0" }}>{divider}</div>;
  }

  return (
    <CollapsibleCard header={divider}>
      <MobileMarkdown>{block.summary}</MobileMarkdown>
    </CollapsibleCard>
  );
});
