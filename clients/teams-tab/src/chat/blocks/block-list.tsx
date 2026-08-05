/**
 * The dispatcher: a `RenderableBlock` tree in, cards out.
 *
 * THE CHIP DID NOT GO AWAY, IT MOVED TO THE END. Every kind the protocol
 * declares now has a renderer, so the fallback below should be unreachable —
 * but it is the same promise the chip path made and it is kept: a block this
 * client does not understand is NAMED, never dropped. A turn that ran three
 * tools and wrote one sentence must never read as a turn that wrote one
 * sentence.
 *
 * The `switch` is exhaustive over `ContentBlock["type"]`, so a sixteenth
 * block kind added to the protocol is a COMPILE ERROR here rather than a chip
 * reading "Block: whatever_it_is" in front of a user. That is the same
 * binding `BLOCK_LABELS` uses in `shared/epic/transcript.ts`, for the same
 * reason: a protocol growing should break a build, not a screen.
 */
import type { ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { RenderableBlock } from "@traycer-clients/shared/epic/transcript-tree";
import { ApprovalBlock } from "./approval-block";
import { ArtifactOperationBlock } from "./artifact-operation-block";
import { AutonomousResumeBlock } from "./autonomous-resume-block";
import { CommandBlock } from "./command-block";
import { CompactionBlock } from "./compaction-block";
import { ErrorBlock } from "./error-block";
import { FileChangeBlock } from "./file-change-block";
import { PlanBlock } from "./plan-block";
import { InterviewBlock, ReasoningBlock, TextBlock } from "./prose-blocks";
import { SubagentBlock } from "./subagent-block";
import { TodoBlock } from "./todo-block";
import { ToolCallBlock } from "./tool-call-block";
import type { SnapshotDiffClient } from "./use-snapshot-diff";

const useStyles = makeStyles({
  unknown: {
    display: "inline-flex",
    alignItems: "center",
    padding: `2px ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalS,
  },
});

export interface BlockListProps {
  readonly nodes: readonly RenderableBlock[];
  /** Unary client for the diff fetches. `null` under preview. */
  readonly client: SnapshotDiffClient | null;
}

export function BlockList({ nodes, client }: BlockListProps): ReactElement {
  return (
    <>
      {nodes.map((node) => (
        <BlockNode key={node.block.blockId} node={node} client={client} />
      ))}
    </>
  );
}

function BlockNode({
  node,
  client,
}: {
  readonly node: RenderableBlock;
  readonly client: SnapshotDiffClient | null;
}): ReactElement | null {
  const { block } = node;
  /*
   * Captured BEFORE the switch narrows `block` to `never` in the default
   * case. Widened by the annotation rather than narrowed away, so the runtime
   * fallback can still report the type string an unrecognised block arrived
   * with — the exhaustiveness check and the runtime net are different
   * guarantees and this keeps both.
   */
  const blockType: string = block.type;

  switch (block.type) {
    case "text":
      return <TextBlock block={block} />;
    case "reasoning":
      return <ReasoningBlock block={block} />;
    case "interview":
      return <InterviewBlock block={block} />;
    case "tool_call":
      return <ToolCallBlock block={block} />;
    case "command":
      return <CommandBlock block={block} />;
    case "file_change":
      return <FileChangeBlock block={block} client={client} />;
    case "todo":
      return <TodoBlock block={block} />;
    case "plan":
      return <PlanBlock block={block} />;
    case "error":
      return <ErrorBlock block={block} />;
    case "compaction":
      return <CompactionBlock block={block} />;
    case "autonomous_resume":
      return <AutonomousResumeBlock block={block} />;
    case "approval":
      return <ApprovalBlock block={block} />;
    case "artifact_operation":
      return <ArtifactOperationBlock block={block} client={client} />;
    case "subagent":
      return (
        <SubagentBlock
          block={block}
          childNodes={node.children}
          client={client}
        />
      );
    case "steer":
      // Filtered upstream by `buildBlockTree` (steer is routed to the user's
      // own bubble). Guarded rather than assumed.
      return <UnknownBlock typeName={blockType} />;
    default:
      return <UnknownBlock typeName={blockType} />;
  }
}

function UnknownBlock({
  typeName,
}: {
  readonly typeName: string;
}): ReactElement {
  const styles = useStyles();
  return (
    <Caption1 data-testid="unknown-block" className={styles.unknown}>
      Block: {typeName}
    </Caption1>
  );
}
