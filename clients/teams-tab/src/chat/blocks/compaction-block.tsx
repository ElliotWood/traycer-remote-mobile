/**
 * `compaction` — history was summarised and discarded.
 *
 * Rendered as a divider rather than a card, because that is what it is: a
 * seam in the conversation. What matters to a reader scrolling past is that
 * the transcript above it is a summary, not the original, and the token
 * counts are the honest measure of how much is no longer there.
 *
 * It collapses only when it carries a `summary` — a disclosure with nothing
 * behind it is a control that lies about having content.
 */
import type { ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { CompactionBlock as CompactionBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { ArtifactMarkdown } from "../../artifacts/artifact-markdown";
import { CollapsibleCard } from "./block-card";

const useStyles = makeStyles({
  divider: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    width: "100%",
  },
  rule: { flex: 1, borderTop: `1px dashed ${tokens.colorNeutralStroke2}` },
  standalone: { margin: `${tokens.spacingVerticalS} 0` },
});

function summaryLine(block: CompactionBlockType): string {
  if (block.status === "streaming") return "Compacting…";
  if (block.error !== null) return "Compaction failed";
  const { preTokens: pre, postTokens: post } = block;
  const tokenText = pre !== null && post !== null ? ` · ${pre}→${post} tokens` : "";
  const duration =
    block.durationMs !== null
      ? ` · ${Math.round(block.durationMs / 1000)}s`
      : "";
  return `Compacted${tokenText}${duration}`;
}

export function CompactionBlock({
  block,
}: {
  readonly block: CompactionBlockType;
}): ReactElement {
  const styles = useStyles();
  const label = summaryLine(block);
  const divider = (
    <span className={styles.divider}>
      <span className={styles.rule} />
      <Caption1>{label}</Caption1>
      <span className={styles.rule} />
    </span>
  );

  if (block.summary === null) {
    return <div className={styles.standalone}>{divider}</div>;
  }
  return (
    <CollapsibleCard label={label} header={divider}>
      <ArtifactMarkdown body={block.summary} />
    </CollapsibleCard>
  );
}
