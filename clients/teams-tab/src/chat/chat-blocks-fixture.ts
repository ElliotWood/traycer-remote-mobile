/**
 * REAL `ContentBlock`s, for the preview and for the tests.
 *
 * The existing `CHAT_FIXTURE` is `TranscriptMessage[]` — the WORDING
 * projection, where every non-prose block is already a label string. It could
 * not exercise a single renderer in `./blocks/`, because by the time a block
 * reaches that shape the payload the renderer draws is gone. That is the same
 * confusion the gap table made, in fixture form.
 *
 * So these are the blocks themselves, run through the real `buildBlockTree`.
 * Two consequences are deliberate and are the point of doing it this way:
 *
 *   - the `tool_call` that produced `fc-1` is SUPPRESSED here by the real
 *     rule, not omitted by hand — so the preview shows one edit, and a
 *     regression in the suppression rule changes the picture;
 *   - `tc-child` NESTS under `sa-1` because its `parentBlockId` says so, so
 *     the indented rail is produced by the projection rather than staged.
 *
 * Shaped from what a real turn produces, invented in content. Every one of
 * the fifteen protocol kinds appears except `steer` (routed to a user bubble
 * and filtered by the tree) and `text`/`reasoning` on the user side.
 */
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import {
  buildBlockTree,
  type RenderableBlock,
} from "@traycer-clients/shared/epic/transcript-tree";
import { CHAT_FIXTURE_NOW } from "./chat-fixture";

const T = CHAT_FIXTURE_NOW;

/** m2 — the working turn: reasoning, prose, an edit, a command, a to-do. */
const M2_BLOCKS: readonly ContentBlock[] = [
  {
    type: "reasoning",
    blockId: "rs-1",
    status: "completed",
    timestamp: T - 36 * 60_000,
    parentBlockId: null,
    startedAt: T - 36 * 60_000 - 9_000,
    content:
      "The existing loader throws a bare Error. zod's default message would lose the variable name, so the schema needs an explicit message per field.",
  },
  {
    type: "text",
    blockId: "tx-1",
    status: "completed",
    timestamp: T - 36 * 60_000,
    parentBlockId: null,
    providerNotice: null,
    text: "## Result\n\n```sh\nhostname\nwhoami\n```\n\n| check | value |\n| --- | --- |\n| host | reachable |\n",
  },
  /*
   * The tool call that made the edit below. It must NOT appear in the
   * preview: `fc-1`'s id is prefixed with `tc-edit:`, which is the rule
   * `buildBlockTree` suppresses on. Present precisely so the picture would
   * change if that rule broke.
   */
  {
    type: "tool_call",
    blockId: "tc-edit",
    status: "completed",
    timestamp: T - 35 * 60_000,
    parentBlockId: null,
    toolName: "Edit",
    inputSummary: "clients/teams-tab/src/config.ts",
    inputDetail: null,
    taskTodoItems: null,
    error: null,
    agentMessageSend: null,
    progress: null,
    backgroundOutput: null,
    startedAt: null,
    endedAt: null,
    backgroundTask: false,
    stopped: false,
  },
  {
    type: "file_change",
    blockId: "tc-edit:1",
    status: "completed",
    timestamp: T - 35 * 60_000,
    parentBlockId: null,
    filePath: "/srv/traycer/tenants/acme/clients/teams-tab/src/config.ts",
    operation: "edit",
    diffSource: "snapshot",
    beforeHash: "sha-before",
    afterHash: "sha-after",
    additions: 34,
    deletions: 6,
    reason: "snapshot",
  },
  {
    type: "tool_call",
    blockId: "tc-a2a",
    status: "completed",
    timestamp: T - 34 * 60_000,
    parentBlockId: null,
    toolName: "mcp__traycer_a2a__traycer_send_message",
    inputSummary: null,
    inputDetail: null,
    taskTodoItems: null,
    error: null,
    agentMessageSend: {
      // HOUSE PATTERN, and it was a REAL agent id — the id of the agent that
      // reviewed this merge, copied into shipping source in a public repo.
      // `oss-hygiene` caught it, which is the second time today a real GUID
      // reached a fixture because a plausible-looking value was pasted from a
      // live system rather than invented.
      //
      // The tell is the same one as last time: every other identifier in this
      // file follows `a1000000-…-000000000001`, and this was the only UUID
      // here with real random entropy. Entropy in a fixture means it came
      // from somewhere.
      receiverAgentId: "a1000000-0000-4000-8000-00000000a201",
      message: "Config schema is in. Want the exported type too?",
      responseId: null,
      expectReply: true,
    },
    progress: null,
    backgroundOutput: null,
    startedAt: null,
    endedAt: null,
    backgroundTask: false,
    stopped: false,
  },
  {
    type: "command",
    blockId: "cm-1",
    status: "errored",
    timestamp: T - 33 * 60_000,
    parentBlockId: null,
    command: "bun test clients/teams-tab",
    cwd: "/srv/traycer/tenants/acme",
    exitCode: 1,
  },
  {
    type: "todo",
    blockId: "td-1",
    status: "completed",
    timestamp: T - 33 * 60_000,
    parentBlockId: null,
    items: [
      {
        id: "t1",
        text: "Write the zod schema",
        status: "completed",
        priority: null,
        activeForm: null,
      },
      {
        id: "t2",
        text: "Keep the per-variable messages",
        status: "in_progress",
        priority: null,
        activeForm: null,
      },
      {
        id: "t3",
        text: "Drop the legacy loader",
        status: "cancelled",
        priority: null,
        activeForm: null,
      },
    ],
  },
  {
    type: "error",
    blockId: "er-1",
    status: "errored",
    timestamp: T - 32 * 60_000,
    parentBlockId: null,
    message: "VITE_HOST_WS_URL is required and was not set.",
    recoverable: true,
    code: "CONFIG_MISSING",
  },
];

