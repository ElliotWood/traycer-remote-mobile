/**
 * Folds `chat.subscribe`'s `blockDelta` events into a live overlay of
 * `ContentBlock`-shaped objects (Sprint 2 / F1 accumulator) — the module
 * `use-chat.ts` currently drops both `onBlockDelta` and `onEventAppended`
 * (the latter is a SEPARATE durable timeline log of state transitions,
 * `chat-events.ts`'s `ChatEvent`, not content; this module only concerns
 * `blockDelta`'s `RuntimeEvent`).
 *
 * Cross-referencing every `RuntimeEvent` variant against its persisted
 * `ContentBlock` counterpart shows 14 of 15 types are losslessly
 * reconstructable from the live event alone — each is built directly as a
 * real, schema-valid `ContentBlock` (using the schema's own nullable
 * defaults for fields the live event doesn't carry yet), so the SAME
 * renderer components used for snapshot-sourced blocks render a live block
 * unchanged. The one gap: `tool_call.started` carries no `inputSummary`/
 * `inputDetail` (host-persist-time-only fields — see `content-blocks.ts`);
 * a live tool_call renders `toolName`-only until a later snapshot backfills
 * the real summary.
 *
 * `autonomous_resume` has no corresponding `RuntimeEvent` at all (it is
 * synthesized by the host atomically at turn-start and only reaches the
 * client via a snapshot) — this reducer never produces one, by design, not
 * omission.
 */
import type { RuntimeEvent } from "@traycer/protocol/host/agent/gui/agent-runtime";
import type {
  ApprovalBlock,
  CommandBlock,
  CompactionBlock,
  ContentBlock,
  ErrorBlock,
  FileChangeBlock,
  InterviewBlock,
  PlanBlock,
  ReasoningBlock,
  SteerBlock,
  SubAgentBlock,
  TextBlock,
  ToolCallBlock,
  TodoBlock,
} from "@traycer/protocol/persistence/epic/content-blocks";

export interface LiveTurnState {
  readonly blocks: ReadonlyMap<string, ContentBlock>;
}

export const EMPTY_LIVE_TURN: LiveTurnState = { blocks: new Map() };

/** Flat, insertion-ordered block list — feeds the same nesting/dispatch logic snapshot blocks use. */
export function liveTurnBlocks(state: LiveTurnState): readonly ContentBlock[] {
  return Array.from(state.blocks.values());
}

function withBlock(state: LiveTurnState, block: ContentBlock): LiveTurnState {
  const blocks = new Map(state.blocks);
  blocks.set(block.blockId, block);
  return { blocks };
}

function narrow<T extends ContentBlock["type"]>(
  state: LiveTurnState,
  blockId: string,
  type: T,
): Extract<ContentBlock, { type: T }> | undefined {
  const existing = state.blocks.get(blockId);
  return existing?.type === type
    ? (existing as Extract<ContentBlock, { type: T }>)
    : undefined;
}

