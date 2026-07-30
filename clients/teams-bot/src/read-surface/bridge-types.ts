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