/** m3 — intent and history: a plan, a resolved approval, an artifact write. */
const M3_BLOCKS: readonly ContentBlock[] = [
  {
    type: "plan",
    blockId: "pl-1",
    status: "completed",
    timestamp: T - 22 * 60_000,
    parentBlockId: null,
    planStatus: "approved",
    planId: "plan-1",
    harnessId: "claude",
    source: { harnessId: "claude", sessionId: null, turnId: null, kind: "plan" },
    title: "Move config onto zod",
    summary: "Schema first, then the call sites, keeping the messages.",
    markdownPreview:
      "### Steps\n\n1. Add `configSchema`\n2. Parse at module load\n3. Keep the per-variable messages\n",
    fullContentRef: null,
    steps: [
      { id: "s1", text: "Add the schema", status: "completed", activeForm: null },
      { id: "s2", text: "Parse at load", status: "completed", activeForm: null },
      { id: "s3", text: "Keep messages", status: "in_progress", activeForm: null },
      { id: "s4", text: "Delete the old loader", status: "pending", activeForm: null },
      { id: "s5", text: "Update the tests", status: "pending", activeForm: null },
      { id: "s6", text: "Re-run the gates", status: "pending", activeForm: null },
    ],
    actions: [],
    approvalId: null,
    supersededByPlanId: null,
    metadata: null,
  },
  {
    type: "approval",
    blockId: "ap-done",
    status: "completed",
    timestamp: T - 21 * 60_000,
    parentBlockId: null,
    toolName: "Edit",
    description: "Write clients/teams-tab/src/config.ts",
    inputSummary: "config.ts (+34 −6)",
    inputDetail: null,
    decision: { approved: true, reason: null },
  },
  {
    type: "artifact_operation",
    blockId: "ar-1",
    status: "completed",
    timestamp: T - 20 * 60_000,
    parentBlockId: null,
    operation: "update",
    kind: "spec",
    artifactId: "af-1",
    title: "Teams ↔ Mobile parity contract",
    beforeHash: "sha-a",
    afterHash: "sha-b",
  },
  {
    type: "compaction",
    blockId: "cp-1",
    status: "completed",
    timestamp: T - 19 * 60_000,
    parentBlockId: null,
    trigger: "auto",
    preTokens: 180_000,
    postTokens: 42_000,
    durationMs: 12_400,
    summary: "Earlier turns summarised: the loader rewrite and its two reviews.",
    error: null,
  },
];

/** m4 — a subagent with a nested child, and an autonomous resume. */
const M4_BLOCKS: readonly ContentBlock[] = [
  /*
   * The spawn call. Suppressed by `spawnToolCallId` below — the subagent card
   * replaces it. Same shape as `tc-edit`, different rule.
   */
  {
    type: "tool_call",
    blockId: "tc-spawn",
    status: "completed",
    timestamp: T - 5 * 60_000,
    parentBlockId: null,
    toolName: "Task",
    inputSummary: "Explore the config call sites",
    inputDetail: null,
    taskTodoItems: null,
    error: null,
    agentMessageSend: null,
    progress: null,
    backgroundOutput: null,
    startedAt: null,
    endedAt: null,
    backgroundTask: false,
    stopped: false,
  },
  {
    type: "subagent",
    blockId: "sa-1",
    status: "streaming",
    timestamp: T - 4 * 60_000,
    parentBlockId: null,
    name: "Explore",
    agentType: "explorer",
    task: "Find every reader of the old config loader",
    progressUpdates: ["Scanning clients/", "17 call sites so far"],
    result: null,
    startedAt: T - 5 * 60_000,
    spawnToolCallId: "tc-spawn",
    stopped: false,
    workflowMeta: null,
  },
  /* NESTS under `sa-1` — by `parentBlockId`, resolved by the real tree. */
  {
    type: "tool_call",
    blockId: "tc-child",
    status: "completed",
    timestamp: T - 4 * 60_000,
    parentBlockId: "sa-1",
    toolName: "Grep",
    inputSummary: "VITE_HOST_WS_URL",
    inputDetail: {
      kind: "fields",
      entries: [
        { key: "pattern", label: "Pattern", value: "VITE_HOST_WS_URL" },
        { key: "glob", label: "Glob", value: "clients/**/*.ts" },
      ],
    },
    taskTodoItems: null,
    error: null,
    agentMessageSend: null,
    progress: null,
    backgroundOutput: null,
    startedAt: null,
    endedAt: null,
    backgroundTask: false,
    stopped: false,
  },
  {
    type: "autonomous_resume",
    blockId: "au-1",
    status: "completed",
    timestamp: T - 3 * 60_000,
    parentBlockId: null,
    triggers: [
      {
        blockId: "au-t1",
        kind: "subagent",
        title: "Explore finished",
        status: "completed",
        summary: "17 call sites, all under clients/. None outside the workspace.",
        outputFile: null,
        mcp: null,
      },
    ],
  },
];

/**
 * Keyed by `messageId`, exactly as `use-chat.ts` builds it — the preview and
 * the live client take the same path into `TranscriptView`.
 */
export const CHAT_FIXTURE_BLOCK_TREES: ReadonlyMap<
  string,
  readonly RenderableBlock[]
> = new Map([
  ["m2", buildBlockTree(M2_BLOCKS)],
  ["m3", buildBlockTree(M3_BLOCKS)],
  ["m4", buildBlockTree(M4_BLOCKS)],
]);

export const CHAT_FIXTURE_RAW_BLOCKS: Readonly<
  Record<string, readonly ContentBlock[]>
> = { m2: M2_BLOCKS, m3: M3_BLOCKS, m4: M4_BLOCKS };