export function foldRuntimeEvent(
  state: LiveTurnState,
  event: RuntimeEvent,
): LiveTurnState {
  const { blockId, timestamp, parentBlockId } = event;

  switch (event.type) {
    case "text.delta": {
      const prev = narrow(state, blockId, "text");
      const block: TextBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "text",
        text: (prev?.text ?? "") + event.delta,
        providerNotice: prev?.providerNotice ?? null,
      };
      return withBlock(state, block);
    }
    case "text.completed": {
      const prev = narrow(state, blockId, "text");
      if (prev === undefined) return state;
      return withBlock(state, { ...prev, status: "completed", timestamp });
    }

    case "reasoning.delta": {
      const prev = narrow(state, blockId, "reasoning");
      const block: ReasoningBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "reasoning",
        content: (prev?.content ?? "") + event.delta,
        startedAt: prev?.startedAt ?? null,
      };
      return withBlock(state, block);
    }
    case "reasoning.completed": {
      const prev = narrow(state, blockId, "reasoning");
      if (prev === undefined) return state;
      return withBlock(state, { ...prev, status: "completed", timestamp });
    }

    case "tool_call.started": {
      const block: ToolCallBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "tool_call",
        toolName: event.toolName,
        // Host-persist-time-only fields — genuinely unknown until a later
        // snapshot backfills them. See module docblock.
        inputSummary: null,
        inputDetail: null,
        taskTodoItems: null,
        error: null,
        agentMessageSend: event.agentMessageSend ?? null,
        progress: null,
        backgroundOutput: null,
        startedAt: event.startedAt ?? timestamp,
        endedAt: null,
        backgroundTask: event.backgroundTask ?? false,
        stopped: false,
      };
      return withBlock(state, block);
    }
    case "tool_call.progress": {
      const prev = narrow(state, blockId, "tool_call");
      if (prev === undefined) return state;
      return withBlock(state, { ...prev, progress: event.update, timestamp });
    }
    case "tool_call.completed": {
      const prev = narrow(state, blockId, "tool_call");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "completed",
        timestamp,
        agentMessageSend: event.agentMessageSend ?? prev.agentMessageSend,
        backgroundOutput: event.backgroundOutput ?? prev.backgroundOutput,
        backgroundTask: event.backgroundTask ?? prev.backgroundTask,
        endedAt: timestamp,
      });
    }
    case "tool_call.errored": {
      const prev = narrow(state, blockId, "tool_call");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "errored",
        timestamp,
        error: event.error,
        stopped: event.terminationReason === "stopped",
        agentMessageSend: event.agentMessageSend ?? prev.agentMessageSend,
        backgroundOutput: event.backgroundOutput ?? prev.backgroundOutput,
        backgroundTask: event.backgroundTask ?? prev.backgroundTask,
        endedAt: timestamp,
      });
    }

    case "command.started": {
      const block: CommandBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "command",
        command: event.command,
        cwd: event.cwd ?? null,
        exitCode: null,
      };
      return withBlock(state, block);
    }
    case "command.completed": {
      const prev = narrow(state, blockId, "command");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "completed",
        timestamp,
        exitCode: event.exitCode ?? null,
      });
    }

    case "file_change.started": {
      const block: FileChangeBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "file_change",
        filePath: event.filePath,
        operation: event.operation,
        diffSource: "none",
        beforeHash: null,
        afterHash: null,
        additions: 0,
        deletions: 0,
        reason: "not_intercepted",
      };
      return withBlock(state, block);
    }
    case "file_change.completed": {
      const prev = narrow(state, blockId, "file_change");
      const base: FileChangeBlock = prev ?? {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "file_change",
        filePath: event.filePath,
        operation: event.operation,
        diffSource: "none",
        beforeHash: null,
        afterHash: null,
        additions: 0,
        deletions: 0,
        reason: "not_intercepted",
      };
      return withBlock(state, {
        ...base,
        status: "completed",
        timestamp,
        diffSource: event.diffSource,
        beforeHash: event.beforeHash,
        afterHash: event.afterHash,
        additions: event.additions,
        deletions: event.deletions,
        reason: event.reason,
      });
    }

    case "artifact_operation": {
      const block: ContentBlock = {
        blockId,
        status: "completed",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "artifact_operation",
        operation: event.operation,
        kind: event.kind,
        artifactId: event.artifactId,
        title: event.title ?? null,
        beforeHash: event.beforeHash ?? null,
        afterHash: event.afterHash ?? null,
      };
      return withBlock(state, block);
    }

    case "subagent.started": {
      const block: SubAgentBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "subagent",
        name: event.name,
        agentType: event.agentType ?? null,
        task: event.task ?? null,
        progressUpdates: [],
        result: null,
        startedAt: timestamp,
        spawnToolCallId: event.spawnToolCallId ?? null,
        stopped: false,
        workflowMeta: null,
      };
      return withBlock(state, block);
    }
    case "subagent.progress": {
      const prev = narrow(state, blockId, "subagent");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        timestamp,
        progressUpdates: [...prev.progressUpdates, event.update],
      });
    }
    case "subagent.completed": {
      const prev = narrow(state, blockId, "subagent");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        timestamp,
        status: event.outcome === "completed" ? "completed" : "errored",
        stopped: event.outcome === "stopped",
        result: event.result ?? null,
      });
    }

    case "workflow.started": {
      const block: SubAgentBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "subagent",
        name: event.name,
        agentType: null,
        task: null,
        progressUpdates: [],
        result: null,
        startedAt: timestamp,
        spawnToolCallId: event.spawnToolCallId ?? null,
        stopped: false,
        workflowMeta: {
          name: event.name,
          intent: event.intent,
          activity: [],
          agentsStarted: null,
          agentsFinished: null,
          totalTokens: null,
        },
      };
      return withBlock(state, block);
    }
    case "workflow.progress": {
      const prev = narrow(state, blockId, "subagent");
      if (prev === undefined || prev.workflowMeta === null) return state;
      const meta = prev.workflowMeta;
      return withBlock(state, {
        ...prev,
        timestamp,
        workflowMeta: {
          ...meta,
          activity:
            event.activity !== null ? [...meta.activity, event.activity] : meta.activity,
          agentsStarted: event.agentsStarted ?? meta.agentsStarted,
          agentsFinished: event.agentsFinished ?? meta.agentsFinished,
          totalTokens: event.totalTokens ?? meta.totalTokens,
        },
      });
    }
    case "workflow.completed": {
      const prev = narrow(state, blockId, "subagent");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        timestamp,
        status: event.outcome === "completed" ? "completed" : "errored",
        stopped: event.outcome === "stopped",
        result: event.result ?? null,
      });
    }

    case "approval.requested": {
      const block: ApprovalBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "approval",
        toolName: event.toolName,
        description: event.description,
        inputSummary: null,
        inputDetail: null,
        decision: null,
      };
      return withBlock(state, block);
    }
    case "approval.resolved": {
      const prev = narrow(state, blockId, "approval");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "completed",
        timestamp,
        decision: { approved: event.decision.approved, reason: event.decision.reason ?? null },
      });
    }

    case "todo.updated": {
      const block: TodoBlock = {
        blockId,
        status: "completed",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "todo",
        items: event.items.map((item) => ({
          id: item.id ?? null,
          text: item.text,
          status: item.status,
          priority: item.priority ?? null,
          activeForm: item.activeForm ?? null,
        })),
      };
      return withBlock(state, block);
    }

    case "plan.delta": {
      const prev = narrow(state, blockId, "plan");
      const block: PlanBlock = prev ?? {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "plan",
        planStatus: "drafting",
        planId: event.planId,
        harnessId: event.source.harnessId,
        source: event.source,
        title: null,
        summary: null,
        markdownPreview: "",
        fullContentRef: null,
        steps: [],
        actions: [],
        approvalId: null,
        supersededByPlanId: null,
        metadata: null,
      };
      return withBlock(state, {
        ...block,
        timestamp,
        markdownPreview: block.markdownPreview + event.delta,
      });
    }
    case "plan.updated": {
      const prev = narrow(state, blockId, "plan");
      return withBlock(state, {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "plan",
        planStatus: event.planStatus,
        planId: event.planId,
        harnessId: event.source.harnessId,
        source: event.source,
        title: event.title,
        summary: event.summary,
        markdownPreview: event.markdownPreview,
        fullContentRef: event.fullContentRef,
        steps: event.steps,
        actions: event.actions,
        approvalId: event.approvalId,
        supersededByPlanId: prev?.supersededByPlanId ?? null,
        metadata: event.metadata,
      });
    }
    case "plan.completed": {
      const prev = narrow(state, blockId, "plan");
      const base: PlanBlock = prev ?? {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "plan",
        planStatus: "ready",
        planId: event.planId,
        harnessId: event.source.harnessId,
        source: event.source,
        title: null,
        summary: null,
        markdownPreview: "",
        fullContentRef: null,
        steps: [],
        actions: [],
        approvalId: null,
        supersededByPlanId: null,
        metadata: null,
      };
      return withBlock(state, {
        ...base,
        status: "completed",
        timestamp,
        planStatus: event.planStatus,
        markdownPreview: event.markdownPreview ?? base.markdownPreview,
        fullContentRef: event.fullContentRef,
        actions: event.actions,
        approvalId: event.approvalId,
      });
    }

    case "compaction.started": {
      const block: CompactionBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "compaction",
        trigger: event.trigger ?? null,
        preTokens: event.preTokens ?? null,
        postTokens: null,
        durationMs: null,
        summary: event.summary ?? null,
        error: null,
      };
      return withBlock(state, block);
    }
    case "compaction.completed": {
      const prev = narrow(state, blockId, "compaction");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "completed",
        timestamp,
        trigger: event.trigger ?? prev.trigger,
        preTokens: event.preTokens ?? prev.preTokens,
        postTokens: event.postTokens ?? null,
        durationMs: event.durationMs ?? null,
        summary: event.summary ?? prev.summary,
      });
    }
    case "compaction.errored": {
      const prev = narrow(state, blockId, "compaction");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "errored",
        timestamp,
        trigger: event.trigger ?? prev.trigger,
        preTokens: event.preTokens ?? prev.preTokens,
        error: event.error,
      });
    }

    case "interview.requested": {
      const block: InterviewBlock = {
        blockId,
        status: "streaming",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "interview",
        toolName: event.toolName,
        title: event.title ?? null,
        description: event.description ?? null,
        questions: event.questions,
        answers: [],
        error: null,
        metadata: event.metadata ?? null,
      };
      return withBlock(state, block);
    }
    case "interview.resolved": {
      const prev = narrow(state, blockId, "interview");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "completed",
        timestamp,
        answers: event.answers,
        metadata: event.metadata ?? prev.metadata,
      });
    }
    case "interview.errored": {
      const prev = narrow(state, blockId, "interview");
      if (prev === undefined) return state;
      return withBlock(state, {
        ...prev,
        status: "errored",
        timestamp,
        error: event.error,
        metadata: event.metadata ?? prev.metadata,
      });
    }

    case "error": {
      const block: ErrorBlock = {
        blockId,
        status: "completed",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "error",
        message: event.message,
        recoverable: event.recoverable,
        code: event.code ?? null,
      };
      return withBlock(state, block);
    }

    case "steer.submitted": {
      const block: SteerBlock = {
        blockId,
        status: "completed",
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "steer",
        queueItemId: event.queueItemId,
        messageId: event.messageId,
        content: event.content,
        mode: event.mode,
        sender: event.sender ?? null,
      };
      return withBlock(state, block);
    }

    case "provider_notice.upsert": {
      const block: TextBlock = {
        blockId,
        status: event.status,
        timestamp,
        parentBlockId: parentBlockId ?? null,
        type: "text",
        text: event.fallbackText,
        providerNotice: {
          harnessId: event.harnessId,
          noticeKind: event.noticeKind,
          tone: event.tone,
          title: event.title,
          message: event.message,
          details: event.details,
          metadata: event.metadata,
        },
      };
      return withBlock(state, block);
    }

    // Turn/session lifecycle bookkeeping — none of these represent a
    // renderable content block (verified against the 15-member
    // `ContentBlock` union); intentionally inert.
    case "session.created":
    case "session.resumed":
    case "turn.started":
    case "turn.completed":
    case "turn.stopped":
    case "turn.interrupted":
    case "usage.updated":
    case "user_message.anchor_resolved":
      return state;
  }
}
