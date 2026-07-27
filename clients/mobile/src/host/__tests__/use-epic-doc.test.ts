/**
 * Y.Doc contract test for `readChatsFromEpicDoc` (T5).
 *
 * Proves the minimal chats reader against a REAL Yjs doc built to the shape
 * gui-app persists (`epic → chats` Y.Map keyed by chatId, each entry a Y.Map
 * with a `title` field). No React, no stream — pure projection.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readChatsFromEpicDoc } from "../use-epic-doc";

/** Builds a chat entry Y.Map, attaching it to `chats[chatId]` before populating. */
function addChat(
  chats: Y.Map<unknown>,
  chatId: string,
  fields: Record<string, unknown>,
): void {
  const entry = new Y.Map<unknown>();
  chats.set(chatId, entry);
  for (const [key, value] of Object.entries(fields)) {
    entry.set(key, value);
  }
}

function docWithChats(
  build: (chats: Y.Map<unknown>) => void,
): Y.Doc {
  const doc = new Y.Doc();
  const chats = new Y.Map<unknown>();
  doc.getMap("epic").set("chats", chats);
  build(chats);
  return doc;
}

function byId(entries: readonly { chatId: string; title: string }[]) {
  return [...entries].sort((a, b) => a.chatId.localeCompare(b.chatId));
}

describe("readChatsFromEpicDoc", () => {
  it("lists every chat as { chatId (= map key), title }", () => {
    const doc = docWithChats((chats) => {
      addChat(chats, "c1", { title: "Auth refactor", createdAt: 1 });
      addChat(chats, "c2", { title: "Fix flaky test", createdAt: 2 });
    });

    expect(byId(readChatsFromEpicDoc(doc))).toEqual([
      { chatId: "c1", title: "Auth refactor" },
      { chatId: "c2", title: "Fix flaky test" },
    ]);
  });

  it("projects a missing/non-string title to the empty string", () => {
    const doc = docWithChats((chats) => {
      addChat(chats, "c1", { createdAt: 1 }); // no title key
      addChat(chats, "c2", { title: 42 }); // non-string title
    });

    expect(byId(readChatsFromEpicDoc(doc))).toEqual([
      { chatId: "c1", title: "" },
      { chatId: "c2", title: "" },
    ]);
  });

  it("skips a malformed entry that is not a nested Y.Map", () => {
    const doc = docWithChats((chats) => {
      addChat(chats, "good", { title: "ok" });
      chats.set("bad", "not-a-map"); // stray primitive
    });

    expect(readChatsFromEpicDoc(doc)).toEqual([{ chatId: "good", title: "ok" }]);
  });

  it("returns [] when the epic doc has no chats map", () => {
    const doc = new Y.Doc();
    expect(readChatsFromEpicDoc(doc)).toEqual([]);

    // Also when `chats` exists but is the wrong type entirely.
    doc.getMap("epic").set("chats", "oops");
    expect(readChatsFromEpicDoc(doc)).toEqual([]);
  });

  it("reads the same list after the doc is rebuilt from a snapshot update", () => {
    // Mirrors the real stream path: the source doc is encoded to an update and
    // applied into a fresh doc (what `useEpicDoc`'s onSnapshot does).
    const source = docWithChats((chats) => {
      addChat(chats, "c1", { title: "Alpha" });
      addChat(chats, "c2", { title: "Beta" });
    });
    const update = Y.encodeStateAsUpdate(source);

    const replica = new Y.Doc();
    Y.applyUpdate(replica, update);

    expect(byId(readChatsFromEpicDoc(replica))).toEqual([
      { chatId: "c1", title: "Alpha" },
      { chatId: "c2", title: "Beta" },
    ]);
  });
});
