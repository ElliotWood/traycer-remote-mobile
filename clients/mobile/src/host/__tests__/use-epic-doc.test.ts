/**
 * Y.Doc contract test for `readChatsFromEpicDoc` (T5).
 *
 * Proves the minimal chats reader against a REAL Yjs doc built to the shape
 * gui-app persists (`epic → chats` Y.Map keyed by chatId, each entry a Y.Map
 * with a `title` field). No React, no stream — pure projection.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildArtifactTree,
  readArtifactsFromEpicDoc,
  readChatsFromEpicDoc,
  type EpicArtifactEntry,
} from "../use-epic-doc";

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

/** Builds an artifact entry Y.Map, attaching it to `artifacts[id]` before populating. */
function addArtifact(
  artifacts: Y.Map<unknown>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const entry = new Y.Map<unknown>();
  artifacts.set(id, entry);
  for (const [key, value] of Object.entries(fields)) {
    entry.set(key, value);
  }
}

function docWithArtifacts(build: (artifacts: Y.Map<unknown>) => void): Y.Doc {
  const doc = new Y.Doc();
  const artifacts = new Y.Map<unknown>();
  doc.getMap("epic").set("artifacts", artifacts);
  build(artifacts);
  return doc;
}

function byArtifactId(entries: readonly EpicArtifactEntry[]) {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

describe("readArtifactsFromEpicDoc", () => {
  it("lists every artifact with its full projected shape", () => {
    const doc = docWithArtifacts((artifacts) => {
      addArtifact(artifacts, "a1", {
        kind: "spec",
        title: "Design",
        parentId: null,
        artifactRoomId: "room-1",
        createdAt: 1,
        updatedAt: 2,
      });
      addArtifact(artifacts, "a2", {
        kind: "ticket",
        title: "Fix bug",
        parentId: "a1",
        artifactRoomId: "room-2",
        status: 1,
        createdAt: 3,
        updatedAt: 4,
      });
    });

    expect(byArtifactId(readArtifactsFromEpicDoc(doc))).toEqual([
      {
        id: "a1",
        kind: "spec",
        title: "Design",
        parentId: null,
        artifactRoomId: "room-1",
        status: null,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "a2",
        kind: "ticket",
        title: "Fix bug",
        parentId: "a1",
        artifactRoomId: "room-2",
        status: 1,
        createdAt: 3,
        updatedAt: 4,
      },
    ]);
  });

  it("never carries a status for spec/review even when the field is present", () => {
    const doc = docWithArtifacts((artifacts) => {
      // A stray `status` field on a spec (shouldn't exist per the schema, but
      // the reader must not surface it if it somehow does).
      addArtifact(artifacts, "a1", { kind: "spec", title: "S", status: 2 });
      addArtifact(artifacts, "a2", { kind: "review", title: "R", status: 1 });
    });

    const byId = Object.fromEntries(
      readArtifactsFromEpicDoc(doc).map((a) => [a.id, a]),
    );
    expect(byId.a1.status).toBeNull();
    expect(byId.a2.status).toBeNull();
  });

  it("skips an entry with an unrecognized kind, and a malformed non-Y.Map entry", () => {
    const doc = docWithArtifacts((artifacts) => {
      addArtifact(artifacts, "good", { kind: "story", title: "ok" });
      addArtifact(artifacts, "bad-kind", { kind: "chat", title: "nope" });
      artifacts.set("bad-shape", "not-a-map");
    });

    expect(readArtifactsFromEpicDoc(doc).map((a) => a.id)).toEqual(["good"]);
  });

  it("returns [] when the epic doc has no artifacts map", () => {
    const doc = new Y.Doc();
    expect(readArtifactsFromEpicDoc(doc)).toEqual([]);
  });

  it("falls back parentId to null and artifactRoomId to '' when absent/malformed", () => {
    const doc = docWithArtifacts((artifacts) => {
      addArtifact(artifacts, "a1", { kind: "spec", title: "S", parentId: 42 });
    });
    const [a1] = readArtifactsFromEpicDoc(doc);
    expect(a1.parentId).toBeNull();
    expect(a1.artifactRoomId).toBe("");
  });
});

function entry(overrides: Partial<EpicArtifactEntry> & { readonly id: string }): EpicArtifactEntry {
  return {
    kind: "spec",
    title: overrides.id,
    parentId: null,
    artifactRoomId: "",
    status: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("buildArtifactTree", () => {
  it("nests children under their parentId", () => {
    const tree = buildArtifactTree([
      entry({ id: "root", updatedAt: 1 }),
      entry({ id: "child", kind: "ticket", parentId: "root", updatedAt: 2 }),
    ]);
    expect(tree.roots).toEqual(["root"]);
    expect(tree.childrenByParent.root).toEqual(["child"]);
    expect(tree.byId.child.parentId).toBe("root");
  });

  it("promotes a child with an unknown parentId to root (orphan promotion)", () => {
    const tree = buildArtifactTree([
      entry({ id: "orphan", parentId: "does-not-exist", updatedAt: 1 }),
    ]);
    expect(tree.roots).toEqual(["orphan"]);
    expect(tree.childrenByParent["does-not-exist"]).toBeUndefined();
  });

  it("orders roots and siblings by updatedAt DESC, id ASC tie-break", () => {
    const tree = buildArtifactTree([
      entry({ id: "old", updatedAt: 1 }),
      entry({ id: "new", updatedAt: 3 }),
      entry({ id: "mid", updatedAt: 2 }),
      entry({ id: "tie-b", updatedAt: 5 }),
      entry({ id: "tie-a", updatedAt: 5 }),
    ]);
    expect(tree.roots).toEqual(["tie-a", "tie-b", "new", "mid", "old"]);
  });

  it("sorts children independently of siblings at other depths", () => {
    const tree = buildArtifactTree([
      entry({ id: "root", updatedAt: 1 }),
      entry({ id: "c-old", parentId: "root", updatedAt: 1 }),
      entry({ id: "c-new", parentId: "root", updatedAt: 2 }),
    ]);
    expect(tree.childrenByParent.root).toEqual(["c-new", "c-old"]);
  });
});
