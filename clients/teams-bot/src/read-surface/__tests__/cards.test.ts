import { describe, expect, it } from "vitest";
import type { Attachment } from "@microsoft/agents-activity";
import {
  ANSWER_VERB,
  buildApprovalCard,
  buildBridgeUnavailableCard,
  buildChatCard,
  buildInterviewCard,
  buildEpicNotBoundCard,
  buildEpicPickerCard,
  agentDisplayName,
  agentStatusLabel,
  agentStatusPresentation,
  buildFleetCard,
  buildHelpCard,
  buildPrincipalRefusedCard,
  buildTranscriptCard,
  buildActionOutcomeCard,
  buildAssessmentStartedCard,
  buildAssessmentUnconfirmedCard,
  buildInterviewOutcomeCard,
  buildMessageOutcomeCard,
  OPEN_CHAT_VERB,
  speakerLabel,
  modelMarker,
  humaniseToolName,
  partMarker,
  shortenWorkspacePath,
  buildContextStripCard,
  buildClarifyCard,
  buildComposeCard,
  buildIntakeFormCard,
  buildIntakeRefusedCard,
  buildUnknownChatCard,
  buildUsageCard,
  CONTEXT_STRIP_SIZE,
} from "../cards";
import type { IntakeFormCardOptions } from "../cards";
import { HANDLED_ACTION_VERBS } from "../dispatch-action";
import { DEADLINE_TIME_ZONES } from "../../intake/deadline";
import type {
  AgentSummary,
  ChatStatus,
  PendingInterview,
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
      pendingInterviews: [
        {
          blockId: "b-1",
          requestedAt: 0,
          title: null,
          description: null,
          questions: null,
        },
      ],
      connected: false,
    };

    const body = cardBody(buildChatCard(disconnectedButPopulated, "epic-1", false));

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

    const body = cardBody(buildChatCard(connected, "epic-1", false));

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
          capabilities: { readTranscript: true, sendMessage: true },
        },
      ]),
    );
    expect(body).toContain("My Agent");
    // "Active" — the ROW's status label, which is what this test claims to
    // check. It previously asserted lowercase "active" and was satisfied by
    // the header's "1 active" count, so it passed without the row status
    // being present at all. Removing that count is what exposed it.
    expect(body).toContain("Active");
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

  /**
   * REPLACED. This asserted `fleet` and `chat <id>` appeared in the help card
   * — i.e. it pinned the CLI as the interface, on the one surface whose whole
   * job is teaching the interface.
   *
   * The commands still work as an undocumented fallback. What changed is that
   * the card teaches capabilities and offers them as buttons, so the test now
   * asserts the thing that would regress: an id syntax creeping back into the
   * one place people read to learn how to use this.
   */
  it("CONTRACT: teaches capabilities, never an id to type", () => {
    const body = cardBody(buildHelpCard());
    expect(body).toContain("My agents");
    expect(body).toContain("Ask in your own words");
    expect(body).not.toContain("<id>");
    expect(body).not.toContain("say ");
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
    capabilities: { readTranscript: true, sendMessage: true },
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
    const body = cardBody(buildChatCard(withApproval, "epic-1", false));
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
        false,
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
        false,
      ).content,
    );
    expect(visible).toContain("Rewrite the parser.");
    expect(visible.some((t) => t.includes("```"))).toBe(false);
  });

  it("says so plainly when nothing is waiting", () => {
    const body = cardBody(
      buildChatCard({ ...withApproval, pendingApprovals: [] }, "epic-1", false),
    );
    expect(body).toContain("Nothing waiting on you");
  });

  it("shows which epic the decision belongs to — ambiguous with several epics in play", () => {
    const visible = JSON.stringify(
      collectTextBlocks(
        buildChatCard(withApproval, "e0000000-0000-4000-8000-0000000000e1", false)
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
        buildChatCard({ ...withApproval, chatId: longChat }, "epic-1", false).content,
      ),
    );
    expect(visible).not.toContain(longChat);
  });

  it("the header is never attention-styled — a red container around a green Running badge is contradictory", () => {
    const content = buildChatCard(withApproval, "epic-1", false).content;
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
          {
            blockId: "b-1",
            requestedAt: 0,
            title: null,
            description: null,
            questions: null,
          },
          0,
        ).content,
      ),
    );
    expect(visible).toContain("a1000000");
    expect(visible).not.toContain(LONG_CHAT_ID);
  });

  describe("the interview card is answerable, and refuses when it cannot be", () => {
    const CHAT = { chatId: LONG_CHAT_ID, title: "Migrate config loader" };
    const QUESTION = {
      questionId: "q-1",
      question: "Which environment first?",
      header: null,
      options: [
        { label: "Staging", description: "safe", preview: null },
        { label: "Production", description: null, preview: null },
      ],
      multiSelect: false,
    };
    // Typed off the real field rather than off the literal: a fixture that
    // does not typecheck is testing a shape the bridge cannot send.
    const pending = (
      questions: PendingInterview["questions"],
    ): PendingInterview => ({
      blockId: "b-1",
      requestedAt: 0,
      title: "Pick a deployment target",
      description: "This decides the rollout order.",
      questions,
    });

    it("CONTRACT: questions=null renders NO form and NO submit action", () => {
      // Null means we do not know what is being asked. A form here would put
      // Submit under zero questions and send `answers: []` to an agent that
      // is blocked waiting for a real answer.
      const content = JSON.stringify(
        buildInterviewCard(CHAT, "epic-1", pending(null), 0).content,
      );
      expect(content).not.toContain("Input.ChoiceSet");
      expect(content).not.toContain(ANSWER_VERB);
      expect(content).toContain("Answer it on the desktop");
    });

    it("questions=[] says so in different words — it is a different fact", () => {
      const content = JSON.stringify(
        buildInterviewCard(CHAT, "epic-1", pending([]), 0).content,
      );
      expect(content).not.toContain(ANSWER_VERB);
      expect(content).toContain("no questions");
      // And NOT the null copy: "didn't reach the bot" would be false here.
      expect(content).not.toContain("Answer it on the desktop");
    });

    it("renders a ChoiceSet whose VALUES are the agent's bare labels, undecorated", () => {
      // The description is folded into the title so it stays visible, but the
      // value is what the agent gets back — decorating it would answer the
      // interview with a string the agent never offered.
      const content = buildInterviewCard(
        CHAT,
        "epic-1",
        pending([QUESTION]),
        0,
      ).content;
      const body = JSON.stringify(content);
      expect(body).toContain("Input.ChoiceSet");
      expect(body).toContain(ANSWER_VERB);

      const choices = JSON.parse(body) as {
        body: { type: string; choices?: { title: string; value: string }[] }[];
      };
      const choiceSet = choices.body.find((e) => e.type === "Input.ChoiceSet");
      expect(choiceSet?.choices).toEqual([
        { title: "Staging — safe", value: "Staging" },
        { title: "Production", value: "Production" },
      ]);
    });

    it("a question with no options is FREE TEXT, not an empty picker", () => {
      // An empty ChoiceSet renders a picker with nothing in it, which reads
      // as a loading failure rather than as a question.
      const content = JSON.stringify(
        buildInterviewCard(
          CHAT,
          "epic-1",
          pending([{ ...QUESTION, options: [] }]),
          0,
        ).content,
      );
      expect(content).toContain("Input.Text");
      expect(content).not.toContain("Input.ChoiceSet");
      expect(content).toContain(ANSWER_VERB);
    });

    it("carries the question list on the submit action, so the dispatcher need not guess an ordering", () => {
      const content = JSON.stringify(
        buildInterviewCard(
          CHAT,
          "epic-1",
          pending([QUESTION, { ...QUESTION, questionId: "q-2" }]),
          0,
        ).content,
      );
      const parsed = JSON.parse(content) as {
        actions: { data: Record<string, string> }[];
      };
      const refs = JSON.parse(
        parsed.actions[0]?.data["interviewQuestions"] ?? "null",
      ) as { index: number; questionId: string }[];
      expect(refs.map((r) => r.index)).toEqual([0, 1]);
      expect(refs.map((r) => r.questionId)).toEqual(["q-1", "q-2"]);
      expect(parsed.actions[0]?.data["interviewBlockId"]).toBe("b-1");
    });
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
    // The MARKER, not the code. Its punctuation changed in the 2026-08-09
    // design pass — `⟨code · a.ts · 3 lines⟩` in monospace angle brackets was
    // debug-console vocabulary — but what it must carry did not: which file,
    // and how much of it there is.
    expect(joined).toContain("a.ts");
    expect(joined).toContain("3 lines");
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
    // "Ran bun test" — the part's kind rendered as a verb a reader knows,
    // rather than the protocol's own word for it. See `PART_NOUN`.
    expect(visible.join(" ")).toContain("Ran bun test");
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

describe("read-surface/cards — the label comes from the capability, not locality", () => {
  const local = {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "Some agent",
    harnessId: "claude",
    surface: "gui" as const,
    active: false,
    isLocal: true,
    hostId: "h-local",
    capabilities: { readTranscript: true, sendMessage: true },
  };

  /** Measured shape of all 53 remote rows: readable, not messageable. */
  const remote = {
    ...local,
    isLocal: false,
    hostId: "h-elsewhere",
    capabilities: { readTranscript: true, sendMessage: false },
  };

  it("CONTRACT: an unsendable agent reads read-only, never Idle", () => {
    // "Idle" was a claim we had no basis for — `active` is local-only, so it
    // is false for every remote row whatever that agent is doing.
    const label = agentStatusLabel(remote);
    expect(label).toContain("Read-only");
    expect(label).not.toBe("Idle");
  });

  it("names the cause second, because the constraint is what the user acts on", () => {
    expect(agentStatusLabel(remote)).toBe("Read-only — runs on another host");
  });

  it("CONTRACT: reachability and observability are separate axes", () => {
    // The two agree on every row measured, and that correlation is the trap:
    // `sendMessage` answers "can this host REACH it", `isLocal` answers "can
    // this host SEE it work". Neither of these rows exists in production, and
    // both fail if the implementation collapses one axis into the other.

    // Reachable, not observable. It must NOT say "Active" — we cannot see it
    // — and it must NOT say "Idle" either, which was the first attempt and
    // is the same error as reading `active: false` as "not working".
    const remoteButSendable = {
      ...remote,
      capabilities: { readTranscript: true, sendMessage: true },
      active: true,
    };
    const label = agentStatusLabel(remoteButSendable);
    expect(label).not.toBe("Active");
    expect(label).not.toBe("Idle");
    expect(label).toContain("not visible");

    // Observable, not reachable. Read-only, and no claim about the host.
    const localButUnsendable = {
      ...local,
      capabilities: { readTranscript: true, sendMessage: false },
    };
    expect(agentStatusLabel(localButUnsendable)).toBe("Read-only");
  });

  it("CONTRACT: label and styling come from one derivation and cannot disagree", () => {
    // They did: the label moved to the capability and the badge colour was
    // left on locality two lines below, so a row rendered the word "Active"
    // in grey. No test asserted colour, which is why it was invisible.
    const remoteButSendable = {
      ...remote,
      capabilities: { readTranscript: true, sendMessage: true },
      active: true,
    };
    const p = agentStatusPresentation(remoteButSendable);
    // Not observable, so no green — and the label agrees.
    expect(p.color).toBe("default");
    expect(p.label).toContain("not visible");

    // The genuinely running row is the only one that goes green.
    const running = agentStatusPresentation({ ...local, active: true });
    expect(running.color).toBe("good");
    expect(running.label).toBe("Active");
  });

  /**
   * `emphasised` IS GONE, and this is what replaced the assertions on it.
   *
   * It existed to put an `emphasis` container behind a running row. The
   * 2026-08-09 design pass removed that: Adaptive Cards only pads a styled
   * Container, so a list mixing styled and unstyled rows renders ragged, and
   * three adjacent `emphasis` rows merged into one grey block that swallowed
   * their separators. `color` already carried exactly the same fact, so the
   * field was a second signal that could drift from the first — which is the
   * defect `agentStatusPresentation` was created to close.
   *
   * The split into `badge` and `detail` is the new thing that could drift,
   * so it is the new thing under test: both must be derived from `label`,
   * and together they must lose nothing it said.
   */
  it("CONTRACT: badge and detail are a split of the label, not a second derivation", () => {
    const remoteRow = agentStatusPresentation(remote);
    expect(remoteRow.label).toBe("Read-only — runs on another host");
    expect(remoteRow.badge).toBe("Read-only");
    expect(remoteRow.detail).toBe("runs on another host");

    // Short labels pass through whole, with nothing invented for `detail`.
    const runningRow = agentStatusPresentation({ ...local, active: true });
    expect(runningRow.badge).toBe("Active");
    expect(runningRow.detail).toBeNull();

    // The one label with no em dash that is still too long for a column.
    const unobservable = agentStatusPresentation({
      ...remote,
      capabilities: { readTranscript: true, sendMessage: true },
      active: true,
    });
    expect(unobservable.label).toBe("Activity not visible from here");
    expect(unobservable.badge).toBe("Not visible");
    expect(unobservable.detail).toBe("activity not visible from here");
  });

  it("CONTRACT: no badge is long enough to crowd the title out of its column", () => {
    // The failure this guards is a rendered one: the full label took nearly
    // the whole card width in an `auto` column and squeezed the agent's name
    // to a sliver. 16 characters is "Activity not visible from here" cut to
    // something that fits beside a title at 320px.
    const rows: readonly AgentSummary[] = [
      local,
      { ...local, active: true },
      remote,
      { ...remote, capabilities: { readTranscript: true, sendMessage: true } },
      { ...local, capabilities: { readTranscript: true, sendMessage: false } },
    ];
    for (const row of rows) {
      const { badge } = agentStatusPresentation(row);
      expect(badge.length, badge).toBeLessThanOrEqual(16);
    }
  });

  it("a remote unreachable row is never painted as running", () => {
    // `active` is local-only, so this row's `active: true` is not a signal we
    // have. Painting it green would be the fabricated status column again.
    const p = agentStatusPresentation({ ...remote, active: true });
    expect(p.color).toBe("default");
  });

  it("a sendable agent still reads Active or Idle — the control", () => {
    expect(agentStatusLabel({ ...local, active: true })).toBe("Active");
    expect(agentStatusLabel(local)).toBe("Idle");
  });

  it("the fleet card itself shows it, not just the helper", () => {
    const visible = JSON.stringify(
      collectTextBlocks(buildFleetCard([remote]).content),
    );
    expect(visible).toContain("Read-only");
  });
});

/**
 * The version pin, and a guard on what may be emitted under it.
 *
 * 1.5 shipped and EVERY card rendered as "cards.unsupported" in real Teams —
 * on desktop, not only mobile. Web Chat rendered them all correctly
 * throughout, which is why this was not caught: it is a more permissive
 * client, so verifying there measured the wrong specimen.
 *
 * These tests are the cheap thing that would have caught it.
 */
/*
 * REMOVED 2026-08-09: a second version test, and it carried a live landmine.
 *
 * The 2026-08-09 merge landed two "cards stay within 1.2" tests. This one
 * hand-listed five cards and matched substrings; the surviving one walks
 * `EVERY_CARD` and matches property names. Two checks of the same rule drift,
 * and this one already had.
 *
 * ITS DENY-LIST FORBADE `Input.ChoiceSet`, commented "not used; would need
 * care". `Input.ChoiceSet` is used five times in `cards.ts` — the interview
 * questions, and the intake form's time zone and jurisdiction pickers — and
 * it is a **1.0** element, so it is entirely legal. The test passed only
 * because none of its five hand-listed cards emit one.
 *
 * That is the trap: the next person to WIDEN its coverage gets a red build
 * telling them a correct, shipping card is illegal, and the cheapest way out
 * is to narrow the coverage again. Verified rather than assumed — adding
 * `buildInterviewCard` to its list fails it.
 *
 * `Action.ToggleVisibility` was in the same list, annotated "1.2 — listed to
 * catch accidental adoption". At 1.2 it is legal, so it is a POLICY entry in
 * a VERSION test, under a header reading "Every name here is 1.3+", which was
 * false for two of its eight entries. Policy about which legal features we
 * choose to use needs its own test and its own argument, not a smuggled row.
 *
 * Carried across to the survivor: the `version === "1.2"` assertion, which
 * only this one had, and `refresh` (1.4), which only this one listed.
 */

/**
 * THE CLASS, not the instances.
 *
 * Three separate times this session a card shipped a button with no handler:
 * "Waiting on you" on the help card, then the same button plus "New agent"
 * and "Show all" on the fleet card — the second set left behind by fixing
 * the first. Before the Action.Submit ingress existed, EVERY button was
 * dead; after it, an unhandled verb renders "Unknown card action".
 *
 * A button that renders, is pressable, and does nothing is the
 * `Action.Execute` failure. This walks the real cards, collects every verb
 * they emit, and requires each to be one the dispatcher handles — so the
 * next unhandled button fails here rather than in front of a user.
 */
describe("CONTRACT: every verb a card emits has a handler", () => {
  /**
   * IMPORTED from the dispatcher, not retyped here.
   *
   * This was a hand-copied literal, and it drifted in both directions at
   * once: it carried `traycer/openChat` before that verb had a handler (the
   * flaw the old comment named), and it was MISSING `traycer/answer`,
   * `traycer/confirmRoute` and `traycer/clarifyOther`, which have handlers.
   * Both errors were invisible because the check only walked two cards,
   * neither of which emits any of the four.
   *
   * A copy of a list is a claim about the list. Import the list.
   *
   * MERGE NOTE, 2026-08-09. `autobuild/opportunity-intake` carried its own
   * hand-typed copy of this set with `traycer/submitIntake` in it. Keeping
   * that copy would have hidden a real defect: `SUBMIT_INTAKE_VERB` is
   * dispatched in `dispatch-action.ts` but was NOT in `HANDLED_ACTION_VERBS`,
   * so the two branches disagreed and the test file was the one that lied.
   * The copy is gone and the verb is in the exported set.
   */
  const HANDLED = HANDLED_ACTION_VERBS;

  function verbsIn(node: unknown): string[] {
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record["verb"] === "string") found.push(record["verb"]);
      for (const key of Object.keys(record)) walk(record[key]);
    };
    walk(node);
    return found;
  }

  const AGENT = {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "An agent",
    harnessId: "claude",
    surface: "gui" as const,
    active: true,
    isLocal: true,
    hostId: "h1",
    capabilities: { readTranscript: true, sendMessage: true },
  };

  const CHAT = { chatId: "c1", title: "A chat" };
  const APPROVAL_FIXTURE = {
    approvalId: "ap-1",
    toolName: "Edit",
    description: "Change a file.",
    requestedAt: 0,
  };
  /**
   * TWO questions, and the second one HAS OPTIONS deliberately.
   *
   * `options: []` is the free-text branch, which emits `Input.Text`. With
   * only that, no card in `EVERY_CARD` ever emitted an `Input.ChoiceSet` —
   * so the version check above could not have caught a bad property on the
   * ChoiceSet path, which three real cards use (interview answers, and the
   * intake form's time zone and jurisdiction pickers).
   *
   * This mattered concretely: the duplicate version test deleted above
   * forbade `Input.ChoiceSet` outright, on a comment claiming it was unused.
   * Removing that entry is not evidence the false positive is gone — a fixture
   * that reaches the branch is. Both question branches are now covered.
   */
  const INTERVIEW_FIXTURE: PendingInterview = {
    blockId: "iv-1",
    requestedAt: 0,
    title: "A question",
    description: null,
    questions: [
      {
        questionId: "q1",
        question: "Which one?",
        header: null,
        options: [],
        multiSelect: false,
      },
      {
        questionId: "q2",
        question: "Pick any that apply",
        header: "Scope",
        options: [
          { label: "One", description: "the first", preview: null },
          { label: "Two", description: null, preview: null },
        ],
        multiSelect: true,
      },
    ],
  };
  const STATUS: ChatStatus = {
    chatId: "c1",
    title: "A chat",
    runStatus: "running",
    pendingApprovals: [APPROVAL_FIXTURE],
    pendingInterviews: [INTERVIEW_FIXTURE],
    connected: true,
  };
  const TRANSCRIPT_FIXTURE: Transcript = {
    chatId: "c1",
    title: "A chat",
    totalCount: 40,
    offset: 5,
    messages: [
      {
        messageId: "m1",
        role: "assistant",
        author: "claude",
        timestamp: 0,
        text: "hello",
        parts: [],
      },
    ],
  };

  /** The intake form's options, with nothing filled in — the state it opens in. */
  const INTAKE_FORM = {
    product: "sensormine",
    intent: "new-opportunity",
    skill: "smv4-new-opportunity",
    routeLabel: null,
    spokenText: "does this fit?",
    stagingId: "1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607",
    stagedNames: ["Tender.pdf"],
    values: {
      slug: "",
      buyer: "",
      deadlineDate: "",
      deadlineTime: "",
      timeZone: "",
      jurisdiction: "",
      owner: "",
    },
    errors: [],
    timeZones: DEADLINE_TIME_ZONES,
  } satisfies IntakeFormCardOptions;

  /**
   * EVERY card, not two of them.
   *
   * The check walked `buildFleetCard` and `buildHelpCard`, which were the two
   * that had shipped a dead button — so it covered the instances that had
   * already failed, which is the thing its own docblock says it exists not to
   * do. A bad verb on the chat card, the composer, the approval card or the
   * context strip would have passed.
   *
   * That was not hypothetical when this list was written: the 2026-08-09
   * design pass moved `Reply` and `History` OFF the fleet row and ONTO the
   * chat card, so the two most-pressed buttons in the product had just left
   * the only card under test.
   */
  const EVERY_CARD: readonly (readonly [string, () => unknown])[] = [
    ["fleet", () => buildFleetCard([AGENT]).content],
    ["fleet (empty)", () => buildFleetCard([]).content],
    ["help", () => buildHelpCard().content],
    ["chat (sendable)", () => buildChatCard(STATUS, "e1", true).content],
    ["chat (read-only)", () => buildChatCard(STATUS, "e1", false).content],
    [
      "chat (disconnected)",
      () => buildChatCard({ ...STATUS, connected: false }, "e1", true).content,
    ],
    ["compose", () => buildComposeCard(CHAT, "e1").content],
    [
      "approval",
      () => buildApprovalCard(CHAT, "e1", APPROVAL_FIXTURE, 0).content,
    ],
    [
      "interview",
      () => buildInterviewCard(CHAT, "e1", INTERVIEW_FIXTURE, 0).content,
    ],
    ["transcript", () => buildTranscriptCard(TRANSCRIPT_FIXTURE, 0).content],
    [
      "context strip",
      () => buildContextStripCard(TRANSCRIPT_FIXTURE, 0).content,
    ],
    ["unknown chat", () => buildUnknownChatCard("hi").content],
    ["usage", () => buildUsageCard("epic <id>").content],
    [
      "clarify",
      () =>
        buildClarifyCard({
          suggestionLabel: "a new opportunity",
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
        }).content,
    ],
    /*
     * The two intake cards, added when `autobuild/opportunity-intake` merged.
     *
     * They arrived with per-card copies of the two contract checks below,
     * written so that branch was honest in isolation. Putting them in this
     * table instead is the point of the table being a table: the form is now
     * covered by every contract in this describe, including ones its author
     * never saw, and a future card gets the same treatment by adding one row
     * rather than by remembering to write three tests.
     *
     * The form is the case that matters most here — the biggest card in the
     * file and the one most tempted by 1.3, since `label`, `isRequired` and
     * `errorMessage` are exactly what an input form reaches for.
     */
    ["intake form (empty)", () => buildIntakeFormCard(INTAKE_FORM).content],
    [
      // WITH errors and values, because the error path is the one that would
      // reach for `errorMessage`, and it renders nodes the empty form has not.
      "intake form (filled, with errors)",
      () =>
        buildIntakeFormCard({
          ...INTAKE_FORM,
          routeLabel: "a SensorMine opportunity",
          values: {
            slug: "acme",
            buyer: "Acme",
            deadlineDate: "2026-09-15",
            deadlineTime: "17:00",
            timeZone: "Australia/Perth",
            jurisdiction: "local",
            owner: "Elliot Wood",
          },
          errors: [{ field: "slug", message: "Give the bid a short name." }],
        }).content,
    ],
    ["intake refused", () => buildIntakeRefusedCard("Two files share a name.").content],
  ];

  it.each(EVERY_CARD)("%s emits only handled verbs", (_name, build) => {
    for (const verb of verbsIn(build())) {
      expect(HANDLED.has(verb)).toBe(true);
    }
  });

  it("at least one card under test actually emits a verb", () => {
    // The walker returning `[]` for everything would pass every case above.
    const total = EVERY_CARD.flatMap(([, build]) => verbsIn(build()));
    expect(total.length).toBeGreaterThan(0);
  });

  /**
   * TEAMS IS INTAKE-ONLY. Settled by Elliot, 2026-08-09.
   *
   * The bot starts assessments and delivers review copies. It does NOT
   * authorise claims, decide go/no-go, or lodge a tender — those belong to a
   * named human, in the repo, via `authorise.mjs` and `closeout.mjs`. The
   * `smv4-opportunity-pipeline` skill writes every claim `draft` on purpose
   * and keeps `closeout.mjs` separate precisely because "rendering a bundle
   * is not lodging a tender".
   *
   * A comment saying "don't add such a verb" is worth less than a test that
   * fails when someone does, because the person who adds it will be adding a
   * button that looks exactly like every other button here.
   *
   * MATCHES ON THE VERB STRING, so it catches a new verb nobody thought to
   * add to `HANDLED` as well as one they did. It cannot catch a verb whose
   * name hides what it does — `traycer/finalise` would pass — so it is a
   * floor, not a proof. The floor is worth having: the obvious spelling of
   * the mistake is the one somebody makes.
   */
  const FORBIDDEN = /authoris|authoriz|closeout|close-out|lodge|lodgement|submit-?tender|go-?no-?go/i;

  it("CONTRACT: no card offers to authorise, lodge, or decide go/no-go", () => {
    for (const [name, build] of EVERY_CARD) {
      for (const verb of verbsIn(build())) {
        expect(
          FORBIDDEN.test(verb),
          `${name} emits "${verb}", which reads as a customer-facing authorisation. Teams is intake-only — see the epic's opportunity-skill-handoff.`,
        ).toBe(false);
      }
    }
  });

  /**
   * NOTHING ABOVE THE VERSION WE DECLARE.
   *
   * `buildApprovalCard` carried `Input.Text.label`, which is Adaptive Cards
   * **1.3**, on a card pinned to 1.2. It had been there for months and every
   * screenshot showed it rendering perfectly — because the local
   * `adaptivecards` library is current and permissive, which is the exact
   * wrong-specimen measurement this codebase already lost a release to.
   *
   * A comment saying "don't exceed 1.2" cannot catch that: the property looks
   * ordinary, the card builds, and the renderer we own agrees with it. Only
   * something that walks the emitted JSON can.
   *
   * DELIBERATELY A DENY-LIST, not an allow-list of every 1.0–1.2 property.
   * An allow-list would need updating for every legitimate addition and would
   * fail closed on things that are fine, so it would be turned off. This
   * names the properties above 1.2 that are PLAUSIBLE to reach for — the ones
   * an editor autocompletes and a schema doc recommends — and says so rather
   * than claiming completeness.
   *
   * Raise the entries out of this list in the same change that raises
   * `ADAPTIVE_CARD_VERSION`, as a deliberate decision. That is the rule the
   * file's own version docblock states: "the lowest version that renders what
   * we actually emit", not "the lowest number".
   */
  const ABOVE_1_2: readonly (readonly [string, string])[] = [
    ["label", "1.3 — use a TextBlock above the input"],
    ["isRequired", "1.3"],
    ["errorMessage", "1.3"],
    ["targetWidth", "1.5 — and ignored on Teams iOS"],
    ["style: heading", "1.5"],
    ["Action.Execute", "1.4 — and silently dead on Teams mobile"],
    ["Table", "1.5"],
    ["RichTextBlock", "1.2 element, but Teams support is unverified"],
    // Carried over from the duplicate version test deleted above — the one
    // entry it had that this list did not.
    ["refresh", "1.4 — and Universal Actions are dead on Teams mobile"],
  ];

  function propertiesIn(node: unknown): Set<string> {
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        found.add(key);
        // Element and style names travel as VALUES, not keys.
        if (
          (key === "type" || key === "style") &&
          typeof record[key] === "string"
        ) {
          found.add(`${key}: ${record[key] as string}`);
          found.add(record[key] as string);
        }
        walk(record[key]);
      }
    };
    walk(node);
    return found;
  }

  it.each(EVERY_CARD)("%s emits nothing above Adaptive Cards 1.2", (_name, build) => {
    const present = propertiesIn(build());
    for (const [property, why] of ABOVE_1_2) {
      expect(
        present.has(property),
        `emits "${property}" (${why}) while ADAPTIVE_CARD_VERSION is 1.2. Teams drops what it does not know, silently, and our local renderer will not show you.`,
      ).toBe(false);
    }
  });

  it("COVERAGE: the card set actually reaches the ChoiceSet branch", () => {
    // The deny-list is only as good as what the fixtures reach. `Input.Text`
    // and `Input.ChoiceSet` are different code paths in
    // `interviewQuestionElements`, and for a long time only the first was
    // exercised — so a version violation on the second could not have been
    // caught. This fails if a fixture change quietly drops that coverage.
    const emitted = new Set(
      EVERY_CARD.flatMap(([, build]) => [...propertiesIn(build())]),
    );
    expect(emitted.has("Input.ChoiceSet")).toBe(true);
    expect(emitted.has("Input.Text")).toBe(true);
    expect(emitted.has("ActionSet")).toBe(true);
    expect(emitted.has("ColumnSet")).toBe(true);
  });

  it.each(EVERY_CARD)("%s declares version 1.2", (_name, build) => {
    // Carried over from the duplicate version test deleted above, which was
    // the only one asserting this. Without it, the deny-list above could pass
    // on a card that had quietly declared 1.5 — the pin and the contents
    // would agree, and both would be wrong.
    const content = build() as { version?: string };
    expect(content.version).toBe("1.2");
  });

  it("CONTROL: the version check can fail, and reads nested properties", () => {
    // The walker returning nothing would pass every case above. This is the
    // exact shape that shipped: a 1.3 property on an input, two containers
    // deep, inside a card body.
    const offending = {
      type: "AdaptiveCard",
      body: [
        {
          type: "Container",
          items: [{ type: "Input.Text", id: "x", label: "Reason" }],
        },
      ],
    };
    expect(propertiesIn(offending).has("label")).toBe(true);
    expect(propertiesIn(offending).has("Input.Text")).toBe(true);
    // And a clean card is clean, so the check is not simply always true.
    expect(propertiesIn(buildHelpCard().content).has("label")).toBe(false);
  });

  it("CONTROL: the checks can fail", () => {
    // Without these, a walker that silently found nothing and a regex that
    // matched nothing would both pass everything above.
    expect(HANDLED.has("traycer/notAThing")).toBe(false);
    expect(FORBIDDEN.test("traycer/authorise")).toBe(true);
    expect(FORBIDDEN.test("traycer/closeout")).toBe(true);
    expect(FORBIDDEN.test("traycer/reply")).toBe(false);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────
   * TEAMS IS INTAKE-ONLY. Settled by Elliot, 2026-08-09.
   * ─────────────────────────────────────────────────────────────────────
   *
   * The bot starts assessments and delivers review copies. It does NOT
   * decide go/no-go, authorise a claim for a customer, or lodge a tender.
   * The pipeline puts all three with a named human, in the repo, and says so
   * repeatedly: the decision starts `pending` because "deciding to bid
   * belongs to stage 1 and a named human"; `register-evidence` writes every
   * claim as `draft` because "authorising a statement to go to a buyer is a
   * judgement and a person sets that"; `closeout.mjs` exists because
   * "rendering a bundle is not lodging a tender".
   *
   * A comment saying "don't wire this" is worth nothing the day someone
   * wires it. These tests fail instead.
   *
   * MERGE NOTE, 2026-08-09. This arrived with a third test — a verb walk over
   * four hand-listed cards — which is the same axis as
   * "no card offers to authorise, lodge, or decide go/no-go" above, and a
   * strictly weaker version of it: that one walks EVERY_CARD, so it cannot go
   * stale when a card is added. The two below are NOT duplicates of it. They
   * are the axis it cannot reach: a card-verb check sees a button, and this
   * sees the wiring — including a path that never becomes a card at all.
   */
  const FORBIDDEN_TOOLS = ["authorise.mjs", "authorize.mjs", "closeout.mjs"];

  // The dispatcher half of this prohibition — that no such verb is HANDLED —
  // lives in `intake-flow.test.ts`, where a real `DispatchDeps` exists to run
  // it against.

  it("PROHIBITION: no source file in this bot names the pipeline's authorising tools", async () => {
    /*
     * The strongest of the three, and the one that fires FIRST.
     *
     * A verb check catches a button. This catches the wiring behind one —
     * including a path that never becomes a card at all, such as a proactive
     * job or a command. If a future change genuinely needs to name one of
     * these tools, this test failing is the conversation that should happen.
     *
     * IT MATCHES RAW TEXT, so a COMMENT naming one of these files fails it
     * too. That is not a false positive worth engineering away — it caught a
     * real one on the 2026-08-09 merge, where `buildApprovalCard`'s docblock
     * cited both filenames while explaining this very boundary, and the fix
     * was to say "the pipeline's authorising or closeout tools" instead. A
     * comment-aware scanner would be more code, more fragile, and would buy
     * back only the right to write a filename in prose.
     */
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );

    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Tests are excluded — THIS file names all three, and a check that
          // fails on its own assertions asserts nothing.
          if (entry.name !== "__tests__") await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = await readFile(full, "utf8");
        for (const tool of FORBIDDEN_TOOLS) {
          if (source.includes(tool)) offenders.push(`${entry.name}: ${tool}`);
        }
      }
    };
    await walk(root);
    expect(offenders).toEqual([]);
  });

  it("CONTROL: the source scan can fail — it finds a string that IS present", async () => {
    // Without this, a walker pointed at the wrong directory reports a clean
    // repo and proves nothing. `buildInstruction` is a real symbol in
    // `src/intake/dispatch-assessment.ts`; if the scan cannot see it, it
    // cannot see `authorise.mjs` either.
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    let found = false;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if ((await readFile(full, "utf8")).includes("export function buildInstruction")) {
          found = true;
        }
      }
    };
    await walk(root);
    expect(found).toBe(true);
  });
});

