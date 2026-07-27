// @vitest-environment jsdom
/**
 * S5 (C) end-to-end: the F1 fix at the view level, not just the pure
 * `detectBlockedTransitions` unit tests. Grants Notification permission and
 * mocks the SW registration, then proves for BOTH `ChatView` and `EpicView`:
 *   - opening/observing an already-blocked chat fires ZERO notifications;
 *   - a later real false→true transition fires exactly one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { ChatSubscribeServerFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import type { SnapshotMetaEpic } from "@traycer/protocol/host/epic/snapshot-meta";
import { ChatView } from "@/views/chat-view";
import { EpicView } from "@/views/epic-view";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import {
  createFakeStreamConnection,
  type FakeChatSession,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, render, waitFor } from "@/test-utils/dom";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;
const EPIC_META = {} as unknown as SnapshotMetaEpic;

function snapshotFrame(approvals: readonly unknown[]): SnapshotFrame {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "running",
      chat: { title: "Fix bug", messages: [] },
      access: { role: "owner", ownerUserId: "u1" },
      pendingApprovals: approvals,
      pendingFileEditApprovals: [],
      pendingInterviews: [],
    },
  } as unknown as SnapshotFrame;
}

const toolApproval = (approvalId: string): unknown => ({
  approvalId,
  toolName: "Bash",
  description: "Run a command",
  input: null,
  requestedAt: 0,
  kind: "tool",
});

let showNotification: ReturnType<typeof vi.fn>;
const originalNotification = (globalThis as { Notification?: unknown }).Notification;
const originalNavigator = globalThis.navigator;

function mockGrantedNotifications(): void {
  showNotification = vi.fn().mockResolvedValue(undefined);
  (globalThis as { Notification?: unknown }).Notification = { permission: "granted" };
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
    configurable: true,
  });
}

afterEach(() => {
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

describe("ChatView — blocked-transition notification (F1)", () => {
  it("does not notify on an already-blocked chat's first snapshot, but does on a later transition", async () => {
    mockGrantedNotifications();
    const fake = createFakeStreamConnection();
    render(
      <StreamConnectionProvider connection={fake.connection}>
        <ChatView epicId="e1" chatId="c1" onBack={() => {}} />
      </StreamConnectionProvider>,
    );
    const session = fake.chatSessions[0];

    // First snapshot arrives already blocked (F1: must NOT fire).
    await act(async () => {
      session.callbacks.onSnapshot(snapshotFrame([toolApproval("a1")]));
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(showNotification).not.toHaveBeenCalled();

    // Unblock, then re-block — a REAL transition, must fire exactly once.
    await act(async () => {
      session.callbacks.onSnapshot(snapshotFrame([]));
    });
    await act(async () => {
      session.callbacks.onSnapshot(snapshotFrame([toolApproval("a2")]));
    });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
    expect(showNotification.mock.calls[0][0]).toBe("Fix bug");
  });
});

describe("EpicView — blocked-transition notification (F1)", () => {
  function epicUpdateWithOneChat(chatId: string, title: string): Uint8Array {
    const doc = new Y.Doc();
    const map = new Y.Map<unknown>();
    doc.getMap("epic").set("chats", map);
    const entry = new Y.Map<unknown>();
    map.set(chatId, entry);
    entry.set("title", title);
    return Y.encodeStateAsUpdate(doc);
  }

  function chatSessionFor(fake: FakeStreamConnection, chatId: string): FakeChatSession {
    const session = fake.chatSessions.find((s) => s.chatId === chatId);
    if (session === undefined) throw new Error(`no chat session for ${chatId}`);
    return session;
  }

  it("does not notify for a chat already blocked when the epic is opened, but does on a later transition", async () => {
    mockGrantedNotifications();
    const fake = createFakeStreamConnection();
    render(
      <StreamConnectionProvider connection={fake.connection}>
        <EpicView epicId="e1" epicTitle="Epic 1" onOpenChat={() => {}} onBack={() => {}} />
      </StreamConnectionProvider>,
    );

    const epicSession = fake.epicSessions[0];
    await act(async () => {
      epicSession.callbacks.onSnapshot(EPIC_META, epicUpdateWithOneChat("c1", "Fix bug"));
    });

    await waitFor(() => {
      expect(fake.chatSessions.length).toBeGreaterThan(0);
    });
    const badgeSession = chatSessionFor(fake, "c1");

    // First badge snapshot is already blocked — must NOT fire.
    await act(async () => {
      badgeSession.callbacks.onSnapshot(snapshotFrame([toolApproval("a1")]));
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(showNotification).not.toHaveBeenCalled();

    // Unblock, then re-block — fires exactly once.
    await act(async () => {
      badgeSession.callbacks.onSnapshot(snapshotFrame([]));
    });
    await act(async () => {
      badgeSession.callbacks.onSnapshot(snapshotFrame([toolApproval("a2")]));
    });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
  });
});
