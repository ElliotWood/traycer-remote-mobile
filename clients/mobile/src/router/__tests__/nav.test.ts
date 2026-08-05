/**
 * S5 (C, P1): `goto-chat` must always land on a clean [fleet, epic, chat]
 * stack — never duplicate an epic/chat frame the user was already inside.
 */
import { describe, expect, it } from "vitest";
import { INITIAL_NAV_STACK, navReducer } from "../nav";

describe("navReducer — goto-chat", () => {
  it("goes straight to [fleet, epic, chat] from the fleet root", () => {
    const next = navReducer(INITIAL_NAV_STACK, {
      type: "goto-chat",
      epicId: "e1",
      chatId: "c1",
    });
    expect(next).toEqual([
      { name: "fleet" },
      { name: "epic", epicId: "e1", epicTitle: null },
      { name: "chat", epicId: "e1", chatId: "c1", chatTitle: null },
    ]);
  });

  it("replaces a deep stack rather than pushing onto it (no duplicate epic frame)", () => {
    const deep = navReducer(
      navReducer(INITIAL_NAV_STACK, { type: "open-epic", epicId: "e1", epicTitle: "Epic 1" }),
      { type: "open-chat", epicId: "e1", chatId: "c-old", chatTitle: "Old chat" },
    );
    const next = navReducer(deep, {
      type: "goto-chat",
      epicId: "e1",
      chatId: "c1",
    });
    expect(next).toEqual([
      { name: "fleet" },
      { name: "epic", epicId: "e1", epicTitle: null },
      { name: "chat", epicId: "e1", chatId: "c1", chatTitle: null },
    ]);
  });

  it("switches epics cleanly even when already deep in a different epic", () => {
    const deep = navReducer(
      navReducer(INITIAL_NAV_STACK, { type: "open-epic", epicId: "other-epic", epicTitle: "Other Epic" }),
      { type: "open-chat", epicId: "other-epic", chatId: "other-chat", chatTitle: "Other chat" },
    );
    const next = navReducer(deep, {
      type: "goto-chat",
      epicId: "e2",
      chatId: "c2",
    });
    expect(next).toEqual([
      { name: "fleet" },
      { name: "epic", epicId: "e2", epicTitle: null },
      { name: "chat", epicId: "e2", chatId: "c2", chatTitle: null },
    ]);
  });
});
