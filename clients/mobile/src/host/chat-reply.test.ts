import { chatSubscribeClientFrameSchema } from "@traycer/protocol/host/agent/gui/subscribe";
import { expect, test } from "vitest";
import { approvalDecisionFrame } from "@/host/chat-reply";

test("approvalDecisionFrame builds a contract-valid approve frame", () => {
  const frame = approvalDecisionFrame({
    epicId: "e1",
    chatId: "c1",
    approvalId: "ap1",
    approved: true,
  });

  const parsed = chatSubscribeClientFrameSchema.safeParse(frame);
  expect(parsed.success).toBe(true);
  if (parsed.success && parsed.data.kind === "approvalDecision") {
    expect(parsed.data.approvalId).toBe("ap1");
    expect(parsed.data.decision.approved).toBe(true);
    expect(parsed.data.epicId).toBe("e1");
    expect(parsed.data.chatId).toBe("c1");
    expect(parsed.data.clientActionId.length).toBeGreaterThan(0);
  }
});

test("approvalDecisionFrame carries a rejection reason when given", () => {
  const frame = approvalDecisionFrame({
    epicId: "e1",
    chatId: "c1",
    approvalId: "ap1",
    approved: false,
    reason: "not now",
  });

  const parsed = chatSubscribeClientFrameSchema.safeParse(frame);
  expect(parsed.success).toBe(true);
  if (parsed.success && parsed.data.kind === "approvalDecision") {
    expect(parsed.data.decision.approved).toBe(false);
    expect(parsed.data.decision.reason).toBe("not now");
  }
});
