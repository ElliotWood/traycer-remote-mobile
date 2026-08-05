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
import type { IntakeFile } from "../intake-store";

/** A stored document, as the intake store hands it over. */
const FILE: IntakeFile = {
  name: "Retail Presentation.pptx",
  path: "/srv/traycer/teams-bot/state/intake/abc/files/Retail Presentation.pptx",
  bytes: 2048,
};

const ROUTE: SkillRoute = {
  product: "sensormine",
  intent: "new-opportunity",
  skill: "smv4-new-opportunity",
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
        attachments: { files: [FILE] },
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
        attachments: { files: [FILE] },
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
        attachments: { files: [FILE] },
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
      attachments: { files: [FILE] },
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
        attachments: { files: [] },
        conversationReference: REFERENCE,
      },
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("buildInstruction", () => {
  it("names the skill and quotes the requester verbatim", () => {
    const text = buildInstruction(ROUTE, "does this fit SensorMine?", {
      files: [FILE],
    });
    expect(text).toContain("smv4-new-opportunity");
    expect(text).toContain("does this fit SensorMine?");
  });

  it("CONTRACT: gives the skill the PATH, not a count it cannot act on", () => {
    // This is the defect the whole intake path exists to fix. The old
    // instruction said "1 document attached to the request." and named
    // nothing, so the agent's best available move was to answer from the
    // request text — which reads, in the transcript, exactly like an
    // assessment that read the document.
    const text = buildInstruction(ROUTE, "assess this", { files: [FILE] });
    expect(text).toContain(FILE.path);
    expect(text).toContain(FILE.name);
    expect(text).toMatch(/read it before answering/i);
  });

  it("names every file when there are several", () => {
    const second: IntakeFile = { ...FILE, name: "Pricing.xlsx", path: "/tmp/p.xlsx" };
    const text = buildInstruction(ROUTE, "assess these", {
      files: [FILE, second],
    });
    expect(text).toContain(FILE.path);
    expect(text).toContain(second.path);
    expect(text).toContain("2 documents were attached");
  });

  it("CONTRACT: names files that could not be fetched, rather than hiding them", () => {
    // Silence here is the same class of bug as the count: the agent answers
    // as though nothing was attached, and nobody downstream can tell that
    // from a request that genuinely had no document.
    const text = buildInstruction(ROUTE, "assess this", {
      files: [],
      unavailable: [{ name: "Deck.pptx", reason: "channel files need Graph" }],
    });
    expect(text).toContain("Deck.pptx");
    expect(text).toContain("channel files need Graph");
    expect(text).toMatch(/could not be retrieved/i);
  });

  it("says so plainly when no skill is configured, rather than inventing one", () => {
    const text = buildInstruction({ ...ROUTE, skill: null }, "hello", {
      files: [],
    });
    expect(text).toContain("no skill configured");
    expect(text).not.toContain("smv4");
  });

  it("says no documents were attached rather than staying silent", () => {
    expect(buildInstruction(ROUTE, "hello", { files: [] })).toContain(
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
