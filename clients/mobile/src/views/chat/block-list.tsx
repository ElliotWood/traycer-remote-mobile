/**
 * Dispatches a `RenderableBlock[]` (from `transcript-model.ts`'s
 * `buildBlockTree`) to the per-type block components (Sprint 2). `steer`
 * never reaches here (routed to a user bubble upstream); an unrecognized
 * shape renders a labeled fallback rather than throwing (rubric §4).
 */
import { memo, type ReactElement } from "react";
import type { RenderableBlock } from "./transcript-model";
import { ErrorBoundary } from "../error-boundary";
import { colors } from "../ui";
import { TextBlock } from "./blocks/text-block";
import { ReasoningBlock } from "./blocks/reasoning-block";
import { ToolCallBlock } from "./blocks/tool-call-block";
import { CommandBlock } from "./blocks/command-block";
import { FileChangeBlock } from "./blocks/file-change-block";
import { TodoBlock } from "./blocks/todo-block";
import { PlanBlock } from "./blocks/plan-block";
import { ErrorBlock } from "./blocks/error-block";
import { CompactionBlock } from "./blocks/compaction-block";
import { AutonomousResumeBlock } from "./blocks/autonomous-resume-block";
import { InterviewBlock } from "./blocks/interview-block";
import { ApprovalBlock } from "./blocks/approval-block";
import { ArtifactOperationBlock } from "./blocks/artifact-operation-block";
import { SubagentBlock } from "./blocks/subagent-block";

export interface BlockListProps {
  readonly nodes: readonly RenderableBlock[];
  readonly epicId: string;
  readonly chatId: string;
}

/** Perf batch 2 (B2-3): memoized so a caller passing STABLE `nodes`/`epicId`/`chatId` (see `transcript-view.tsx`'s `useMemo`) skips this whole subtree on an unrelated re-render. */
export const BlockList = memo(function BlockList({ nodes, epicId, chatId }: BlockListProps): ReactElement {
  return (
    <>
      {nodes.map((node) => (
        // One malformed/throwing block must never take out the whole
        // transcript — a compact fallback replaces just this card.
        <ErrorBoundary key={node.block.blockId} label="this block" compact>
          <BlockNode node={node} epicId={epicId} chatId={chatId} />
        </ErrorBoundary>
      ))}
    </>
  );
});

const BlockNode = memo(function BlockNode({
  node,
  epicId,
  chatId,
}: {
  readonly node: RenderableBlock;
  readonly epicId: string;
  readonly chatId: string;
}): ReactElement | null {
  const { block } = node;
  switch (block.type) {
    case "text":
      return <TextBlock block={block} />;
    case "reasoning":
      return <ReasoningBlock block={block} />;
    case "tool_call":
      return <ToolCallBlock block={block} />;
    case "command":
      return <CommandBlock block={block} />;
    case "file_change":
      return <FileChangeBlock block={block} />;
    case "todo":
      return <TodoBlock block={block} />;
    case "plan":
      return <PlanBlock block={block} epicId={epicId} chatId={chatId} />;
    case "error":
      return <ErrorBlock block={block} />;
    case "compaction":
      return <CompactionBlock block={block} />;
    case "autonomous_resume":
      return <AutonomousResumeBlock block={block} />;
    case "interview":
      return <InterviewBlock block={block} />;
    case "approval":
      return <ApprovalBlock block={block} />;
    case "artifact_operation":
      return <ArtifactOperationBlock block={block} epicId={epicId} />;
    case "subagent":
      return <SubagentBlock node={node} epicId={epicId} chatId={chatId} />;
    case "steer":
      // Never reaches here — filtered upstream (routed to a user bubble).
      // Guarded for defense-in-depth, not expected to execute.
      return <UnsupportedBlock typeName={block.type} />;
    default: {
      // Runtime safety net beyond the 15 known types: a future/unrecognized
      // block shape renders a labeled fallback, never throws (rubric §4).
      const unknownBlock = block as unknown as { readonly type: string };
      return <UnsupportedBlock typeName={unknownBlock.type} />;
    }
  }
});

function UnsupportedBlock({ typeName }: { readonly typeName: string }): ReactElement {
  return (
    <div
      data-testid="unsupported-block"
      style={{
        border: `1px dashed ${colors.border}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        color: colors.muted,
        fontSize: 13,
      }}
    >
      Unsupported block ({typeName})
    </div>
  );
}
