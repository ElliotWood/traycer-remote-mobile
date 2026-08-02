/**
 * `subagent` — and the only block that renders OTHER blocks.
 *
 * Its children arrive already nested by `buildBlockTree` (via
 * `parentBlockId`), at any depth, and render inside an indented rail. This is
 * the structural half of transcript parity: a flat list of a subagent's tool
 * calls beside the parent's own reads as one agent doing everything.
 *
 * The tree also suppresses the `tool_call` that SPAWNED this subagent — this
 * card replaces it. Rendering both would show the spawn twice.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { SubAgentBlock as SubAgentBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import type { RenderableBlock } from "@traycer-clients/shared/epic/transcript-tree";
import { CollapsibleCard, StatusBadge } from "./block-card";
import { BlockList } from "./block-list";
import type { SnapshotDiffClient } from "./use-snapshot-diff";
import { ArtifactMarkdown } from "../../artifacts/artifact-markdown";
import { plainSummary } from "./plain-summary";

const useStyles = makeStyles({
  name: { fontWeight: tokens.fontWeightSemibold, flexShrink: 0 },
  type: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  summary: {
    color: tokens.colorNeutralForeground3,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  task: { margin: `0 0 ${tokens.spacingVerticalXS}` },
  meta: {
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
  },
  updates: {
    margin: `0 0 ${tokens.spacingVerticalXS}`,
    paddingLeft: tokens.spacingHorizontalXXL,
    color: tokens.colorNeutralForeground3,
  },
  rail: {
    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalS,
  },
  result: { margin: `${tokens.spacingVerticalXS} 0 0` },
  taskLabel: {
    display: "block",
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalXXS,
  },
});

/** The most recent thing it said, or its result once it has one. */
function summaryLine(block: SubAgentBlockType): string {
  if (block.result !== null) return block.result;
  return block.progressUpdates[block.progressUpdates.length - 1] ?? "Starting…";
}

export function SubagentBlock({
  block,
  childNodes,
  client,
}: {
  readonly block: SubAgentBlockType;
  /** Named `childNodes`, not `children`: these are transcript blocks the tree nested here, not this component's React children. */
  readonly childNodes: readonly RenderableBlock[];
  readonly client: SnapshotDiffClient | null;
}): ReactElement {
  const styles = useStyles();
  const name = block.name ?? "Sub-agent";
  const meta = block.workflowMeta;

  return (
    <CollapsibleCard
      accent="brand"
      label={`Sub-agent: ${name}`}
      header={
        <>
          <Body1 className={styles.name}>{name}</Body1>
          {block.agentType !== null ? (
            <Caption1 className={styles.type}>{block.agentType}</Caption1>
          ) : null}
          <Caption1 className={styles.summary}>
            {plainSummary(summaryLine(block))}
          </Caption1>
          <StatusBadge status={block.status} />
        </>
      }
    >
      {block.task !== null ? (
        <div className={styles.task}>
          {/*
            THE TASK IS MARKDOWN TOO, and it was the other half of this
            defect. The result was fixed and the live count went 72 -> 50
            rather than to 0: a sub-agent's task is the PROMPT it was given,
            which on this project is a full instruction with headings, rules
            and fences.
            A `div` and a separate label rather than `Body1 as="p"` with the
            text inline, because the markdown renderer emits block elements
            and a `<pre>` inside a `<p>` is invalid HTML.
          */}
          <Caption1 className={styles.taskLabel}>Task</Caption1>
          <ArtifactMarkdown body={block.task} />
        </div>
      ) : null}
      {meta !== null ? (
        <Caption1 className={styles.meta}>
          {meta.intent !== null ? `${meta.intent} · ` : ""}
          {meta.agentsStarted ?? 0} agents started · {meta.agentsFinished ?? 0}{" "}
          finished
          {meta.totalTokens !== null ? ` · ${meta.totalTokens} tokens` : ""}
        </Caption1>
      ) : null}
      {block.progressUpdates.length > 0 ? (
        <ul className={styles.updates}>
          {block.progressUpdates.map((update, index) => (
            <li key={index}>
              <Caption1>{update}</Caption1>
            </li>
          ))}
        </ul>
      ) : null}
      {childNodes.length > 0 ? (
        <div className={styles.rail}>
          <BlockList nodes={childNodes} client={client} />
        </div>
      ) : null}
      {block.result !== null ? (
        <div className={styles.result}>
          {/*
            MARKDOWN, not a text node. A subagent's result is a full report —
            headings, rules, fenced code — and printing it raw put
            "--- # How the renderer works" on screen in the deployed tab.
            The one-line caption above takes the same field through
            `plainSummary` instead: same source, two jobs.
          */}
          <ArtifactMarkdown body={block.result} />
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
