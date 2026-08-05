import { describe, expect, it } from "vitest";
import { parseCommand } from "../commands";

describe("read-surface/commands", () => {
  it("recognises the fleet aliases", () => {
    expect(parseCommand("fleet").kind).toBe("fleet");
    expect(parseCommand("agents").kind).toBe("fleet");
    expect(parseCommand("list").kind).toBe("fleet");
    expect(parseCommand("FLEET").kind).toBe("fleet");
  });

  it("recognises epics", () => {
    expect(parseCommand("epics").kind).toBe("epics");
  });

  it("parses an epic binding with its id", () => {
    expect(parseCommand("epic abc-123")).toEqual({
      kind: "bind_epic",
      epicId: "abc-123",
    });
  });

  it("parses a chat lookup under both aliases", () => {
    expect(parseCommand("chat c-1")).toEqual({ kind: "chat", chatId: "c-1" });
    expect(parseCommand("status c-1")).toEqual({ kind: "chat", chatId: "c-1" });
  });

  it("strips a Teams @-mention before matching, so mentioning the bot still works", () => {
    expect(parseCommand("<at>Traycer Remote</at> fleet").kind).toBe("fleet");
    expect(parseCommand("<at>Traycer Remote</at> epic e-9")).toEqual({
      kind: "bind_epic",
      epicId: "e-9",
    });
  });

  it("treats empty, help, and unrecognised input as help rather than failing silently", () => {
    expect(parseCommand("").kind).toBe("help");
    expect(parseCommand("   ").kind).toBe("help");
    expect(parseCommand("help").kind).toBe("help");
    expect(parseCommand("do something weird").kind).toBe("help");
  });

  it("does not treat a bare 'epic' with no id as a binding", () => {
    expect(parseCommand("epic").kind).not.toBe("bind_epic");
  });
});

describe("read-surface/commands — usage errors are distinct from help", () => {
  it("bare 'epic' returns a usage error, not help — the user read help as 'no such command'", () => {
    const c = parseCommand("epic");
    expect(c.kind).toBe("usage");
    if (c.kind !== "usage") return;
    expect(c.usage).toContain("epic <id>");
  });

  it("bare 'chat' and 'status' also return usage, naming where to get ids", () => {
    for (const word of ["chat", "status"]) {
      const c = parseCommand(word);
      expect(c.kind, word).toBe("usage");
      if (c.kind !== "usage") continue;
      expect(c.usage).toContain("fleet");
    }
  });

  it("still returns help for genuinely unknown input", () => {
    expect(parseCommand("wat").kind).toBe("help");
  });
});

describe("read-surface/commands — the typed send path is always explicit", () => {
  it("CONTRACT: unrecognised text is NEVER a message to an agent", () => {
    // The load-bearing safety property. If bare text meant "send", every
    // mistyped command would be delivered to a running agent and could not
    // be unsent. Typos must land on help, which does nothing.
    for (const typo of ["flet", "chta", "staus", "do something weird", "hi"]) {
      expect(parseCommand(typo).kind, typo).toBe("help");
    }
  });

  it("parses 'say <chatId> <text>' and keeps the message intact", () => {
    const c = parseCommand("say c-1 please rerun the failing test");
    expect(c).toEqual({
      kind: "say",
      chatId: "c-1",
      text: "please rerun the failing test",
    });
  });

  it("preserves the message's own capitalisation and punctuation", () => {
    // Matching on the lowercased copy would silently destroy the message.
    const c = parseCommand("say c-1 Use Foo.bar() NOT foo.Bar()");
    expect(c.kind).toBe("say");
    if (c.kind !== "say") return;
    expect(c.text).toBe("Use Foo.bar() NOT foo.Bar()");
  });

  it("accepts 'reply' and 'send' as the same command", () => {
    for (const word of ["say", "reply", "send"]) {
      const c = parseCommand(`${word} c-1 hello`);
      expect(c.kind, word).toBe("say");
    }
  });

  it("'say <chatId>' with no message opens the composer, it does not error", () => {
    expect(parseCommand("say c-1")).toEqual({ kind: "compose", chatId: "c-1" });
  });

  it("bare 'say' is a usage error naming the chat id, not help", () => {
    const c = parseCommand("say");
    expect(c.kind).toBe("usage");
    if (c.kind !== "usage") return;
    expect(c.usage).toContain("<chat-id>");
  });

  it("a message that looks like another command is still a message", () => {
    // "say c-1 fleet" must send the word "fleet", not list the fleet.
    const c = parseCommand("say c-1 fleet");
    expect(c.kind).toBe("say");
    if (c.kind !== "say") return;
    expect(c.text).toBe("fleet");
  });
});
