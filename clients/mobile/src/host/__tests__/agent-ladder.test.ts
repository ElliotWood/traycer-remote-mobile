import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_BADGE, type ChatBadgeState } from "../use-chat-badges";
import {
  anyDescendantUnread,
  collectDescendantIds,
  computeChatDescendantRollup,
  ladderTierToDescendantKind,
  resolveLadderTier,
  rollupOutranksSelf,
  summarizeChatDescendantRollup,
  type DescendantStatusKind,
  type LadderTier,
} from "../agent-ladder";

function badge(overrides: Partial<ChatBadgeState>): ChatBadgeState {
  return { ...DEFAULT_CHAT_BADGE, ...overrides };
}

describe("resolveLadderTier — precedence (failed > interview > approval > running > background > done-unread > read-only > idle)", () => {
  it("idle by default", () => {
    expect(resolveLadderTier({ badge: badge({}), hasUnreadFailure: false, hasUnreadDone: false })).toBe(
      "idle",
    );
  });

  it("read-only when the chat has no other signal but the role is viewer", () => {
    expect(
      resolveLadderTier({
        badge: badge({ accessRole: "viewer" }),
        hasUnreadFailure: false,
        hasUnreadDone: false,
      }),
    ).toBe("read-only");
  });

  it("done-unread outranks read-only", () => {
    expect(
      resolveLadderTier({
        badge: badge({ accessRole: "viewer" }),
        hasUnreadFailure: false,
        hasUnreadDone: true,
      }),
    ).toBe("done-unread");
  });

  it("background outranks done-unread", () => {
    expect(
      resolveLadderTier({ badge: badge({ background: true }), hasUnreadFailure: false, hasUnreadDone: true }),
    ).toBe("background");
  });

  it("running outranks background", () => {
    expect(
      resolveLadderTier({
        badge: badge({ runStatus: "running", background: true }),
        hasUnreadFailure: false,
        hasUnreadDone: false,
      }),
    ).toBe("running");
  });

  it("'stopping' runStatus also reads as running", () => {
    expect(
      resolveLadderTier({ badge: badge({ runStatus: "stopping" }), hasUnreadFailure: false, hasUnreadDone: false }),
    ).toBe("running");
  });

  it("needs-approval outranks running", () => {
    expect(
      resolveLadderTier({
        badge: badge({ runStatus: "running", pendingApproval: true }),
        hasUnreadFailure: false,
        hasUnreadDone: false,
      }),
    ).toBe("needs-approval");
  });

  it("needs-interview outranks needs-approval", () => {
    expect(
      resolveLadderTier({
        badge: badge({ pendingApproval: true, pendingInterview: true }),
        hasUnreadFailure: false,
        hasUnreadDone: false,
      }),
    ).toBe("needs-interview");
  });

  it("failed outranks everything, including interview/approval/running", () => {
    expect(
      resolveLadderTier({
        badge: badge({ pendingApproval: true, pendingInterview: true, runStatus: "running" }),
        hasUnreadFailure: true,
        hasUnreadDone: false,
      }),
    ).toBe("failed");
  });
});

describe("ladderTierToDescendantKind", () => {
  it("maps the six urgency tiers and returns null for read-only/idle", () => {
    const cases: readonly [LadderTier, DescendantStatusKind | null][] = [
      ["failed", "failure"],
      ["needs-interview", "interview"],
      ["needs-approval", "approval"],
      ["running", "running"],
      ["background", "background"],
      ["done-unread", "done"],
      ["read-only", null],
      ["idle", null],
    ];
    for (const [tier, expected] of cases) {
      expect(ladderTierToDescendantKind(tier)).toBe(expected);
    }
  });
});

describe("collectDescendantIds", () => {
  it("walks multi-level nesting and de-dupes/guards against a parentId cycle", () => {
    const childrenByParent = {
      root: ["a"],
      a: ["b"],
      b: ["root"], // cycle back to root
    };
    expect(collectDescendantIds("root", childrenByParent)).toEqual(["a", "b"]);
  });

  it("returns [] for a leaf with no children entry", () => {
    expect(collectDescendantIds("leaf", {})).toEqual([]);
  });
});

describe("computeChatDescendantRollup", () => {
  it("picks the highest-ranked non-empty bucket across all descendants, at any depth", () => {
    const childrenByParent = { root: ["a", "b"], a: ["c"] };
    const tiers: Record<string, LadderTier> = { a: "running", b: "background", c: "failed" };
    const rollup = computeChatDescendantRollup("root", childrenByParent, (id) => tiers[id] ?? "idle");
    expect(rollup.kind).toBe("failure");
    expect(rollup.counts).toEqual({ failure: 1, interview: 0, approval: 0, running: 1, background: 1, done: 0 });
  });

  it("returns kind: null when no descendant carries a rollup-worthy tier", () => {
    const childrenByParent = { root: ["a", "b"] };
    const rollup = computeChatDescendantRollup("root", childrenByParent, () => "idle");
    expect(rollup.kind).toBeNull();
  });
});

describe("rollupOutranksSelf", () => {
  it("renders the nested icon when the rollup strictly outranks self", () => {
    const rollup = computeChatDescendantRollup("root", { root: ["a"] }, () => "running");
    expect(rollupOutranksSelf(rollup, "idle")).toBe(true);
  });

  it("does NOT render the nested icon on a tie — ties go to the parent", () => {
    const rollup = computeChatDescendantRollup("root", { root: ["a"] }, () => "running");
    expect(rollupOutranksSelf(rollup, "running")).toBe(false);
  });

  it("does NOT render the nested icon when self already outranks the rollup", () => {
    const rollup = computeChatDescendantRollup("root", { root: ["a"] }, () => "running");
    expect(rollupOutranksSelf(rollup, "failed")).toBe(false);
  });

  it("is false when there is nothing to roll up", () => {
    const rollup = computeChatDescendantRollup("root", {}, () => "idle");
    expect(rollupOutranksSelf(rollup, "idle")).toBe(false);
  });
});

describe("summarizeChatDescendantRollup", () => {
  it("formats a single attention item as singular, plus a running count", () => {
    const rollup = computeChatDescendantRollup("root", { root: ["a", "b", "c"] }, (id) => {
      const tiers: Record<string, LadderTier> = { a: "failed", b: "running", c: "running" };
      return tiers[id] ?? "idle";
    });
    expect(summarizeChatDescendantRollup(rollup)).toBe("Nested: 1 needs attention · 2 running");
  });

  it("returns a bare 'Nested' label when nothing is set (defensive — should not normally be called)", () => {
    const rollup = { kind: null, counts: { failure: 0, interview: 0, approval: 0, running: 0, background: 0, done: 0 } } as const;
    expect(summarizeChatDescendantRollup(rollup)).toBe("Nested");
  });
});

describe("anyDescendantUnread", () => {
  it("true when any descendant at any depth is unread", () => {
    const childrenByParent = { root: ["a"], a: ["b"] };
    expect(anyDescendantUnread("root", childrenByParent, (id) => id === "b")).toBe(true);
  });

  it("false when no descendant is unread", () => {
    const childrenByParent = { root: ["a"] };
    expect(anyDescendantUnread("root", childrenByParent, () => false)).toBe(false);
  });
});