/**
 * A CARD MAY NOT PROMISE WHAT NOTHING DELIVERS.
 *
 * `buildAssessmentStartedCard` said "I'll reply here when it's done." Nothing
 * replies: `proactive/` has no production caller — nothing outside that
 * directory imports it, and `index.ts` constructs neither a store nor an
 * adapter send. So a salesperson started an assessment, read a sentence
 * telling them to wait, and never heard again.
 *
 * The wording is the instance. The class is that anyone can add a delivery
 * promise to any card at any time and nothing notices, which is how this one
 * arrived: it was TRUE AS DESIGNED, and the design was three-quarters built.
 * `start-assessment.ts` still captures the conversation reference, persists
 * it, and refuses to start without it.
 *
 * THIS TEST ENCODES THE DEPENDENCY, NOT A SNAPSHOT — which is the whole point
 * and the reason it is not just an assertion that a string is absent. It
 * fails only while BOTH are true: a card promises a later reply, AND nothing
 * imports the delivery path. Wire R7 and it goes quiet on its own, no edit
 * needed, and the sentence can come back in the same change.
 *
 * A test that had to be deleted to ship the feature would be deleted early.
 */
describe("CONTRACT: no card promises a later reply while nothing delivers one", () => {
  /**
   * Phrasings that commit the bot to speaking FIRST, later.
   *
   * Not every future-tense sentence: "it's running" and "I'll try again" make
   * no such commitment. These are the ones that tell a reader they may stop
   * checking, which is the behaviour that costs them the result.
   */
  const PROMISES = [
    /I'?ll reply/i,
    /I'?ll let you know/i,
    /I'?ll tell you/i,
    /I'?ll message you/i,
    /I'?ll ping you/i,
    /I'?ll send/i,
    /notify you/i,
    /you'?ll (?:get|receive|hear)/i,
    /we'?ll (?:reply|let you know|notify)/i,
  ];

  /** Every card in one place — the same table the verb and version checks use. */
  const CARD_TEXT = (): string =>
    JSON.stringify([
      buildAssessmentStartedCard({ title: "An assessment", deepLink: null }),
      buildAssessmentStartedCard({
        title: "An assessment",
        deepLink: "https://example.invalid/tab",
      }),
      buildAssessmentUnconfirmedCard("socket closed", undefined),
      buildAssessmentUnconfirmedCard("refused", { certain: true }),
      buildHelpCard(),
      buildClarifyCard({
        suggestionLabel: "a new opportunity",
        product: "p",
        intent: "i",
        skill: "s",
      }),
    ]);

  /**
   * Is the delivery path wired? Read from the SOURCE, not from a constant
   * someone would have to remember to flip.
   *
   * "Wired" is defined as: some non-test file outside `src/proactive/`
   * imports from it. That is the exact thing whose absence makes the promise
   * false, so it is the exact thing to measure.
   */
  async function proactiveIsWired(): Promise<boolean> {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    let wired = false;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip the implementation itself — `proactive/` importing
          // `proactive/` is not a caller — and skip tests, which import it
          // precisely because it is unwired.
          if (entry.name !== "__tests__" && entry.name !== "proactive") {
            await walk(full);
          }
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (/from\s+"[^"]*\/proactive\//.test(await readFile(full, "utf8"))) {
          wired = true;
        }
      }
    };
    await walk(root);
    return wired;
  }

  it("no card promises a later reply, unless the proactive path is wired", async () => {
    const text = CARD_TEXT();
    const promising = PROMISES.filter((re) => re.test(text)).map(String);
    if (promising.length === 0) return;

    expect(
      await proactiveIsWired(),
      `a card promises a later reply (${promising.join(", ")}) but nothing outside src/proactive/ imports it, so nothing sends one. Either remove the promise or wire the delivery — R7 fires on assemble-bundle exiting 0 against an authorised bid, not on chat completion.`,
    ).toBe(true);
  });

  it("CONTROL: both halves of the check can fire", async () => {
    // Half one: the phrasing test catches the exact sentence that shipped,
    // and does not fire on the honest replacement. Without this the guard
    // passes because its regexes match nothing anywhere.
    const shipped = "It's running. I'll reply here when it's done.";
    expect(PROMISES.some((re) => re.test(shipped))).toBe(true);
    expect(
      PROMISES.some((re) =>
        re.test("It's running. Open it to watch progress — I won't ping you when it finishes."),
      ),
    ).toBe(false);

    // Half two: the source scan reaches real files. It must find the bot's
    // own imports; if it cannot see `./cards`, it could not see a
    // `proactive/` import either and would report "unwired" forever — which
    // is the direction that fails SILENTLY, since an unwired verdict only
    // matters when a promise exists.
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = new URL("../../", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    );
    let sawAnImport = false;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (/from\s+"\.\/cards"/.test(await readFile(full, "utf8"))) {
          sawAnImport = true;
        }
      }
    };
    await walk(root);
    expect(sawAnImport).toBe(true);
  });

  /**
   * IF THE COPY SAYS GO SOMEWHERE, THE CARD CARRIES THE WAY THERE.
   *
   * A defect I introduced. The three outcome `failed` branches used to say
   * *check with "chat &lt;id&gt;"*; I rewrote them to *open the chat and
   * check* while taking the CLI out of every other card — and those cards had
   * no Open button. The old copy named a command that worked. The new copy
   * named a gesture with no affordance on the card saying it, which is
   * strictly worse than what it replaced.
   *
   * Same shape as the ack card promising a reply nothing sends, one size
   * down: an instruction whose subject is not on screen. I had spent the day
   * auditing other people's cards for exactly this.
   *
   * Deliberately keyed on "Open the chat" rather than on every imperative in
   * English. A general "does this sentence ask for an action" check would be
   * guesswork; this is the one phrase the cards actually use, and a new one
   * should be added here in the change that introduces it.
   */
  it("CONTRACT: a card that says 'open the chat' offers a button that does", () => {
    const chat = { chatId: "c1", title: "A chat" };
    const failed = { kind: "failed" as const, reason: "window expired" };

    const sayers = [
      ["approval outcome", buildActionOutcomeCard(failed, "approve", chat)],
      ["message outcome", buildMessageOutcomeCard(failed, chat)],
      ["interview outcome", buildInterviewOutcomeCard(failed, chat)],
    ] as const;

    for (const [name, attachment] of sayers) {
      const content = attachment.content as {
        actions?: readonly unknown[];
      };
      const text = JSON.stringify(content);
      // The premise: these really are the cards that give the instruction.
      // Without this the loop passes vacuously if the copy is reworded.
      expect(text.toLowerCase(), name).toContain("open the chat");
      expect(content.actions ?? [], name).not.toHaveLength(0);
      expect(text, name).toContain(OPEN_CHAT_VERB);
    }
  });

  it("CONTROL: an outcome card with nothing to say offers nothing", () => {
    // Restraint is the other half of the rule — a button on every card is
    // the fleet-row defect again. `applied` gives no instruction, so it gets
    // no action.
    const applied = { kind: "applied" as const };
    const content = buildActionOutcomeCard(applied, "approve", {
      chatId: "c1",
      title: null,
    }).content as { actions?: readonly unknown[] };
    expect(content.actions ?? []).toHaveLength(0);
  });

  it("the ack card always offers exactly one action, with or without a deep link", () => {
    // Without a deep link it used to render NO action — a promise, no link,
    // and no instruction, which is the state the VM deploy actually ships
    // because TRAYCER_TEAMS_TAB_URL is unset there.
    for (const deepLink of [null, "https://example.invalid/tab"]) {
      const content = buildAssessmentStartedCard({ title: "An assessment", deepLink })
        .content as { actions?: readonly unknown[] };
      expect(content.actions, `deepLink=${String(deepLink)}`).toHaveLength(1);
    }
  });
});

