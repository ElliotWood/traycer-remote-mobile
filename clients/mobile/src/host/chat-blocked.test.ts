import type { ChatSnapshot } from "@traycer/protocol/host/agent/gui/subscribe";
import { expect, test } from "vitest";
import { blockedFromSnapshot } from "@/host/chat-blocked";

type PendingSlices = Pick<
  ChatSnapshot,
  "pendingApprovals" | "pendingInterviews"
>;

test("blockedFromSnapshot surfaces approvals (with description) and interviews", () => {
  const snapshot: PendingSlices = {
    pendingApprovals: [
      {
        approvalId: "a1",
        toolName: "bash",
        description: "Run the migration?",
        input: null,
        requestedAt: 0,
        kind: "tool",
        planId: null,
        actions: [],
      },
    ],
    pendingInterviews: [{ blockId: "b1", requestedAt: 0 }],
  };

  expect(blockedFromSnapshot(snapshot)).toEqual([
    { kind: "approval", id: "a1", title: "Run the migration?" },
    { kind: "interview", id: "b1", title: "Awaiting your input" },
  ]);
});

test("blockedFromSnapshot returns nothing when idle", () => {
  const snapshot: PendingSlices = {
    pendingApprovals: [],
    pendingInterviews: [],
  };
  expect(blockedFromSnapshot(snapshot)).toEqual([]);
});
