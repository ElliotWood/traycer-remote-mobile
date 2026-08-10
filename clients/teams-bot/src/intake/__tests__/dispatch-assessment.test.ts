import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableConversationReferenceStore } from "../../state/conversation-reference-store";
import {
  buildChatTitle,
  buildInstruction,
  dispatchAssessment,
} from "../dispatch-assessment";
import type { SkillRoute } from "../classify";

const ROUTE: SkillRoute = {
  product: "sensormine",
  intent: "new-opportunity",
  skill: "smv4-opportunity-pipeline",
};

const OPPORTUNITY = {
  slug: "acme-water-rfp",
  buyer: "Acme Water",
  deadline: "2026-09-15T17:00:00+08:00",
  jurisdiction: "local",
  owner: "Elliot Wood",
};

const REFERENCE = {
  channelId: "msteams",
  serviceUrl: "https://smba.example.invalid/au/",
  conversation: { id: "conv-1", conversationType: "personal" },
  bot: { id: "bot-1" },
  user: { id: "user-1" },
};

function store() {
  return new DurableConversationReferenceStore(
    join(mkdtempSync(join(tmpdir(), "dispatch-")), "refs.json"),
    undefined,
  );
}

describe("dispatchAssessment", () => {
  it("creates the chat, sends the instruction, and reports started", async () => {
    const createChat = vi.fn().mockResolvedValue({ chatId: "chat-1" });
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const outcome = await dispatchAssessment(
      {
        createChat,
        sendMessage,
        references: store(),
        chatId: "chat-1",
        now: 1000,
      },
      {
        route: ROUTE,
        spokenText: "does this fit SensorMine?",
        opportunity: OPPORTUNITY,
        documents: null,
        conversationReference: REFERENCE,
      },
    );
    expect(outcome).toEqual({ kind: "started", chatId: "chat-1" });
    expect(createChat).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("CONTRACT: records the reference BEFORE creating, so a failed create is still answerable", async () => {
    // The case that matters is the assessment that started and whose ack
    // never arrived. Recording after a successful create loses exactly that.
    const references = store();
    const createChat = vi.fn().mockRejectedValue(new Error("socket closed"));
    const outcome = await dispatchAssessment(
      {
        createChat,
        sendMessage: vi.fn(),
        references,
        chatId: "chat-1",
        now: 1000,
      },
      {
        route: ROUTE,
        spokenText: "does this fit SensorMine?",
        opportunity: OPPORTUNITY,
        documents: null,
        conversationReference: REFERENCE,
      },
    );
    expect(outcome.kind).toBe("unconfirmed");
    expect(references.recall("chat-1")).not.toBeNull();
  });

  it("CONTRACT: refuses when the reference is unusable, rather than starting unanswerable work", async () => {
    // Spending agent time on a customer document whose result has nowhere to
    // go is worse than not starting: it produces a document nobody receives.
    const createChat = vi.fn();
    const outcome = await dispatchAssessment(
      {
        createChat,
        sendMessage: vi.fn(),
        references: store(),
        chatId: "chat-1",
        now: 1000,
      },
      {
        route: ROUTE,
        spokenText: "does this fit SensorMine?",
        opportunity: OPPORTUNITY,
        documents: null,
        // No serviceUrl — cannot be replied to later.
        conversationReference: { channelId: "msteams", conversation: {} },
      },
    );
    expect(outcome.kind).toBe("unconfirmed");
    expect(createChat).not.toHaveBeenCalled();
  });

  it("CONTRACT: a retry reuses the SAME chat id — the whole idempotency argument", async () => {
    const createChat = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce({ chatId: "chat-1" });
    const deps = {
      createChat,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      references: store(),
      chatId: "chat-1",
      now: 1000,
    };
    const input = {
      route: ROUTE,
      spokenText: "does this fit SensorMine?",
      opportunity: OPPORTUNITY,
      documents: null,
      conversationReference: REFERENCE,
    };
    const first = await dispatchAssessment(deps, input);
    const second = await dispatchAssessment(deps, input);
    expect(first.kind).toBe("unconfirmed");
    expect(second.kind).toBe("started");
    const ids = createChat.mock.calls.map(
      (c) => (c[0] as { chatId: string }).chatId,
    );
    expect(ids).toEqual(["chat-1", "chat-1"]);
  });

  it("does not send the instruction when the create failed", async () => {
    const sendMessage = vi.fn();
    await dispatchAssessment(
      {
        createChat: vi.fn().mockRejectedValue(new Error("nope")),
        sendMessage,
        references: store(),
        chatId: "chat-1",
        now: 1000,
      },
      {
        route: ROUTE,
        spokenText: "x",
        opportunity: OPPORTUNITY,
        documents: null,
        conversationReference: REFERENCE,
      },
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("buildInstruction", () => {
  const DOCUMENTS = {
    directory: "/srv/traycer/teams-bot/state/intake/1f0a2b3c",
    names: ["Tender.pdf", "Schedule A.xlsx"],
  };

  it("names the skill and quotes the requester verbatim", () => {
    const text = buildInstruction(
      ROUTE,
      "does this fit SensorMine?",
      OPPORTUNITY,
      DOCUMENTS,
    );
    expect(text).toContain("smv4-opportunity-pipeline");
    expect(text).toContain("does this fit SensorMine?");
  });

  it("CONTRACT: carries all five fields new-bid.mjs refuses to run without", () => {
    // Field by field would pass while a sixth silently went missing, and the
    // whole gap this closes is fields that never reached the agent. Every
    // value has to appear.
    const text = buildInstruction(ROUTE, "hello", OPPORTUNITY, DOCUMENTS);
    for (const value of Object.values(OPPORTUNITY)) {
      expect(text, `missing ${value}`).toContain(value);
    }
  });

  it("CONTRACT: the deadline reaches the agent with its offset intact", () => {
    // The offset is the reason `deadline.ts` exists. An instruction that
    // rendered the deadline through anything date-shaped would drop it, and
    // `new-bid.mjs` would refuse a request that looked complete here.
    const text = buildInstruction(ROUTE, "hello", OPPORTUNITY, DOCUMENTS);
    expect(text).toContain("2026-09-15T17:00:00+08:00");
  });

  it("CONTRACT: gives an absolute path to the documents, not a count", () => {
    // The whole of G2. The previous version said "2 documents attached" and
    // gave no path, so the agent had no way to open one.
    const text = buildInstruction(ROUTE, "hello", OPPORTUNITY, DOCUMENTS);
    expect(text).toContain(DOCUMENTS.directory);
    expect(text).toContain("Tender.pdf");
    expect(text).toContain("Schedule A.xlsx");
  });

  it("CONTRACT: does NOT name the pipeline's own directory layout", () => {
    // Scaffolding a bid is the skill's job. Naming `Sales/rfp/bids/<slug>/source`
    // here would couple the bot to a path the pipeline owns and revalidates,
    // and would break silently the first time it moves.
    const text = buildInstruction(ROUTE, "hello", OPPORTUNITY, DOCUMENTS);
    expect(text).not.toContain("Sales/rfp");
    expect(text).not.toContain("bids/");
  });

  it("CONTRACT: tells the agent Teams is not authority to authorise or lodge", () => {
    const text = buildInstruction(ROUTE, "hello", OPPORTUNITY, DOCUMENTS);
    expect(text.toLowerCase()).toContain("intake-only");
    expect(text.toLowerCase()).toContain("lodging");
  });

  it("says so plainly when no skill is configured, rather than inventing one", () => {
    const text = buildInstruction(
      { ...ROUTE, skill: null },
      "hello",
      OPPORTUNITY,
      null,
    );
    expect(text).toContain("no skill configured");
    expect(text).not.toContain("smv4");
  });

  it("says no documents were attached rather than staying silent", () => {
    expect(buildInstruction(ROUTE, "hello", OPPORTUNITY, null)).toContain(
      "No documents",
    );
  });
});

describe("buildChatTitle", () => {
  it("uses the first line of the request", () => {
    expect(buildChatTitle(ROUTE, "Assess the Acme RFI\nmore detail")).toBe(
      "Assess the Acme RFI",
    );
  });

  it("caps a long line", () => {
    const title = buildChatTitle(ROUTE, "y".repeat(200));
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("CONTRACT: never empty — an unnamed agent stays unnamed for life", () => {
    expect(buildChatTitle(ROUTE, "   ").length).toBeGreaterThan(0);
  });
});
