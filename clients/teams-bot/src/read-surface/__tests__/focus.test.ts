import { describe, expect, it } from "vitest";
import {
  routeWhileFocused,
  RESERVED_WHILE_FOCUSED,
  FOCUS_EXIT_WORDS,
  type FocusRouting,
} from "../focus-routing";
import {
  InMemoryFocusedChatStore,
  FOCUS_IDLE_MS,
  type FocusedChat,
} from "../focused-chat-store";

/**
 * The two pieces that can misdirect a message, tested without a turn.
 *
 * Everything else in this feature is presentation. These two decide whether
 * a sentence someone typed reaches a running agent, and a message to an agent
 * cannot be unsent.
 */

describe("focus routing — commands win, and the asymmetry is why", () => {
  const focused = (text: string): FocusRouting =>
    routeWhileFocused({ text, hasAttachments: false });

  it("ordinary prose goes to the agent — the feature working", () => {
    const routing = focused("can you rerun the gap audit against release/4.2?");
    expect(routing.kind).toBe("send");
    expect(routing).toMatchObject({
      text: "can you rerun the gap audit against release/4.2?",
    });
  });

  it("CONTRACT: every reserved word keeps its command meaning", () => {
    // Table-driven over the exported list rather than a hand-picked few, so a
    // word added to the list without thinking is still covered here.
    for (const word of RESERVED_WHILE_FOCUSED) {
      const routing = focused(word);
      expect(
        routing.kind === "command" || routing.kind === "exit",
        `"${word}" was routed as ${routing.kind}`,
      ).toBe(true);
    }
  });

  it("CONTRACT: an intercepted command NAMES itself, so the rule is visible", () => {
    // The cost of "commands win" is a message that does not arrive. That is
    // only acceptable because the user is told — see `focusInterceptedText`.
    // An intercept that reported no word could not be explained.
    const routing = focused("fleet");
    expect(routing).toEqual({ kind: "command", intercepted: "fleet" });
  });

  it("`send` forces the rest of the line through, reserved word or not", () => {
    expect(focused("send fleet")).toEqual({ kind: "send", text: "fleet" });
    expect(focused("send done")).toEqual({ kind: "send", text: "done" });
  });

  it("`send` ALONE is the word, not an escape with nothing after it", () => {
    // An escape that swallowed a bare "send" would silently drop a message
    // someone meant to send — the exact failure direction this design is
    // built to avoid.
    expect(focused("send")).toEqual({ kind: "send", text: "send" });
  });

  it("a reserved word is only reserved as the FIRST word", () => {
    // "the fleet is idle" is prose about a fleet, not the fleet command.
    // Matching anywhere in the line would make ordinary sentences unsendable.
    expect(focused("the fleet is idle").kind).toBe("send");
    expect(focused("please stop the deploy").kind).toBe("send");
  });

  it("matching is case-insensitive — 'Done' ends focus like 'done'", () => {
    for (const word of FOCUS_EXIT_WORDS) {
      expect(focused(word.toUpperCase()).kind).toBe("exit");
    }
  });

  it("CONTRACT: an attachment never becomes a message", () => {
    // Nothing in the send path carries bytes, so a document routed as a
    // message would deliver the caption and silently drop the file.
    const routing = routeWhileFocused({
      text: "here's the RFI",
      hasAttachments: true,
    });
    expect(routing.kind).toBe("command");
  });

  it("CONTRACT: an empty or whitespace message is never sent", () => {
    // `Action.Submit` and stray whitespace both produce these, and an empty
    // send reaches a blocked agent's queue.
    for (const text of ["", "   ", "\n\n", "\t "]) {
      expect(focused(text).kind, JSON.stringify(text)).toBe("command");
    }
  });

  it("CONTROL: the reserved list is not so broad that nothing sends", () => {
    // A list that grew to cover common English would make the feature
    // useless while every test above still passed.
    const ordinary = [
      "yes",
      "looks good",
      "no, use the other branch",
      "what did you find?",
      "ship it",
    ];
    for (const text of ordinary) {
      expect(focused(text).kind, text).toBe("send");
    }
  });
});

describe("focused-chat store — expiry cannot be skipped by a caller", () => {
  const chat = (touchedAt: number): FocusedChat => ({
    chatId: "c-1",
    title: "Migrate config loader to zod",
    touchedAt,
  });

  it("returns the chat while fresh", async () => {
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(1_000));
    const found = await store.get("conv-1", 1_000 + FOCUS_IDLE_MS - 1);
    expect(found).toEqual({ kind: "focused", chat: chat(1_000) });
  });

  it("CONTRACT: an expired focus is never returned as focused", async () => {
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(1_000));
    const found = await store.get("conv-1", 1_000 + FOCUS_IDLE_MS);
    expect(found.kind).toBe("expired");
  });

  it("CONTRACT: the expired branch carries NO chatId to route to", async () => {
    // The whole point of the three-way return. A caller holding a chatId from
    // an expired focus could send to it, which is the failure expiry exists
    // to prevent — so the type does not offer one.
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(1_000));
    const found = await store.get("conv-1", 1_000 + FOCUS_IDLE_MS);
    expect(found).toEqual({
      kind: "expired",
      title: "Migrate config loader to zod",
    });
    expect(Object.keys(found)).not.toContain("chat");
    expect(JSON.stringify(found)).not.toContain("c-1");
  });

  it("expiry is destructive — a later clock cannot resurrect it", async () => {
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(1_000));
    await store.get("conv-1", 1_000 + FOCUS_IDLE_MS);
    // Asking again at a time that WOULD have been fresh must still be gone:
    // the user has already been told the focus ended.
    expect((await store.get("conv-1", 1_500)).kind).toBe("none");
  });

  it("a backwards clock reads as fresh, not as expired", async () => {
    // Expiring on a clock jump would drop focus mid-conversation for a reason
    // nobody could see. `now - touchedAt` is negative, which is < the limit.
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(10_000));
    expect((await store.get("conv-1", 5_000)).kind).toBe("focused");
  });

  it("distinguishes never-focused from expired", async () => {
    const store = new InMemoryFocusedChatStore();
    expect((await store.get("nobody", 0)).kind).toBe("none");
  });

  it("clear removes it", async () => {
    const store = new InMemoryFocusedChatStore();
    await store.set("conv-1", chat(0));
    await store.clear("conv-1");
    expect((await store.get("conv-1", 0)).kind).toBe("none");
  });

  it("CONTROL: the freshness check can fail in both directions", async () => {
    // Without this, a store that returned `focused` unconditionally would
    // pass the fresh test, and one that returned `expired` unconditionally
    // would pass the expiry test.
    const store = new InMemoryFocusedChatStore();
    await store.set("a", chat(0));
    await store.set("b", chat(0));
    expect((await store.get("a", FOCUS_IDLE_MS - 1)).kind).toBe("focused");
    expect((await store.get("b", FOCUS_IDLE_MS)).kind).toBe("expired");
  });
});
