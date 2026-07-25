import type {
  ChatSnapshot,
  ChatSubscribeServerFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { expect, test } from "vitest";
import {
  applyServerFrame,
  blockedFromSnapshot,
  type BlockedItem,
} from "@/host/chat-blocked";

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

test("applyServerFrame adds an approval on approvalRequested", () => {
  const frame: ChatSubscribeServerFrame = {
    kind: "approvalRequested",
    hasBinaryPayload: false,
    epicId: "e1",
    chatId: "c1",
    approval: {
      approvalId: "a1",
      toolName: "bash",
      description: "Run it?",
      input: null,
      requestedAt: 0,
      kind: "tool",
      planId: null,
      actions: [],
    },
  };
  expect(applyServerFrame([], frame)).toEqual([
    { kind: "approval", id: "a1", title: "Run it?" },
  ]);
});

test("applyServerFrame removes an approval on approvalResolved", () => {
  const prev: BlockedItem[] = [
    { kind: "approval", id: "a1", title: "Run it?" },
    { kind: "interview", id: "b1", title: "Awaiting your input" },
  ];
  const frame: ChatSubscribeServerFrame = {
    kind: "approvalResolved",
    hasBinaryPayload: false,
    epicId: "e1",
    chatId: "c1",
    approvalId: "a1",
    decision: { approved: true },
    resolvedAt: 0,
  };
  expect(applyServerFrame(prev, frame)).toEqual([
    { kind: "interview", id: "b1", title: "Awaiting your input" },
  ]);
});

test("applyServerFrame leaves the list unchanged (same ref) for other frames", () => {
  const prev: readonly BlockedItem[] = [
    { kind: "approval", id: "a1", title: "Run it?" },
  ];
  const frame: ChatSubscribeServerFrame = {
    kind: "pong",
    hasBinaryPayload: false,
  };
  expect(applyServerFrame(prev, frame)).toBe(prev);
});
