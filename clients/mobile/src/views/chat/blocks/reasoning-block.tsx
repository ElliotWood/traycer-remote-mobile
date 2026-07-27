/**
 * `reasoning` block (Sprint 2) — mandatory collapsed-by-default (rubric §2:
 * a real chat can carry hundreds of these).
 */
import type { ReactElement } from "react";
import type { ReasoningBlock as ReasoningBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { MobileMarkdown } from "../../markdown/mobile-markdown";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";

function headerLabel(block: ReasoningBlockType): string {
  if (block.status === "streaming") return "Thinking…";
  if (block.startedAt !== null) {
    const seconds = Math.max(0, Math.round((block.timestamp - block.startedAt) / 1000));
    return `Thought for ${seconds}s`;
  }
  return "Thought";
}

export function ReasoningBlock({
  block,
}: {
  readonly block: ReasoningBlockType;
}): ReactElement {
  return (
    <CollapsibleCard header={<span style={{ color: colors.muted }}>{headerLabel(block)}</span>}>
      <MobileMarkdown>{block.content}</MobileMarkdown>
    </CollapsibleCard>
  );
}