describe("transcript rendering — facts in the slot that means them", () => {
  const assistant = {
    messageId: "m1",
    role: "assistant" as const,
    author: "haiku",
    timestamp: 0,
    text: "done",
    parts: [],
  };
  const fromAgent = {
    messageId: "m2",
    role: "user" as const,
    author: "Teams P0 — Generator",
    timestamp: 0,
    text: "do it",
    parts: [],
  };

  it("CONTRACT: an assistant turn is attributed to the agent, not to the model", () => {
    // `author` on an assistant turn is the MODEL alias. Rendering it as the
    // speaker put a true fact about a neighbouring subject in the slot a
    // reader parses as "who said this".
    expect(speakerLabel(assistant)).toBe("Agent");
    expect(speakerLabel(assistant)).not.toBe("haiku");
  });

  it("CONTRACT: 'default' is not special-cased — the rule is the ROLE", () => {
    // My first fix mapped "default" to "Agent" as if it were a placeholder.
    // That looks correct on the transcript that exposed it and preserves the
    // defect for every model whose alias reads like a name. This asserts the
    // general rule instead: `haiku` and `default` are treated identically.
    expect(speakerLabel({ ...assistant, author: "default" })).toBe(
      speakerLabel({ ...assistant, author: "haiku" }),
    );
  });

  it("an incoming message keeps its sender's title", () => {
    expect(speakerLabel(fromAgent)).toBe("Teams P0 — Generator");
  });

  it("the model moves to the metadata line, where being a model is unambiguous", () => {
    // The `⟨model · …⟩` wrapper went with the rest of the angle-bracket
    // vocabulary. What this test is actually about survives unchanged: the
    // model appears for an ASSISTANT turn and never for an incoming one,
    // where the same field means the sending agent's title.
    expect(modelMarker(assistant)).toBe("haiku");
    expect(modelMarker(fromAgent)).toBeNull();
  });

  it("humanises an MCP tool identifier and leaves other labels alone", () => {
    expect(humaniseToolName("mcp__traycer_a2a__traycer_send_message")).toBe(
      "traycer send message",
    );
    expect(humaniseToolName("Bash")).toBe("Bash");
  });

  it("CONTRACT: pluralises lines — '1 lines' reached a user", () => {
    const one = partMarker({ kind: "other", label: "reasoning", lines: 1 });
    expect(one).toContain("1 line");
    expect(one).not.toContain("1 lines");
    expect(partMarker({ kind: "other", label: "reasoning", lines: 3 })).toContain(
      "3 lines",
    );
  });

  it("CONTRACT: strips the tenant prefix from a file path", () => {
    // `/srv/traycer/tenants/<name>` embeds a tenant name, and this product is
    // heading for users looking at hosts they do not own.
    expect(
      shortenWorkspacePath("/srv/traycer/tenants/someone/work/proj/FILE.md"),
    ).toBe("work/proj/FILE.md");
    expect(shortenWorkspacePath("/home/someone/work/x.ts")).toBe("work/x.ts");
  });

  it("leaves a path it cannot confidently shorten intact", () => {
    expect(shortenWorkspacePath("src/index.ts")).toBe("src/index.ts");
    expect(shortenWorkspacePath("/opt/thing/x")).toBe("/opt/thing/x");
  });
});

