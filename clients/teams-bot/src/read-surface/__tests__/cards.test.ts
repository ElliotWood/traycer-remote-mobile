import { describe, expect, it } from "vitest";
import type { Attachment } from "@microsoft/agents-activity";
import {
  buildApprovalCard,
  buildBridgeUnavailableCard,
  buildChatCard,
  buildInterviewCard,
  buildEpicNotBoundCard,
  buildEpicPickerCard,
  agentDisplayName,
  buildFleetCard,
  buildHelpCard,
  buildPrincipalRefusedCard,
} from "../cards";
import type { ChatStatus } from "../bridge-types";

/** Every `TextBlock.text` in the card, i.e. exactly what a user can read. */
function collectTextBlocks(node: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.type === "TextBlock" && typeof record.text === "string") {
      found.push(record.text);
    }
    if (record.type === "FactSet" && Array.isArray(record.facts)) {
      for (const fact of record.facts) {
        const f = fact as Record<string, unknown>;
        if (typeof f.title === "string") found.push(f.title);
        if (typeof f.value === "string") found.push(f.value);
      }
    }
    for (const key of Object.keys(record)) walk(record[key]);
  };
  walk(node);
  return found;
}

function cardBody(attachment: Attachment): string {
  return JSON.stringify(attachment.content);
}

describe("read-surface/cards", () => {
  it("CONTRACT: a disconnected ChatStatus never renders the live-status view, even with populated fields", () => {
    const disconnectedButPopulated: ChatStatus = {
      chatId: "chat-1",
      title: "Looks busy",
      runStatus: "running",
      pendingApprovals: [
        {
          approvalId: "ap-1",
          toolName: "edit_file",
          description: "do the thing",
          requestedAt: 0,
        },
      ],
      pendingInterviews: [{ blockId: "b-1", requestedAt: 0 }],
      connected: false,
    };

    const body = cardBody(buildChatCard(disconnectedButPopulated, "epic-1"));

    expect(body).toContain("Host unreachable");
    // The stale approval/interview text must NOT leak into the disconnected card —
    // that would be exactly the silent-stale-data failure this contract exists to prevent.
    expect(body).not.toContain("edit_file");
    expect(body).not.toContain("do the thing");
  });

  it("a connected ChatStatus renders its pending approvals and interviews", () => {
    const connected: ChatStatus = {
      chatId: "chat-1",
      title: "Real chat",
      runStatus: "running",
      pendingApprovals: [
        {
          approvalId: "ap-1",
          toolName: "edit_file",
          description: "do the thing",
          requestedAt: 0,
        },
      ],
      pendingInterviews: [],
      connected: true,
    };

    const body = cardBody(buildChatCard(connected, "epic-1"));

    expect(body).toContain("edit_file");
    expect(body).toContain("do the thing");
    expect(body).not.toContain("Host unreachable");
  });

  it("fleet card renders each agent's title and status", () => {
    const body = cardBody(
      buildFleetCard([
        {
          agentId: "a-1",
          title: "My Agent",
          harnessId: "claude",
          surface: "gui",
          active: true,
        },
      ]),
    );
    expect(body).toContain("My Agent");
    expect(body).toContain("active");
  });

  it("fleet card handles an empty fleet without throwing or rendering nothing", () => {
    const body = cardBody(buildFleetCard([]));
    expect(body).toContain("No agents");
  });

  it("epic picker lists epics without any Action.Execute — plain text only, matching the read-only scope", () => {
    const body = cardBody(
      buildEpicPickerCard([{ epicId: "e-1", title: "My Epic" }]),
    );
    expect(body).toContain("My Epic");
    expect(body).not.toContain("Action.Execute");
  });

  it("every honest-failure card renders distinguishable, non-empty content", () => {
    expect(cardBody(buildEpicNotBoundCard())).toContain("No epic selected");
    expect(cardBody(buildPrincipalRefusedCard("unmapped_principal"))).toContain(
      "unmapped_principal",
    );
    expect(
      cardBody(buildBridgeUnavailableCard("spawn_timed_out", "took too long")),
    ).toContain("took too long");
  });
});

describe("read-surface/cards — help advertises only implemented commands", () => {
  it("does NOT advertise 'epics' while the bridge has no epics command", () => {
    // The user hit "unknown command 'epics'" three times because the help
    // card listed it. Re-add the line in the same change that implements it.
    expect(cardBody(buildHelpCard())).not.toContain("epics");
  });

  it("advertises the commands that do work", () => {
    const body = cardBody(buildHelpCard());
    expect(body).toContain("fleet");
    expect(body).toContain("chat <id>");
  });
});

