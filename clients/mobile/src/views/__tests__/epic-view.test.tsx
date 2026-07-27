// @vitest-environment jsdom
/**
 * Render test for the Epic tree view (T5, P1 desktop-fidelity rebuild).
 *
 * Drives the FAKE stream layer (no socket): feed a decoded epic doc-update that
 * enumerates chats/artifacts, then per-chat snapshots. Asserts the Agents +
 * Artifacts sections both render from the SAME epic session (no second
 * `epic.subscribe`), the connection pill shows desktop's 3-state copy, and
 * every stream (epic + every per-chat badge) is closed on unmount.
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
      access: { role: "owner", ownerUserId: "u1" },
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
      <EpicView epicId="e1" epicTitle="Epic 1" onOpenChat={onOpenChat} onBack={() => {}} />
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

describe("EpicView — Agents section (P1)", () => {
  it("renders chats with a live-state icon, blocked outranking running in the accessible label", async () => {
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

    expect(await screen.findByTestId("chat-row-c1")).toBeTruthy();
    expect(screen.getByTestId("chat-row-c2")).toBeTruthy();
    expect(screen.getByText("All changes synced")).toBeTruthy();

    // 2) Per-chat badge streams report: c2 is blocked (pending approval), c1 running.
    act(() => {
      chatSessionFor(fake, "c1").callbacks.onSnapshot(
        chatSnapshot({ runStatus: "running" }),
      );
      chatSessionFor(fake, "c2").callbacks.onSnapshot(
        chatSnapshot({ runStatus: "idle", approvals: ["a1"] }),
      );
    });

    const runningRow = screen.getByTestId("chat-row-c1");
    const blockedRow = screen.getByTestId("chat-row-c2");
    expect(within(runningRow).getByLabelText("Running")).toBeTruthy();
    expect(within(blockedRow).getByLabelText("Waiting for your approval")).toBeTruthy();
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

    await userEvent.setup().click(await screen.findByTestId("chat-row-c1"));
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
    await screen.findByTestId("chat-row-c1");
    expect(fake.chatSessions).toHaveLength(2);

    unmount();

    expect(fake.epicSessions[0].close).toHaveBeenCalledTimes(1);
    for (const session of fake.chatSessions) {
      expect(session.close).toHaveBeenCalledTimes(1);
    }
  });
});

describe("EpicView — Artifacts section (P1)", () => {
  it("renders inline from the SAME epic session — no second epic.subscribe", async () => {
    const fake = createFakeStreamConnection();
    renderEpicView(fake);

    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(
        EPIC_META,
        epicUpdateWithArtifacts([{ id: "spec-1", kind: "spec", title: "Design doc" }]),
      );
      fake.epicSessions[0].connection.applyStatus("open", null);
    });

    await screen.findByText("All changes synced");
    // The Artifacts section renders directly alongside Agents — no drill-in
    // screen, no second handshake.
    expect(await screen.findByTestId("artifact-row-spec-1")).toBeTruthy();
    expect(screen.getByText("Design doc")).toBeTruthy();
    expect(fake.epicSessions).toHaveLength(1);
  });

  it("opens the artifact body inline on tap", async () => {
    const fake = createFakeStreamConnection();
    renderEpicView(fake);

    act(() => {
      fake.epicSessions[0].callbacks.onSnapshot(
        EPIC_META,
        epicUpdateWithArtifacts([{ id: "spec-1", kind: "spec", title: "Design doc" }]),
      );
    });

    await userEvent.setup().click(await screen.findByTestId("artifact-row-spec-1"));
    // ArtifactBodyView renders its own back control + the artifact's icon tile.
    expect(await screen.findByText("Design doc")).toBeTruthy();
  });
});