describe("CONTRACT: the assessment failure card must not report a certain outcome as uncertain", () => {
  it("says plainly that nothing started when the refusal happened BEFORE the create", () => {
    // Elliot saw "Couldn't confirm it started" over a body reading "so I
    // haven't started". A definite outcome dressed as an uncertain one — the
    // false-success defect mirrored, in the work that spent a day making sure
    // `failed` never means "did not apply".
    const body = cardBody(
      buildAssessmentUnconfirmedCard("no reference", { certain: true }),
    );
    expect(body).toContain("I haven’t started");
    expect(body).not.toContain("Couldn’t confirm");
  });

  it("keeps 'couldn’t confirm' for the case that genuinely does not know", () => {
    const body = cardBody(buildAssessmentUnconfirmedCard("socket closed", undefined));
    expect(body).toContain("Couldn’t confirm");
  });

  it("CONTRACT: gives the retry the RIGHT reason, which differs between them", () => {
    // Nothing created → safe because nothing happened.
    // Create attempted → safe because createChat dedupes on a client id.
    // The old card gave the idempotency reason in both, and that reason is
    // the one that gets copied to createArtifact, where a retry duplicates.
    const certain = cardBody(
      buildAssessmentUnconfirmedCard("x", { certain: true }),
    );
    expect(certain).toContain("Nothing was created");
    expect(certain).not.toContain("second assessment");

    const unsure = cardBody(buildAssessmentUnconfirmedCard("x", undefined));
    expect(unsure).toContain("second assessment");
  });
});