describe("read-surface/cards — agentDisplayName never shows a raw UUID", () => {
  const base = {
    agentId: "d0cf1e5a-0000-4000-8000-0000000000ff",
    title: null,
    harnessId: null,
    surface: "tui" as const,
    active: false,
  };

  it("does not fall through to the raw agentId when there is no title", () => {
    const name = agentDisplayName(base);
    expect(name).not.toBe(base.agentId);
    expect(name).not.toContain("0000-4000");
    expect(name).toContain("Untitled");
    // A short prefix is kept so the row stays identifiable.
    expect(name).toContain("d0cf1e5a");
  });

  it("treats a whitespace-only title as absent, not as a title", () => {
    expect(agentDisplayName({ ...base, title: "   " })).toContain("Untitled");
  });

  it("uses the real title when there is one", () => {
    expect(agentDisplayName({ ...base, title: "My Agent" })).toBe("My Agent");
  });

  it("names the harness when known, so untitled rows still differ", () => {
    expect(agentDisplayName({ ...base, harnessId: "claude" })).toContain(
      "claude",
    );
  });

  it("the fleet card shows no raw UUID in any VISIBLE text for an untitled agent", () => {
    // Scoped to TextBlock text on purpose: the full agentId must still appear
    // in the row's `selectAction` data — that is how tapping the row works.
    // The requirement is that the user never READS a UUID, not that the id is
    // absent from the payload.
    const visible = JSON.stringify(
      collectTextBlocks(buildFleetCard([base]).content),
    );
    expect(visible).not.toContain(base.agentId);
    expect(visible).toContain("Untitled");
  });
});

describe("read-surface/cards — the chat card names WHAT is pending", () => {
  const withApproval: ChatStatus = {
    chatId: "chat-1",
    title: "Real chat",
    runStatus: "running",
    pendingApprovals: [
      {
        approvalId: "ap-1",
        toolName: "edit_file",
        description: "do the thing",
        requestedAt: 0,
      },
    ],
    pendingInterviews: [],
    connected: true,
  };

  it("REGRESSION: names the pending tool, not just a count", () => {
    // A FactSet refactor once replaced "edit_file" with "Pending approvals: 1",
    // which tells the user nothing about what they'd be approving.
    const body = cardBody(buildChatCard(withApproval, "epic-1"));
    expect(body).toContain("edit_file");
    expect(body).toContain("do the thing");
  });

  it("shows a +N more count when several are pending, still naming the first", () => {
    const body = cardBody(
      buildChatCard(
        {
          ...withApproval,
          pendingApprovals: [
            withApproval.pendingApprovals[0],
            {
              approvalId: "ap-2",
              toolName: "run_command",
              description: "second",
              requestedAt: 0,
            },
          ],
        },
        "epic-1",
      ),
    );
    expect(body).toContain("edit_file");
    expect(body).toContain("+1 more");
  });

  it("summarises a fenced description to one prose line — never to '```ts'", () => {
    const visible = collectTextBlocks(
      buildChatCard(
        {
          ...withApproval,
          pendingApprovals: [
            {
              ...withApproval.pendingApprovals[0],
              description: "```ts\nconst x = 1;\n```\nRewrite the parser.",
            },
          ],
        },
        "epic-1",
      ).content,
    );
    expect(visible).toContain("Rewrite the parser.");
    expect(visible.some((t) => t.includes("```"))).toBe(false);
  });

  it("says so plainly when nothing is waiting", () => {
    const body = cardBody(
      buildChatCard({ ...withApproval, pendingApprovals: [] }, "epic-1"),
    );
    expect(body).toContain("Nothing waiting on you");
  });

  it("shows which epic the decision belongs to — ambiguous with several epics in play", () => {
    const visible = JSON.stringify(
      collectTextBlocks(
        buildChatCard(withApproval, "e0000000-0000-4000-8000-0000000000e1")
          .content,
      ),
    );
    expect(visible).toContain("Epic");
    expect(visible).toContain("e0000000");
  });

  it("never shows a full UUID in visible text — short ids only", () => {
    const longChat = "a1000000-0000-4000-8000-000000000004";
    const visible = JSON.stringify(
      collectTextBlocks(
        buildChatCard({ ...withApproval, chatId: longChat }, "epic-1").content,
      ),
    );
    expect(visible).not.toContain(longChat);
  });

  it("the header is never attention-styled — a red container around a green Running badge is contradictory", () => {
    const content = buildChatCard(withApproval, "epic-1").content;
    const header = (content as { body: { style?: string }[] }).body[0];
    expect(header.style).toBe("emphasis");
  });
});

