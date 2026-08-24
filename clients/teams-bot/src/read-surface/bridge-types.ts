import { z } from "zod";
import { logWarn } from "../logger";

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
  /**
   * LOCAL-ONLY. The host's activity tracker does not replicate, so this is
   * `false` for every row where `isLocal` is false, whatever that agent is
   * actually doing. Read it as "executing ON THIS HOST", never "executing".
   */
  active: z.boolean(),
  /**
   * Whether the agent runs on the host we queried.
   *
   * `.catch` rather than a bare boolean: the bot may run against a bridge
   * binary older than the passthrough that added this field, and a strict
   * parse would turn a working fleet into a `malformed_output` card.
   * Defaulting to `true` preserves the previous behaviour exactly — every
   * row treated as local — rather than silently marking a whole fleet
   * remote on an old bridge.
   *
   * It LOGS, because the fallback restores a behaviour we now know is
   * false: every row rendered as Active/Idle when we cannot actually see
   * any of them. The bot and bridge ship together so this should never
   * fire, which is exactly why a silent path that only runs when something
   * unexpected happened deserves a line in the journal. Without it the
   * fleet would quietly go back to claiming 53 agents are idle, with
   * nothing anywhere saying why.
   */
  isLocal: z.boolean().catch(() => {
    logWarn("bridge omitted isLocal — treating every agent as local", {
      consequence: "remote agents will read Active/Idle instead of remote",
      likelyCause: "bridge binary older than the isLocal passthrough",
    });
    return true;
  }),
  hostId: z.string().catch(""),
  /**
   * What this host can DO with the agent — a different question from whether
   * it can see the agent executing, and the distinction is load-bearing.
   *
   * Measured: all 53 remote agents report `readTranscript: true` and
   * `sendMessage: false`. So "we cannot see it" and "we cannot reach it" are
   * not the same fact, and a surface that conflates them either offers
   * actions that cannot work or hides reads that would.
   *
   * `.catch` for the same forward-compatibility reason as `isLocal`, and it
   * defaults to BOTH TRUE to preserve the pre-capabilities behaviour exactly
   * — the bot offered every action to every agent before this field existed.
   */
  capabilities: z
    .object({ readTranscript: z.boolean(), sendMessage: z.boolean() })
    .catch(() => {
      logWarn(
        "bridge omitted capabilities — assuming every action is allowed",
        {
          consequence: "a Send box may appear on chats that cannot receive one",
          likelyCause: "bridge binary older than the capabilities passthrough",
        },
      );
      return { readTranscript: true, sendMessage: true };
    }),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const pendingApprovalSchema = z.object({
  approvalId: z.string(),
  toolName: z.string(),
  description: z.string(),
  requestedAt: z.number(),
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const interviewQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().nullable(),
  preview: z.string().nullable(),
});
export type InterviewQuestionOption = z.infer<
  typeof interviewQuestionOptionSchema
>;

/**
 * Mirrors the bridge's `InterviewQuestion`, which mirrors the protocol's.
 * This package holds no protocol dependency by design (see this file's
 * header), so like `pendingApprovalSchema` above it validates the bridge's
 * STDOUT rather than importing the type — the same relationship, one field
 * deeper.
 *
 * `options: []` is a free-text question, not a broken one.
 */
export const interviewQuestionSchema = z.object({
  questionId: z.string().nullable(),
  question: z.string(),
  header: z.string().nullable(),
  options: z.array(interviewQuestionOptionSchema),
  multiSelect: z.boolean(),
});
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

export const pendingInterviewSchema = z.object({
  blockId: z.string(),
  requestedAt: z.number(),
  /**
   * ALL THREE DEFAULT TO NULL, and that is a compatibility decision rather
   * than laziness about nullability.
   *
   * The bot spawns a `traycer-remote-bridge` binary at an absolute path, and
   * the two are deployed separately — so a bot carrying this schema will meet
   * a bridge that predates these fields. Required fields would fail the parse
   * and take the WHOLE status read down: no fleet, no approvals, no chat
   * status, because an interview gained a question list.
   *
   * Defaulting to `null` degrades to exactly the state the bridge already
   * defines for "the block was not found" — the card says it cannot read the
   * questions and offers no form. One unreadable-interview state, reached by
   * two routes, rather than a second one invented for old binaries.
   */
  title: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  /**
   * `null` — the questions are unknown. `[]` — known, and there are none.
   * Never render `null` as a form: see the bridge's
   * `PendingInterview.questions`.
   *
   * `.catch` rather than `.default`, following `isLocal` above, because the
   * two routes to `null` are worth telling apart in the journal even though
   * the card treats them the same. A bridge that SENDS `null` could not find
   * the block; a bridge that omits the key predates the field. `.default`
   * would silently merge them and the "why can't I answer this?" question
   * would have no answer anywhere.
   */
  questions: z
    .array(interviewQuestionSchema)
    .nullable()
    .catch(() => {
      logWarn("bridge omitted interview questions — interviews are read-only", {
        consequence:
          "the interview card offers no form and points at the desktop",
        likelyCause:
          "bridge binary older than the interview-question passthrough",
      });
      return null;
    }),
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
