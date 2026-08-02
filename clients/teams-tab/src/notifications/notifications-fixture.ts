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
    sourceRef: "ap-1",
    epicId: EPIC_A,
    chatId: "c1000000-0000-4000-8000-000000000001",
    payload: { agentName: "Builder T6", title: "Chat detail + reply" },
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
    chatId: null,
    payload: { operation: "worktree.create", message: "branch already exists" },
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
    sourceRef: "iv-1",
    epicId: EPIC_A,
    chatId: "c2000000-0000-4000-8000-000000000002",
    payload: { agentName: "Reviewer T5", title: "Epic detail" },
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
    chatId: "c3000000-0000-4000-8000-000000000003",
    payload: { outcome: "completed", agentName: "Builder T4" },
  }),
  // Earlier, unread, stalled — the fourth severity and the third day bucket.
  hostNotificationEntrySchema.parse({
    id: "n5",
    kind: "agent.stalled",
    outcome: "errored",
    severity: "failure",
    updatedAt: T - 4 * 86_400_000,
    readAt: T - 3 * 86_400_000,
    sourceRef: null,
    epicId: EPIC_B,
    chatId: "c4000000-0000-4000-8000-000000000004",
    payload: { agentName: "MultiHost — Generator" },
  }),
];
