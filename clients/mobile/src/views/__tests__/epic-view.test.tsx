// @vitest-environment jsdom
/**
 * Render test for the epic detail view (T5).
 *
 * Drives the FAKE stream layer (no socket): feed a decoded epic doc-update that
 * enumerates two chats, then per-chat snapshots — one blocked, one running.
 * Asserts the chats render, the blocked chat sorts to the top with its badge,
 * the epic connection state surfaces, and every stream (epic + both chats) is
 * closed on unmount.
 */
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import type { SnapshotMetaEpic } from "@traycer/protocol/host/epic/snapshot-meta";
import type { ChatSubscribeServerFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import { EpicView } from "@/views/epic-view";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import {
  createFakeStreamConnection,
  type FakeChatSession,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, render, screen, within } from "@/test-utils/dom";

const EPIC_META = {} as unknown as SnapshotMetaEpic;

/** Encodes a fresh epic doc carrying `chats` into the update bytes the stream delivers. */
function epicUpdateWithChats(
  chats: readonly { readonly chatId: string; readonly title: string }[],
): Uint8Array {
  const doc = new Y.Doc();
  const map = new Y.Map<unknown>();
  doc.getMap("epic").set("chats", map);
  for (const { chatId, title } of chats) {
    const entry = new Y.Map<unknown>();
    map.set(chatId, entry);
    entry.set("title", title);
  }
  return Y.encodeStateAsUpdate(doc);
}

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;

function chatSnapshot(opts: {
  readonly runStatus: "idle" | "running" | "stopping";
  readonly approvals?: readonly string[];
  readonly interviews?: readonly string[];
}): SnapshotFrame {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: opts.runStatus,
      pendingApprovals: (opts.approvals ?? []).map((approvalId) => ({
        approvalId,
      })),
      // Non-optional in `chatSnapshotSchema` (subscribe.ts:476); the badge
      // reducer reads it, so a realistic frame must carry it.
      pendingFileEditApprovals: [],
      pendingInterviews: (opts.interviews ?? []).map((blockId) => ({
        blockId,
      })),
    },
  } as unknown as SnapshotFrame;
}

function renderEpicView(
  fake: FakeStreamConnection,
  onOpenChat: (chatId: string) => void = () => {},
): { readonly unmount: () => void } {
  const result = render(
    <StreamConnectionProvider connection={fake.connection}>
      <EpicView epicId="e1" onOpenChat={onOpenChat} onBack={() => {}} />
    </StreamConnectionProvider>,
  );
  return { unmount: result.unmount };
}

function chatSessionFor(
  fake: FakeStreamConnection,
  chatId: string,
): FakeChatSession {
  const session = fake.chatSessions.find((s) => s.chatId === chatId);
  if (session === undefined) {
    throw new Error(`no chat session opened for ${chatId}`);
  }
  return session;
}

describe("EpicView", () => {
  it("renders chats, sorts the blocked one to the top with a badge, and shows connection state", async () => {
    const fake = createFakeStreamConnection();
    renderEpicView(fake);

    // 1) Epic stream delivers the chat enumeration + goes live.
    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(
        EPIC_META,
        epicUpdateWithChats([
          { chatId: "c1", title: "Running chat" },
          { chatId: "c2", title: "Blocked chat" },
        ]),
      );
      fake.epicSessions[0].connection.applyStatus("open", null);
    });

    expect(await screen.findByText("Running chat")).toBeTruthy();
    expect(screen.getByText("Blocked chat")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();

    // 2) Per-chat badge streams report: c2 is blocked (pending approval), c1 running.
    act(() => {
      chatSessionFor(fake, "c1").callbacks.onSnapshot(
        chatSnapshot({ runStatus: "running" }),
      );
      chatSessionFor(fake, "c2").callbacks.onSnapshot(
        chatSnapshot({ runStatus: "idle", approvals: ["a1"] }),
      );
    });

    // Blocked sorts to the top: the first row is the blocked chat with its badge.
    const rows = await screen.findAllByRole("button", { name: /chat/i });
    const chatRows = rows.filter((r) => /Running chat|Blocked chat/.test(r.textContent ?? ""));
    expect(within(chatRows[0]).getByText("Blocked chat")).toBeTruthy();
    expect(within(chatRows[0]).getByText("Blocked")).toBeTruthy();
    expect(within(chatRows[1]).getByText("Running chat")).toBeTruthy();
    expect(within(chatRows[1]).getByText("Running")).toBeTruthy();
  });

  it("navigates to the tapped chat", async () => {
    const fake = createFakeStreamConnection();
    const opened: string[] = [];
    renderEpicView(fake, (chatId) => opened.push(chatId));

    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(
        EPIC_META,
        epicUpdateWithChats([{ chatId: "c1", title: "Only chat" }]),
      );
    });

    await userEvent.setup().click(await screen.findByRole("button", { name: /Only chat/ }));
    expect(opened).toEqual(["c1"]);
  });

  it("tears down the epic stream and every per-chat stream on unmount", async () => {
    const fake = createFakeStreamConnection();
    const { unmount } = renderEpicView(fake);

    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(
        EPIC_META,
        epicUpdateWithChats([
          { chatId: "c1", title: "Alpha" },
          { chatId: "c2", title: "Beta" },
        ]),
      );
    });
    // Both per-chat streams must have opened before we can assert their teardown.
    await screen.findByText("Alpha");
    expect(fake.chatSessions).toHaveLength(2);

    unmount();

    expect(fake.epicSessions[0].close).toHaveBeenCalledTimes(1);
    for (const session of fake.chatSessions) {
      expect(session.close).toHaveBeenCalledTimes(1);
    }
  });

  it("regresses eval-round-1 finding 1: opening Artifacts does NOT open a second epic.subscribe, and the tree is populated instantly from the already-live session", async () => {
    const fake = createFakeStreamConnection();
    renderEpicView(fake);

    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(EPIC_META, epicUpdateWithArtifacts([
        { id: "spec-1", kind: "spec", title: "Design doc" },
      ]));
      fake.epicSessions[0].connection.applyStatus("open", null);
    });
    await screen.findByText("Live");
    expect(fake.epicSessions).toHaveLength(1);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Artifacts" }));

    // The tree renders from the SAME session's already-fetched artifacts
    // immediately -- no "Reconnecting..." flash, no second handshake.
    expect(await screen.findByText("Design doc")).toBeTruthy();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
    // Exactly one epic.subscribe for the whole epic-view lifetime, including
    // after drilling into Artifacts.
    expect(fake.epicSessions).toHaveLength(1);
  });
});

function epicUpdateWithArtifacts(
  artifacts: readonly { readonly id: string; readonly kind: string; readonly title: string }[],
): Uint8Array {
  const doc = new Y.Doc();
  const map = new Y.Map<unknown>();
  doc.getMap("epic").set("artifacts", map);
  for (const a of artifacts) {
    const entry = new Y.Map<unknown>();
    map.set(a.id, entry);
    entry.set("kind", a.kind);
    entry.set("title", a.title);
    entry.set("parentId", null);
    entry.set("artifactRoomId", `room-${a.id}`);
    entry.set("createdAt", 0);
    entry.set("updatedAt", 0);
  }
  return Y.encodeStateAsUpdate(doc);
}