describe("read-surface/cards — approval and interview cards stand alone", () => {
  const APPROVAL = {
    approvalId: "ap-1",
    toolName: "Edit",
    description: "do the thing",
    requestedAt: 0,
  };
  const LONG_CHAT_ID = "a1000000-0000-4000-8000-000000000004";

  it("names the chat by TITLE, not by id — these cards are read detached from the status card", () => {
    const visible = JSON.stringify(
      collectTextBlocks(
        buildApprovalCard(
          { chatId: LONG_CHAT_ID, title: "Migrate config loader to zod" },
          "e0000000-0000-4000-8000-0000000000e1",
          APPROVAL,
          0,
        ).content,
      ),
    );
    expect(visible).toContain("Migrate config loader");
    expect(visible).toContain("e0000000");
    expect(visible).not.toContain(LONG_CHAT_ID);
  });

  it("falls back to a short id when the chat has no title, never to a bare UUID", () => {
    const visible = JSON.stringify(
      collectTextBlocks(
        buildApprovalCard(
          { chatId: LONG_CHAT_ID, title: null },
          "epic-1",
          APPROVAL,
          0,
        ).content,
      ),
    );
    expect(visible).not.toContain(LONG_CHAT_ID);
    expect(visible).toContain("a1000000");
  });

  it("treats a whitespace-only chat title as absent, matching agentDisplayName", () => {
    const visible = JSON.stringify(
      collectTextBlocks(
        buildInterviewCard(
          { chatId: LONG_CHAT_ID, title: "   " },
          "epic-1",
          { blockId: "b-1", requestedAt: 0 },
          0,
        ).content,
      ),
    );
    expect(visible).toContain("a1000000");
    expect(visible).not.toContain(LONG_CHAT_ID);
  });

  it("renders a fenced code block as monospace TextBlocks, not as literal ``` characters", () => {
    // Teams card markdown supports NO preformatted text, so a fence handed
    // straight through renders its delimiters as visible junk and loses
    // alignment. `fontType` is a card property, not markdown, so it survives.
    const content = buildApprovalCard(
      { chatId: LONG_CHAT_ID, title: "c" },
      "epic-1",
      {
        ...APPROVAL,
        description: "Apply:\n```ts\nconst x = 1;\nrun();\n```\ndone",
      },
      0,
    ).content;
    const visible = collectTextBlocks(content);

    expect(visible.some((t) => t.includes("```"))).toBe(false);
    expect(visible).toContain("const x = 1;");
    expect(visible).toContain("Apply:");
    // The prose after the fence must survive too — an early `return` in the
    // splitter would silently swallow it.
    expect(visible).toContain("done");
    expect(JSON.stringify(content)).toContain('"fontType":"monospace"');
  });

  it("truncates a very long code line instead of wrapping it — a wrapped diff line misleads", () => {
    const long = `const value = "${"x".repeat(200)}";`;
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        { ...APPROVAL, description: "```\n" + long + "\n```" },
        0,
      ).content,
    );
    const codeLine = visible.find((t) => t.startsWith("const value"));
    expect(codeLine).toBeDefined();
    expect(codeLine?.length).toBeLessThan(50);
    expect(codeLine?.endsWith("…")).toBe(true);
  });

  it("caps a huge code block and says how many lines it dropped, rather than silently cutting", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join(
      "\n",
    );
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        { ...APPROVAL, description: "```\n" + body + "\n```" },
        0,
      ).content,
    );
    expect(visible).toContain("line 0");
    expect(visible.some((t) => t.includes("more lines"))).toBe(true);
    expect(visible).not.toContain("line 39");
  });

  it("keeps a markdown table's rows on separate lines instead of collapsing them into soup", () => {
    // Markdown collapses a table's newlines into ONE paragraph, so the pipes
    // and `---` all run together and the table becomes unreadable. The rows
    // must survive as distinct blocks.
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        {
          ...APPROVAL,
          description:
            "# Summary\n\n| File | Change |\n| --- | --- |\n| cards.ts | +165 |\n\n> needs review",
        },
        0,
      ).content,
    );
    expect(visible).toContain("| File | Change |");
    expect(visible).toContain("| cards.ts | +165 |");
    // Heading and blockquote markers are rendered, not shown as punctuation.
    expect(visible).toContain("Summary");
    expect(visible).toContain("needs review");
    expect(visible.some((t) => t.startsWith("#"))).toBe(false);
    expect(visible.some((t) => t.startsWith(">"))).toBe(false);
  });

  it("drops inline backticks, which Teams renders as literal ` characters", () => {
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        { ...APPROVAL, description: "Then run `bun test --filter cards`." },
        0,
      ).content,
    );
    expect(visible).toContain("Then run bun test --filter cards.");
  });

  it("an UNCLOSED fence still renders as code — truncated agent output is common", () => {
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        { ...APPROVAL, description: "Patch:\n```ts\nconst x = 1;" },
        0,
      ).content,
    );
    expect(visible).toContain("const x = 1;");
    expect(visible.some((t) => t.includes("```"))).toBe(false);
  });

  it("a description that is only whitespace still says something", () => {
    const visible = collectTextBlocks(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "c" },
        "epic-1",
        { ...APPROVAL, description: "   \n\n  " },
        0,
      ).content,
    );
    expect(visible.some((t) => t.includes("no description"))).toBe(true);
  });

  it("the approval card carries the FULL chat id in its action payload — shortening is a display concern only", () => {
    // The buttons have to act on the real id; only what the user READS is short.
    const body = cardBody(
      buildApprovalCard(
        { chatId: LONG_CHAT_ID, title: "Some chat" },
        "epic-1",
        APPROVAL,
        0,
      ),
    );
    expect(body).toContain(LONG_CHAT_ID);
  });
});
