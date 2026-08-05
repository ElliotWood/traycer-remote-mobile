import { describe, expect, it } from "vitest";
import {
  getLastSeenAt,
  isUnread,
  markSeen,
  seedUnseen,
  type StorageLike,
} from "../read-tracking-store";

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("read-tracking-store", () => {
  it("getLastSeenAt returns null for a node never recorded", () => {
    const storage = memoryStorage();
    expect(getLastSeenAt("epic-1", "chat-1", storage)).toBeNull();
  });

  it("seedUnseen fixes each never-seen node's mark to ITS OWN updatedAt, not now", () => {
    const storage = memoryStorage();
    seedUnseen("epic-1", { "chat-1": 1000, "chat-2": 2000 }, storage);
    expect(getLastSeenAt("epic-1", "chat-1", storage)).toBe(1000);
    expect(getLastSeenAt("epic-1", "chat-2", storage)).toBe(2000);
  });

  it("a freshly-seeded tree reads nothing as unread (tighten #1: no false 'everything unread' on first load)", () => {
    const storage = memoryStorage();
    const updatedAtById = { "chat-1": 1000, "chat-2": 2000 };
    seedUnseen("epic-1", updatedAtById, storage);
    for (const [nodeId, updatedAt] of Object.entries(updatedAtById)) {
      expect(isUnread("epic-1", nodeId, updatedAt, storage)).toBe(false);
    }
  });

  it("only activity AFTER the seed reads as unread", () => {
    const storage = memoryStorage();
    seedUnseen("epic-1", { "chat-1": 1000 }, storage);
    expect(isUnread("epic-1", "chat-1", 1000, storage)).toBe(false);
    expect(isUnread("epic-1", "chat-1", 1500, storage)).toBe(true);
  });

  it("seedUnseen does not overwrite an already-seeded node's mark", () => {
    const storage = memoryStorage();
    seedUnseen("epic-1", { "chat-1": 1000 }, storage);
    seedUnseen("epic-1", { "chat-1": 9999 }, storage);
    expect(getLastSeenAt("epic-1", "chat-1", storage)).toBe(1000);
  });

  it("markSeen clears unread for activity up to and including the mark", () => {
    const storage = memoryStorage();
    seedUnseen("epic-1", { "chat-1": 1000 }, storage);
    markSeen("epic-1", "chat-1", 2000, storage);
    expect(isUnread("epic-1", "chat-1", 2000, storage)).toBe(false);
    expect(isUnread("epic-1", "chat-1", 2001, storage)).toBe(true);
  });

  it("a node with no mark at all reads as NOT unread (never seeded, not yet a false positive)", () => {
    const storage = memoryStorage();
    expect(isUnread("epic-1", "never-seeded", 999999, storage)).toBe(false);
  });

  it("keys are scoped per epic — the same nodeId in a different epic is independent", () => {
    const storage = memoryStorage();
    seedUnseen("epic-1", { "chat-1": 1000 }, storage);
    expect(getLastSeenAt("epic-2", "chat-1", storage)).toBeNull();
  });

  it("ignores a corrupted stored value rather than throwing", () => {
    const storage = memoryStorage();
    storage.setItem("traycer.mobile.lastSeen.epic-1.chat-1", "not-a-number");
    expect(getLastSeenAt("epic-1", "chat-1", storage)).toBeNull();
  });
});
