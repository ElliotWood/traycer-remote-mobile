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
  agentStatusLabel,
  buildFleetCard,
  buildHelpCard,
  buildPrincipalRefusedCard,
  buildTranscriptCard,
  buildContextStripCard,
  CONTEXT_STRIP_SIZE,
} from "../cards";
import type {
  ChatStatus,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
} from "../bridge-types";

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
          isLocal: true,
          hostId: "h-1",
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
    isLocal: true,
    hostId: "h-1",
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

  it("CONTRACT: Approve and Reject stay distinguishable WITHOUT colour", () => {
    // Microsoft documents `positive`/`destructive` as unsupported in Teams,
    // and our local renderer honours them — so screenshots show a blue and a
    // red button that Teams may render as two identical grey ones. If the
    // only difference were colour, a destructive action would sit next to an
    // identical-looking safe one. Order, opposite words and a leading glyph
    // are the distinctions no host can drop.
    const content = buildApprovalCard(
      { chatId: LONG_CHAT_ID, title: "c" },
      "epic-1",
      APPROVAL,
      0,
    ).content as { actions: { title: string; style?: string }[] };

    expect(content.actions).toHaveLength(2);
    const [approve, reject] = content.actions;

    // Safe action first.
    expect(approve.title).toContain("Approve");
    expect(reject.title).toContain("Reject");
    // A distinguishing mark that is not a colour and not an image.
    expect(approve.title).not.toBe(reject.title);
    expect(approve.title.startsWith("✓")).toBe(true);
    expect(reject.title.startsWith("✕")).toBe(true);
    // Styling is still SET — it is free upside where supported. It just must
    // never be the only thing carrying the distinction.
    expect(approve.style).toBe("positive");
    expect(reject.style).toBe("destructive");
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

describe("read-surface/cards — transcript", () => {
  const msg = (
    id: string,
    role: "user" | "assistant",
    text: string,
    parts: TranscriptPart[],
  ): TranscriptMessage => ({
    messageId: id,
    role,
    author: role === "user" ? null : "claude",
    timestamp: 0,
    text,
    parts,
  });

  const transcript = (over: Partial<Transcript>): Transcript => ({
    chatId: "a1000000-0000-4000-8000-000000000004",
    title: "My chat",
    totalCount: 214,
    offset: 0,
    messages: [
      msg("1", "user", "first", []),
      msg("2", "assistant", "second", []),
      msg("3", "user", "third", []),
    ],
    ...over,
  });

  it("renders NEWEST FIRST — you land on the current state, not message #1", () => {
    const visible = collectTextBlocks(
      buildTranscriptCard(transcript({}), 0).content,
    );
    const third = visible.findIndex((t) => t.includes("third"));
    const first = visible.findIndex((t) => t.includes("first"));
    expect(third).toBeGreaterThanOrEqual(0);
    expect(third).toBeLessThan(first);
  });

  it("says which slice of the whole history is on screen", () => {
    const visible = JSON.stringify(
      collectTextBlocks(buildTranscriptCard(transcript({}), 0).content),
    );
    expect(visible).toContain("of 214");
  });

  it("CONTRACT: no Newer button on the first page — it degrades to the one-way card", () => {
    // The whole reason this variant was chosen: the second control costs
    // nothing because it does not exist until you have paged back.
    const content = buildTranscriptCard(transcript({ offset: 0 }), 0)
      .content as { actions?: { title: string }[] };
    const titles = (content.actions ?? []).map((a) => a.title);
    expect(titles.some((t) => t.includes("Newer"))).toBe(false);
    expect(titles.some((t) => t.includes("Older"))).toBe(true);
  });

  it("offers BOTH directions once paged back", () => {
    const content = buildTranscriptCard(transcript({ offset: 40 }), 0)
      .content as { actions?: { title: string }[] };
    const titles = (content.actions ?? []).map((a) => a.title);
    expect(titles.some((t) => t.includes("Newer"))).toBe(true);
    expect(titles.some((t) => t.includes("Older"))).toBe(true);
  });

  it("offers no paging at all when the whole history fits", () => {
    const content = buildTranscriptCard(
      transcript({ totalCount: 3, offset: 0 }),
      0,
    ).content as { actions?: unknown[] };
    expect(content.actions ?? []).toHaveLength(0);
  });

  it("collapses code to a marker rather than reproducing it inline", () => {
    // A transcript is a scanning surface. Ten monospace blocks is a wall,
    // which is why this does NOT reuse the approval card's treatment.
    const visible = collectTextBlocks(
      buildTranscriptCard(
        transcript({
          messages: [
            msg("1", "assistant", "Here:\n```ts\nconst x = 1;\n```\ndone", [
              { kind: "code", label: "a.ts", lines: 3 },
            ]),
          ],
        }),
        0,
      ).content,
    );
    const joined = visible.join(" ");
    expect(joined).toContain("Here:");
    expect(joined).toContain("done");
    expect(joined).not.toContain("const x = 1;");
    expect(joined).toContain("⟨code · a.ts · 3 lines⟩");
  });

  it("a parts-only message renders its markers, not an empty bubble", () => {
    const visible = collectTextBlocks(
      buildTranscriptCard(
        transcript({
          messages: [
            msg("1", "assistant", "", [
              { kind: "command", label: "bun test", lines: 0 },
            ]),
          ],
        }),
        0,
      ).content,
    );
    expect(visible.join(" ")).toContain("⟨command · bun test⟩");
  });

  it("the context strip truncates HARDER than the full transcript", () => {
    // It sits above a pending approval; a long agent answer there costs the
    // decision its place above the fold.
    const long = "x".repeat(400);
    const inStrip = collectTextBlocks(
      buildContextStripCard(
        transcript({ messages: [msg("1", "assistant", long, [])] }),
        0,
      ).content,
    ).join(" ");
    const inFull = collectTextBlocks(
      buildTranscriptCard(
        transcript({ messages: [msg("1", "assistant", long, [])] }),
        0,
      ).content,
    ).join(" ");
    expect(inStrip.length).toBeLessThan(inFull.length);
  });

  it("the context strip shows at most CONTEXT_STRIP_SIZE messages, and the NEWEST ones", () => {
    // Distinct, non-prefixing bodies: an earlier version of this test used
    // `message ${i}` and passed for the wrong reason, because "message 1" is
    // a substring of "message 17".
    const many = Array.from({ length: 20 }, (_, i) =>
      msg(String(i), "assistant", `body-${String(i).padStart(2, "0")}-end`, []),
    );
    const visible = collectTextBlocks(
      buildContextStripCard(transcript({ messages: many }), 0).content,
    ).join(" ");
    const shown = many.filter((m) =>
      visible.includes(
        `body-${(m as { messageId: string }).messageId.padStart(2, "0")}-end`,
      ),
    );
    expect(shown).toHaveLength(CONTEXT_STRIP_SIZE);
    // The newest three, not the oldest three.
    expect(visible).toContain("body-19-end");
    expect(visible).not.toContain("body-00-end");
  });

  it("the strip's full-history button names how many are hidden", () => {
    const content = buildContextStripCard(transcript({}), 0).content as {
      actions?: { title: string }[];
    };
    expect((content.actions ?? [])[0]?.title).toContain("211");
  });
});

describe("read-surface/cards — a remote agent is never labelled Idle", () => {
  const base = {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "Some agent",
    harnessId: "claude",
    surface: "gui" as const,
    active: false,
    isLocal: true,
    hostId: "h-local",
  };

  it("CONTRACT: an agent on another host reads 'On another host', not 'Idle'", () => {
    // Measured against the real host: 53 of 56 agents in the epic run
    // elsewhere and every one reports `active: false` — correctly, because
    // the activity tracker is local-only. This card rendered all 53 as
    // "Idle", i.e. calmly reported nothing was happening while agents ran.
    expect(agentStatusLabel({ ...base, isLocal: false })).toBe(
      "On another host",
    );
    expect(agentStatusLabel({ ...base, isLocal: false })).not.toBe("Idle");
  });

  it("locality wins even when active is true, since active is meaningless remotely", () => {
    expect(agentStatusLabel({ ...base, isLocal: false, active: true })).toBe(
      "On another host",
    );
  });

  it("a LOCAL agent still reads Active or Idle — the control for the above", () => {
    expect(agentStatusLabel({ ...base, active: true })).toBe("Active");
    expect(agentStatusLabel(base)).toBe("Idle");
  });

  it("the fleet card itself shows the remote label, not just the helper", () => {
    const visible = JSON.stringify(
      collectTextBlocks(buildFleetCard([{ ...base, isLocal: false }]).content),
    );
    expect(visible).toContain("On another host");
  });
});
