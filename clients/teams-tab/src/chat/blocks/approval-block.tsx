/**
 * `approval`, as HISTORY.
 *
 * A still-pending approval is NOT rendered here. It belongs in the screen's
 * "Waiting on you" section, where it has buttons — rendering it inline as
 * well would put the same decision on screen twice, once actionable and once
 * not, and the inert copy is the one the reader would find first while
 * scrolling.
 *
 * So this returns null until a decision exists, and then shows what was
 * decided and why. `null` is the correct render for a block whose live form
 * is somewhere else on the same screen — the "no silent drop" rule is about
 * blocks the reader can find nowhere, and this one is above them.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ApprovalBlock as ApprovalBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { humaniseToolName } from "@traycer-clients/shared/epic/transcript";
import { CollapsibleCard } from "./block-card";

const useStyles = makeStyles({
  mark: { flexShrink: 0 },
  approved: { color: tokens.colorPaletteGreenForeground1 },
  rejected: { color: tokens.colorPaletteRedForeground1 },
  tool: { fontWeight: tokens.fontWeightSemibold, flexShrink: 0 },
  summary: {
    color: tokens.colorNeutralForeground3,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: { margin: `0 0 ${tokens.spacingVerticalXS}` },
  command: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
  },
  fields: { margin: 0 },
  field: { marginBottom: tokens.spacingVerticalXS },
  fieldLabel: { color: tokens.colorNeutralForeground3 },
  fieldValue: { margin: 0, wordBreak: "break-word" },
  reason: { margin: `${tokens.spacingVerticalXS} 0 0` },
});

export function ApprovalBlock({
  block,
}: {
  readonly block: ApprovalBlockType;
}): ReactElement | null {
  const styles = useStyles();
  const decision = block.decision;
  if (decision === null) return null;

  const tool =
    block.toolName === null ? "Tool" : humaniseToolName(block.toolName);
  const tone = decision.approved ? styles.approved : styles.rejected;

  return (
    <CollapsibleCard
      label={`${decision.approved ? "Approved" : "Rejected"}: ${tool}`}
      header={
        <>
          <Caption1 className={mergeClasses(styles.mark, tone)}>
            {decision.approved ? "✓" : "✗"}
          </Caption1>
          <Body1 className={styles.tool}>{tool}</Body1>
          {block.inputSummary !== null ? (
            <Caption1 className={styles.summary}>{block.inputSummary}</Caption1>
          ) : null}
        </>
      }
    >
      {block.description !== null ? (
        <Body1 as="p" className={styles.description}>
          {block.description}
        </Body1>
      ) : null}
      {block.inputDetail === null ? null : block.inputDetail.kind ===
        "command" ? (
        <pre className={styles.command}>$ {block.inputDetail.command}</pre>
      ) : (
        <dl className={styles.fields}>
          {block.inputDetail.entries.map((entry) => (
            <div key={entry.key} className={styles.field}>
              <dt className={styles.fieldLabel}>{entry.label}</dt>
              <dd className={styles.fieldValue}>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {decision.reason !== null ? (
        <Body1 as="p" className={mergeClasses(styles.reason, tone)}>
          Reason: {decision.reason}
        </Body1>
      ) : null}
    </CollapsibleCard>
  );
}
