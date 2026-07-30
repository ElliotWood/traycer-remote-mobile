import { z } from "zod";

/**
 * Mirrors `remote-bridge`'s `RemoteBridgeActions` return shapes
 * (`clients/remote-bridge/src/action-surface.ts`, on the
 * `traycer-remote-bridge` branch — not in this tree; the bridge is
 * consumed as a spawned binary, never as source, so these are hand-kept in
 * sync with its JSON output, not imported). Runtime-validated rather than
 * trusted: this is JSON parsed from a spawned process's stdout, an
 * external boundary like any other.
 */

export const agentSummarySchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  harnessId: z.string().nullable(),
  surface: z.union([z.literal("gui"), z.literal("tui")]),
  active: z.boolean(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const pendingApprovalSchema = z.object({
  approvalId: z.string(),
  toolName: z.string(),
  description: z.string(),
  requestedAt: z.number(),
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const pendingInterviewSchema = z.object({
  blockId: z.string(),
  requestedAt: z.number(),
});
export type PendingInterview = z.infer<typeof pendingInterviewSchema>;

/**
 * `connected` is not decorative — see `host-access.ts`'s contract. A caller
 * must refuse to treat any other field as current when this is `false`,
 * exactly as `remote-bridge`'s own docblock for this field specifies.
 */
export const chatStatusSchema = z.object({
  chatId: z.string(),
  title: z.string().nullable(),
  runStatus: z.union([
    z.literal("idle"),
    z.literal("running"),
    z.literal("stopping"),
  ]),
  pendingApprovals: z.array(pendingApprovalSchema),
  pendingInterviews: z.array(pendingInterviewSchema),
  connected: z.boolean(),
});
export type ChatStatus = z.infer<typeof chatStatusSchema>;

export const agentListSchema = z.array(agentSummarySchema);

/**
 * `remote-bridge` does not have an `epics` command yet — this is the
 * anticipated shape of one, not a contract that exists today. See
 * `bridge-cli.ts`'s `listEpics` docblock: fixtured in this package's own
 * tests, backed by a real spawn only once the bridge ships the command.
 */
export const epicSummarySchema = z.object({
  epicId: z.string(),
  title: z.string().nullable(),
});
export type EpicSummary = z.infer<typeof epicSummarySchema>;
export const epicListSchema = z.array(epicSummarySchema);

/**
 * `ActionOutcome` from `remote-bridge`'s action surface. Exactly three
 * states, and the distinction matters: `applied` and `rejected` both mean
 * the fate is KNOWN, `failed` means unconfirmed — the action may still have
 * landed with no way for this process to know. Never render `failed` as
 * "didn't happen".
 */
export const actionOutcomeSchema = z.union([
  z.object({ kind: z.literal("applied") }),
  z.object({
    kind: z.literal("rejected"),
    reason: z.string().nullable(),
    code: z.string().nullable(),
  }),
  z.object({ kind: z.literal("failed"), reason: z.string() }),
]);
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

/**
 * P1 transcript. A PROJECTION, not the host's message shape.
 *
 * The host's `chat.messages[]` carries assistant rows whose content is an
 * array of fifteen different content-block types — text, reasoning, tool
 * calls, file changes, commands, sub-agents, plans, interviews and more.
 * Teaching this package to walk that union would give it exactly the
 * protocol knowledge its own package description says it does not hold, and
 * would bind card rendering to a schema that changes for reasons that have
 * nothing to do with Teams.
 *
 * So the bridge flattens each message to prose plus a list of non-prose
 * PARTS, and this validates that flattened shape. One projection, kept where
 * the protocol types already are.
 */
export const transcriptPartSchema = z.object({
  kind: z.union([
    z.literal("code"),
    z.literal("table"),
    z.literal("tool"),
    z.literal("file_change"),
    z.literal("command"),
    z.literal("error"),
    z.literal("other"),
  ]),
  /** Short human label: a file path, a command, a tool name. */
  label: z.string(),
  /** Line count where the part is line-shaped, else 0. */
  lines: z.number().int().nonnegative(),
});
export type TranscriptPart = z.infer<typeof transcriptPartSchema>;

export const transcriptMessageSchema = z.object({
  messageId: z.string(),
  role: z.union([z.literal("user"), z.literal("assistant")]),
  /** Display name of the sender; `null` when the bridge could not name one. */
  author: z.string().nullable(),
  timestamp: z.number(),
  /** The message's prose, already flattened out of its blocks. */
  text: z.string(),
  parts: z.array(transcriptPartSchema),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

export const transcriptSchema = z.object({
  chatId: z.string(),
  title: z.string().nullable(),
  /**
   * How many messages the chat has IN TOTAL, not how many are in `messages`.
   * Without it a card cannot honestly say "20 of 214" and would have to imply
   * that a window is the whole history.
   */
  totalCount: z.number().int().nonnegative(),
  /**
   * How many of the NEWEST messages this window skips — i.e. the offset is
   * measured from the RECENT end, not from message #1.
   *
   * Stated this way round on purpose. Paging here runs newest-first: you
   * land on the current state and walk backwards. An offset measured from
   * the oldest message would mean "show me the latest" requires knowing
   * `totalCount` first, and every page boundary shifts as new messages
   * arrive. Measured from the newest end, `offset: 0` is always "now" and a
   * page you have already loaded keeps its contents.
   */
  offset: z.number().int().nonnegative(),
  /** The window itself, always oldest-first WITHIN the window. */
  messages: z.array(transcriptMessageSchema),
});
export type Transcript = z.infer<typeof transcriptSchema>;
