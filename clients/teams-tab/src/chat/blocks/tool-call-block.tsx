/**
 * `tool_call` — the block a reader sees most, so it is the one that most
 * needs to not be a chip.
 *
 * The header carries the host-precomputed `inputSummary`, never raw args: the
 * host already decided what is safe and short to show, and re-deriving it
 * here would be a second opinion that drifts. A live call whose summary has
 * not been backfilled shows the tool name alone rather than a fabricated one.
 *
 * A2A calls get their own treatment because this whole build is
 * agent-to-agent and the user sees them constantly. A raw
 * `mcp__traycer_a2a__traycer_send_message` with a JSON dump reads as noise.
 * `agentMessageSend` is host-parsed and present only for the send call, so
 * when it is there the message itself is the card.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { ToolCallBlock as ToolCallBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { humaniseToolName } from "@traycer-clients/shared/epic/transcript";
import { CollapsibleCard, StatusBadge } from "./block-card";

const useStyles = makeStyles({
  name: { fontWeight: tokens.fontWeightSemibold, flexShrink: 0 },
  summary: {
    color: tokens.colorNeutralForeground3,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  error: { color: tokens.colorPaletteRedForeground1, margin: 0 },
  command: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  fields: { margin: 0 },
  field: { marginBottom: tokens.spacingVerticalXS },
  fieldLabel: { color: tokens.colorNeutralForeground3 },
  fieldValue: { margin: 0, wordBreak: "break-word" },
  message: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  pill: {
    color: tokens.colorBrandForeground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusCircular,
    padding: `0 ${tokens.spacingHorizontalS}`,
    flexShrink: 0,
  },
  spacer: { flex: 1 },
});

const A2A_PREFIX = "mcp__traycer_a2a__";

/** A UUID-ish agent id is not meant to be read at a glance. */
function shortAgentId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function ToolCallBlock({
  block,
}: {
  readonly block: ToolCallBlockType;
}): ReactElement {
  const styles = useStyles();
  const send = block.agentMessageSend;
  const isA2A = block.toolName.startsWith(A2A_PREFIX);

  if (send !== null) {
    return (
      <CollapsibleCard
        accent="brand"
        label={`Message sent to agent ${shortAgentId(send.receiverAgentId)}`}
        header={
          <>
            <Body1 className={styles.name}>Sent message</Body1>
            <Caption1 className={styles.summary}>
              to agent {shortAgentId(send.receiverAgentId)}
            </Caption1>
            {send.expectReply ? (
              <Caption1 className={styles.pill}>reply expected</Caption1>
            ) : null}
            <span className={styles.spacer} />
            <StatusBadge status={block.status} />
          </>
        }
      >
        <Body1 className={styles.message}>{send.message}</Body1>
        {block.error !== null ? (
          <Caption1 className={styles.error}>{block.error}</Caption1>
        ) : null}
      </CollapsibleCard>
    );
  }

  /*
   * `humaniseToolName` comes from `shared/epic/transcript.ts` rather than a
   * local copy. What a tool call is CALLED is protocol grammar — the answer
   * is identical in every client — and the chip path already reads it from
   * there. Two spellings of one tool name across two paths in the same view
   * is exactly the drift that rule exists to prevent.
   */
  const name = isA2A ? humaniseToolName(block.toolName) : block.toolName;

  return (
    <CollapsibleCard
      accent={isA2A ? "brand" : undefined}
      label={`Tool call: ${name}`}
      header={
        <>
          <Body1 className={styles.name}>{name}</Body1>
          {block.inputSummary !== null ? (
            <Caption1 className={styles.summary}>{block.inputSummary}</Caption1>
          ) : (
            <span className={styles.spacer} />
          )}
          <StatusBadge status={block.status} />
        </>
      }
    >
      {block.error !== null ? (
        <Caption1 className={styles.error}>{block.error}</Caption1>
      ) : null}
      {block.inputDetail === null ? (
        <Caption1 className={styles.fieldLabel}>No further detail.</Caption1>
      ) : block.inputDetail.kind === "command" ? (
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
    </CollapsibleCard>
  );
}
