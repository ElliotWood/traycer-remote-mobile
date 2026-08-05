// @vitest-environment jsdom
/**
 * S5 (A): wiring-level coverage for `useEpicDoc`'s liveness-recovery — a real
 * `window` focus event forces a reconnect, a "reconnecting" status transition
 * does NOT clear the already-rendered chat list (M1a: no destructive
 * flicker), and repeated mount/unmount cycles never accumulate listeners.
 */
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { renderHook, waitFor } from "@/test-utils/dom";
import { useEpicDoc } from "../use-epic-doc";
import { createFakeStreamConnection } from "@/test-utils/fakes";

function epicUpdateWithOneChat(chatId: string, title: string): Uint8Array {
  const doc = new Y.Doc();
  const map = new Y.Map<unknown>();
  doc.getMap("epic").set("chats", map);
  const entry = new Y.Map<unknown>();
  map.set(chatId, entry);
  entry.set("title", title);
  return Y.encodeStateAsUpdate(doc);
}

describe("useEpicDoc — liveness recovery wiring", () => {
  it("forces a reconnect on a real window focus event", () => {
    const fake = createFakeStreamConnection();
    renderHook(() => useEpicDoc(fake.connection, "epic-1"));

    window.dispatchEvent(new Event("focus"));

    expect(fake.reconnectAll).toHaveBeenCalledWith("window-focus");
  });

  it("keeps the chat list rendered through a reconnecting transition (no destructive flicker)", async () => {
    const fake = createFakeStreamConnection();
    const { result } = renderHook(() => useEpicDoc(fake.connection, "epic-1"));

    const session = fake.epicSessions[0];
    session.callbacks.onSnapshot(
      {} as never,
      epicUpdateWithOneChat("c1", "Alpha"),
    );

    await waitFor(() => {
      expect(result.current.chats).toHaveLength(1);
    });

    // Simulate the transport dropping to "reconnecting" — status-only, no new
    // frame. The already-decoded chat list must NOT be cleared.
    session.connection.applyStatus("reconnecting", null);

    expect(result.current.chats).toHaveLength(1);
    expect(result.current.chats[0]?.title).toBe("Alpha");
  });

  it("does not accumulate window listeners across repeated mount/unmount cycles", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const fake = createFakeStreamConnection();

    for (let i = 0; i < 5; i += 1) {
      const { unmount } = renderHook(() => useEpicDoc(fake.connection, "epic-1"));
      unmount();
    }

    const focusAdds = addSpy.mock.calls.filter(([type]) => type === "focus").length;
    const focusRemoves = removeSpy.mock.calls.filter(([type]) => type === "focus").length;
    expect(focusAdds).toBe(5);
    expect(focusRemoves).toBe(5);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
