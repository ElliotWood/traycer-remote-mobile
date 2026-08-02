/**
 * Notification rows for the screenshots.
 *
 * SHAPED from the real feed, INVENTED in content — this URL is served
 * unauthenticated, so everything here is public by construction. Ids follow
 * the house pattern (`e1000000-…-000000000001`) rather than carrying real
 * entropy, which is the tell that caught a real host GUID in the authoring
 * fixture.
 *
 * BUILT WITH `.parse()`, NOT A CAST. `as unknown as HostNotificationEntry`
 * compiles against a shape that has already drifted, and the recorded cost of
 * that shortcut on this codebase was a fixture missing a field whose renderer
 * then died on a TypeError — a test that "fails before the fix" and hides that
 * the fix does not work. Parsing applies the protocol's own defaults and fails
 * loudly here instead.
 *
 * WHAT THE SHAPE HAS TO COVER, so the shot is worth taking:
 *   - all FOUR severities, so every stripe colour appears;
 *   - both `resolvedAt`-carrying kinds, because dismissing those RESOLVES
 *     rather than marks-read and that is the branch worth seeing;
 *   - read and unread rows, so the unread dot and the toggle both do
 *     something;
 *   - ages spanning today / yesterday / earlier, since day grouping is the
 *     layout being reviewed.
 *
 * PAYLOADS MATCH THE KNOWN-PAYLOAD SCHEMAS, and the first draft did not — it
 * carried a plausible `{ agentName, title }` on every row. That parses as
 * `null`, so `formatHostNotificationPresentation` degraded every row to its
 * generic copy and the preview rendered FIVE ROWS ALL TITLED "Task".
 *
 * The fallback behaving correctly is why this was worth catching rather than
 * shrugging at: nothing threw, nothing was empty, and the screen looked
 * plausible — a fixture that silently reviews the degraded path instead of the
 * real one. `parseKnownHostNotificationPayloadForKind` keys off `payload.kind`
 * (`approval`, `interview`, `workspace_operation_failed`, `chat`,
 * `agent_stalled`), which is a DIFFERENT enum from the entry's own `kind`.
 */
import {
  hostNotificationEntrySchema,
  type HostNotificationEntry,
} from "@traycer/protocol/host/notifications/host-notifications";

/** A fixed instant, so the day buckets are stable across runs. */
export const NOTIFICATIONS_NOW = 1_800_000_000_000;

const T = NOTIFICATIONS_NOW;
const EPIC_A = "e1000000-0000-4000-8000-000000000001";
const EPIC_B = "e2000000-0000-4000-8000-000000000002";
const CHAT_1 = "c1000000-0000-4000-8000-000000000001";
const CHAT_2 = "c2000000-0000-4000-8000-000000000002";
const CHAT_3 = "c3000000-0000-4000-8000-000000000003";
const CHAT_4 = "c4000000-0000-4000-8000-000000000004";
const CHAT_5 = "c5000000-0000-4000-8000-000000000005";

/** Invented epic names. The row's headline is `taskTitle`. */
const TASK_A = "Streaming Transport Reconnect";
const TASK_B = "Dependency Licence Audit";

export const NOTIFICATIONS_FIXTURE: readonly HostNotificationEntry[] = [
  // Needs attention: unread + needs_action. Dismissing this RESOLVES it.
  hostNotificationEntrySchema.parse({
    id: "n1",
    kind: "approval.requested",
    outcome: null,
    resolvedAt: null,
    severity: "needs_action",
    updatedAt: T - 9 * 60_000,
    readAt: null,
    sourceRef: "a1000000-0000-4000-8000-0000000000a1",
    epicId: EPIC_A,
    chatId: CHAT_1,
    payload: {
      kind: "approval",
      epicId: EPIC_A,
      chatId: CHAT_1,
      chatTitle: "Builder T6 — Chat detail + reply",
      taskTitle: TASK_A,
      approvalId: "a1000000-0000-4000-8000-0000000000a1",
    },
  }),
  // Needs attention via FAILURE rather than needs_action — the other half of
  // `isAttentionEntry`, and the half a fixture usually forgets.
  hostNotificationEntrySchema.parse({
    id: "n2",
    kind: "workspace.operation.failed",
    outcome: "errored",
    severity: "failure",
    updatedAt: T - 40 * 60_000,
    readAt: null,
    sourceRef: null,
    epicId: EPIC_B,
    chatId: CHAT_5,
    payload: {
      kind: "workspace_operation_failed",
      epicId: EPIC_B,
      chatId: CHAT_5,
      chatTitle: "Reviewer T2 — Unary connection",
      taskTitle: TASK_B,
      operation: "worktree.create",
      title: "Couldn’t create the worktree",
      message: "branch already exists",
      // REQUIRED by the payload schema, and separate from the entry's own
      // `outcome` field of the same name. Omitting it failed the parse and
      // sent this one row — and only this row — back to the generic "Task /
      // Agent" copy, four rows after the same mistake had been fixed.
      outcome: "errored",
    },
  }),
  // Unread but only `info` — counts toward unread, NOT toward attention. This
  // row is why the bell's two counts are different numbers.
  hostNotificationEntrySchema.parse({
    id: "n3",
    kind: "interview.requested",
    outcome: null,
    resolvedAt: null,
    severity: "info",
    updatedAt: T - 3 * 3_600_000,
    readAt: null,
    sourceRef: "b1000000-0000-4000-8000-0000000000b1",
    epicId: EPIC_A,
    chatId: CHAT_2,
    payload: {
      kind: "interview",
      epicId: EPIC_A,
      chatId: CHAT_2,
      chatTitle: "Reviewer T5 — Epic detail",
      taskTitle: TASK_A,
      interviewBlockId: "b1000000-0000-4000-8000-0000000000b1",
    },
  }),
  // Yesterday, read, completed.
  hostNotificationEntrySchema.parse({
    id: "n4",
    kind: "agent.stopped",
    outcome: "completed",
    severity: "done",
    updatedAt: T - 30 * 3_600_000,
    readAt: T - 29 * 3_600_000,
    sourceRef: null,
    epicId: EPIC_A,
    chatId: CHAT_3,
    payload: {
      kind: "chat",
      epicId: EPIC_A,
      chatId: CHAT_3,
      agentName: "Builder T4 — Fleet view",
      taskTitle: TASK_A,
      outcome: "completed",
    },
  }),
  // Earlier, read, stalled — the third day bucket. Read, so it sits in
  // "Earlier" rather than in Needs attention despite being a failure.
  hostNotificationEntrySchema.parse({
    id: "n5",
    kind: "agent.stalled",
    outcome: "errored",
    severity: "failure",
    updatedAt: T - 4 * 86_400_000,
    readAt: T - 3 * 86_400_000,
    sourceRef: null,
    epicId: EPIC_B,
    chatId: CHAT_4,
    payload: {
      kind: "agent_stalled",
      epicId: EPIC_B,
      chatId: CHAT_4,
      agentId: "d1000000-0000-4000-8000-0000000000d1",
      agentName: "MultiHost — Generator",
      taskTitle: TASK_B,
      reason: "turn_start_timeout",
      title: "Agent stalled",
      outcome: "errored",
    },
  }),
];
