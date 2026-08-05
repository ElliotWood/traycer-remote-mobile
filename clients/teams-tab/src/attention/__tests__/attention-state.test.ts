/**
 * The waiting screen as a PURE PROJECTION of the feed.
 *
 * This file exists because the projection used to be tangled into a hook that
 * opened a stream, so testing it needed a fake session and the interesting
 * cases (loading, error) were reachable only by timing. Now they are arguments.
 *
 * The pass-through cases are the point. Flattening `loading` to an empty list
 * renders a confident "nothing is waiting" over an unanswered approval — the
 * empty-versus-loading conflation on the one surface whose entire promise is
 * "these need you".
 */
import { describe, expect, it } from "vitest";
import {
  hostNotificationEntrySchema,
  type HostNotificationEntry,
} from "@traycer/protocol/host/notifications/host-notifications";
import { toAttentionState } from "../attention-state";
import type { NotificationsState } from "../../notifications/use-notifications";

function entry(over: Record<string, unknown>): HostNotificationEntry {
  return hostNotificationEntrySchema.parse({
    id: "n1",
    kind: "approval.requested",
    outcome: null,
    resolvedAt: null,
    severity: "needs_action",
    updatedAt: 1_000,
    readAt: null,
    sourceRef: null,
    epicId: "e1",
    chatId: "c1",
    payload: {},
    ...over,
  });
}

describe("toAttentionState", () => {
  it("passes loading through rather than reporting an empty list", () => {
    expect(toAttentionState({ kind: "loading" })).toEqual({ kind: "loading" });
  });

  it("passes an error through rather than reporting an empty list", () => {
    const state: NotificationsState = { kind: "error", detail: "stream closed" };
    expect(toAttentionState(state)).toEqual({ kind: "error", detail: "stream closed" });
  });

  it("keeps the host's summary rather than deriving one from the rows", () => {
    const state: NotificationsState = {
      kind: "ready",
      entries: [entry({ id: "a" })],
      // Deliberately inconsistent with `entries` — one row here, nine there.
      // The host's number is the one that survives, because we hold a page.
      summary: { unreadCount: 9, attentionCount: 9 },
      epicTitles: { e1: "Streaming Transport Reconnect" },
    };
    const result = toAttentionState(state);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.summary).toEqual({ unreadCount: 9, attentionCount: 9 });
    expect(result.epicTitles).toEqual({ e1: "Streaming Transport Reconnect" });
  });

  /**
   * The blocking-kinds rule and the oldest-first sort belong to
   * `shared/epic/attention`; this only checks that the projection is actually
   * applied rather than the entries being passed straight through.
   */
  it("drops rows that are not waiting on a person, oldest first", () => {
    const state: NotificationsState = {
      kind: "ready",
      entries: [
        entry({ id: "recent-approval", updatedAt: 5_000 }),
        entry({
          id: "not-blocking",
          kind: "agent.stopped",
          outcome: "completed",
          severity: "done",
          payload: { outcome: "completed" },
        }),
        entry({ id: "old-approval", updatedAt: 1_000 }),
      ],
      summary: null,
      epicTitles: {},
    };
    const result = toAttentionState(state);
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.items.map((i) => i.id)).toEqual(["old-approval", "recent-approval"]);
  });
});
