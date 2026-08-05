/**
 * Sprint 2 must-fix: user/steer rows are `JsonContent`, not a string — a
 * transcript of blank/"[object Object]" bubbles is a §4 data-loss fail.
 */
import { describe, expect, it } from "vitest";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { UserMessageSender } from "@traycer/protocol/persistence/epic/senders";
import { userContentToMarkdown, userSenderProvenance } from "@/host/user-content";

describe("userContentToMarkdown", () => {
  it("extracts real text from a plain user row's JsonContent", () => {
    const content: JsonContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Please fix " },
            { type: "text", text: "the bug", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    const markdown = userContentToMarkdown(content);
    expect(markdown).not.toBe("");
    expect(markdown).not.toContain("[object Object]");
    expect(markdown).toContain("Please fix");
    expect(markdown).toContain("**the bug**");
  });

  it("extracts real text from a steer block's JsonContent (multi-node, incl. a mention)", () => {
    const content: JsonContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "mention",
              attrs: { contextType: "file", relPath: "src/index.ts" },
            },
            { type: "text", text: " for context" },
          ],
        },
      ],
    };
    const markdown = userContentToMarkdown(content);
    expect(markdown).not.toBe("");
    expect(markdown).toContain("See");
    expect(markdown).toContain("src/index.ts");
  });
});

describe("userSenderProvenance", () => {
  it("returns null for a plain human sender", () => {
    const sender: UserMessageSender = { type: "user", userId: "u1" };
    expect(userSenderProvenance(sender)).toBeNull();
  });

  it("returns the display name for an agent-as-user sender", () => {
    const sender: UserMessageSender = {
      type: "agent",
      harnessId: "claude",
      agentId: "a1",
      displayName: "Planner Agent",
      reply: { expectsReply: false },
      inReplyTo: null,
    };
    expect(userSenderProvenance(sender)).toBe("Planner Agent");
  });

  it("falls back to agentId when displayName is null", () => {
    const sender: UserMessageSender = {
      type: "agent",
      harnessId: "claude",
      agentId: "a1",
      displayName: null,
      reply: { expectsReply: false },
      inReplyTo: null,
    };
    expect(userSenderProvenance(sender)).toBe("a1");
  });
});
