// @vitest-environment jsdom
/**
 * P0 caching, layer C (chat transcript): `use-chat.ts` has no client Y.Doc
 * (confirmed against `chat-stream-client.ts` — snapshots decode straight to
 * JSON), so the cache is the reducer's own cache-relevant slice, seeded
 * synchronously via `useReducer`'s lazy initializer. See the caching
 * contract, Layer C.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@/test-utils/dom";
import { createFakeStreamConnection } from "@/test-utils/fakes";
import { useChat, chatCacheStorageKey, readCachedChatState } from "@/host/use-chat";
import { CACHE_SCHEMA_VERSION } from "@/host/cache-config";

function userMessage(messageId: string, text: string) {
  return {
    role: "user",
    messageId,
    sender: { type: "user", userId: "u1" },
    message: {
      kind: "user",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    },
    timestamp: 0,
    sessionAnchor: null,
  };
}

function snapshotFrame(overrides: {
  readonly title?: string;
  readonly messages?: readonly unknown[];
  readonly runStatus?: "idle" | "running" | "stopping";
  readonly pendingApprovals?: readonly unknown[];
}) {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: overrides.runStatus ?? "idle",
      chat: { title: overrides.title ?? "Chat", messages: overrides.messages ?? [], settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: overrides.pendingApprovals ?? [],
      pendingFileEditApprovals: [],
      pendingInterviews: [],
      accumulatedFileChanges: [],
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  } as unknown as never;
}

describe("chatCacheStorageKey / readCachedChatState (pure)", () => {
  it("round-trips a written cache", () => {
    const key = chatCacheStorageKey("e1", "c1");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        title: "Alpha",
        messages: [],
        runStatus: "idle",
        pendingApprovals: [],
        pendingFileEditApprovals: [],
        pendingInterviews: [],
      }),
    );
    expect(readCachedChatState("e1", "c1")?.title).toBe("Alpha");
  });

  it("returns null for a missing key or corrupt JSON — never throws", () => {
    expect(readCachedChatState("never-written", "c1")).toBeNull();
    window.localStorage.setItem(chatCacheStorageKey("e1", "bad"), "{not json");
    expect(readCachedChatState("e1", "bad")).toBeNull();
  });

  it("a cache written under a different schema version is invisible to the current reader", () => {
    window.localStorage.setItem(
      `chat-cache:v${CACHE_SCHEMA_VERSION}-stale:e1:c1`,
      JSON.stringify({ title: "Stale", messages: [], runStatus: "idle", pendingApprovals: [], pendingFileEditApprovals: [], pendingInterviews: [] }),
    );
    expect(readCachedChatState("e1", "c1")).toBeNull();
  });
});

describe("useChat — zero-flash seed from cache", () => {
  it("title/transcriptMessages/runStatus reflect the cached values on the FIRST render, hasSnapshot stays false", () => {
    window.localStorage.setItem(
      chatCacheStorageKey("e1", "c1"),
      JSON.stringify({
        title: "Cached title",
        messages: [{ role: "user", messageId: "u1", sender: { type: "user", userId: "u1" }, message: { kind: "user", content: { type: "doc", content: [] } }, timestamp: 0, sessionAnchor: null }],
        runStatus: "running",
        pendingApprovals: [{ approvalId: "a1" }],
        pendingFileEditApprovals: [],
        pendingInterviews: [],
      }),
    );

    const fake = createFakeStreamConnection();
    // Never dispatch onSnapshot — proves the seed alone (not a fast live
    // response) produces this first-render content.
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    expect(result.current.title).toBe("Cached title");
    expect(result.current.transcriptMessages.map((m) => m.messageId)).toEqual(["u1"]);
    expect(result.current.runStatus).toBe("running");
    expect(result.current.pendingApprovals).toEqual([{ approvalId: "a1" }]);
    expect(result.current.hasSnapshot).toBe(false);
  });

  it("write-through: a real onSnapshot persists the capped, cache-relevant slice only", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    act(() => {
      fake.chatSessions[0].callbacks.onSnapshot(
        snapshotFrame({ title: "Live title", messages: [userMessage("u1", "hi")], runStatus: "idle" }),
      );
    });

    expect(result.current.hasSnapshot).toBe(true);
    const cached = readCachedChatState("e1", "c1");
    expect(cached?.title).toBe("Live title");
    expect(cached?.messages.map((m) => m.messageId)).toEqual(["u1"]);
  });

  it("never persists trailingMessages/liveTurn/replies/ackIndex — only the reducer's cache-relevant slice", () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    act(() => {
      fake.chatSessions[0].callbacks.onSnapshot(snapshotFrame({ messages: [userMessage("u1", "hi")] }));
    });
    act(() => {
      // A trailing message (accepted since the snapshot) and a live block —
      // both session-only, neither should survive into the persisted cache.
      fake.chatSessions[0].callbacks.onMessageAccepted({ message: userMessage("u2", "trailing") } as never);
    });

    const rawKey = chatCacheStorageKey("e1", "c1");
    const raw = window.localStorage.getItem(rawKey);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ["messages", "pendingApprovals", "pendingFileEditApprovals", "pendingInterviews", "runStatus", "title"].sort(),
    );
    // The trailing message IS included (it's part of the rendered transcript
    // — see `serializeChatCache`'s doc comment), just not any of the
    // session-only fields (liveTurn/replies/ackIndex) themselves.
    expect((parsed.messages as readonly { messageId: string }[]).map((m) => m.messageId)).toEqual([
      "u1",
      "u2",
    ]);
    expect(result.current.transcriptMessages.map((m) => m.messageId)).toEqual(["u1", "u2"]);
  });

  it("stale pending items don't resurrect a stuck reply status: a fresh cache with no matching reply key has replyStatusFor return undefined", () => {
    window.localStorage.setItem(
      chatCacheStorageKey("e1", "c1"),
      JSON.stringify({
        title: "Chat",
        messages: [],
        runStatus: "idle",
        pendingApprovals: [{ approvalId: "a1" }],
        pendingFileEditApprovals: [],
        pendingInterviews: [],
      }),
    );

    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    expect(result.current.pendingApprovals).toEqual([{ approvalId: "a1" }]);
    // No `replies` field exists in the persisted cache at all (by design —
    // see the excluded-fields list above), so a cache-seeded pending item
    // never shows as "submitting" from a previous session.
    expect(result.current.replyStatusFor("approval:a1")).toBeUndefined();
  });

  it("caps persisted messages to the most recent 50, dropping the oldest", () => {
    const many = Array.from({ length: 200 }, (_, i) => userMessage(`u${i}`, `msg ${i}`));
    const fake = createFakeStreamConnection();
    renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    act(() => {
      fake.chatSessions[0].callbacks.onSnapshot(snapshotFrame({ messages: many }));
    });

    const cached = readCachedChatState("e1", "c1");
    expect(cached?.messages).toHaveLength(50);
    expect(cached?.messages.map((m) => m.messageId)).toEqual(
      many.slice(150).map((m) => m.messageId),
    );
  });
});

describe("useChat — S1 write-throttling", () => {
  it("a repeat onTurnStateChanged that doesn't change the persisted slice does not re-write localStorage", () => {
    const fake = createFakeStreamConnection();
    renderHook(() => useChat(fake.connection, "e1", "c1", "u1"));

    act(() => {
      fake.chatSessions[0].callbacks.onSnapshot(snapshotFrame({ messages: [userMessage("u1", "hi")], runStatus: "idle" }));
    });

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockClear();

    act(() => {
      // Same runStatus as the snapshot above — the persisted slice is
      // byte-identical, so the change-compare in the write-through effect
      // should skip the write entirely.
      fake.chatSessions[0].callbacks.onTurnStateChanged({ runStatus: "idle" } as never);
    });

    const chatCacheWrites = setItemSpy.mock.calls.filter(([key]) => key === chatCacheStorageKey("e1", "c1"));
    expect(chatCacheWrites).toHaveLength(0);

    setItemSpy.mockRestore();
  });
});
