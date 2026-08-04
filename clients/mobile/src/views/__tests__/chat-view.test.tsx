// @vitest-environment jsdom
/**
 * Render tests for the chat detail view (T6, the reply payoff).
 *
 * Drives the FAKE stream layer (no socket): feed fabricated `chat.subscribe`
 * snapshots + acks, tap the reply controls, and assert the EXACT client frame
 * dispatched through the chat session's `sendAction` spy. The focus is that each
 * block kind sends its OWN frame (tool → `approvalDecision`, file-edit →
 * `fileEditApprovalDecision`, interview → `interviewAnswer`), that an
 * unresolvable interview shows loading (not empty), and that a `rejected`
 * `actionAck` surfaces an inline error against the still-true pending state.
 */
import { describe, expect, it } from "vitest";
import type {
  ChatSubscribeClientFrame,
  ChatSubscribeServerFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { ChatView } from "@/views/chat-view";
import { HostClientProvider } from "@/host/host-client-context";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeChatSession,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, fireEvent, render, screen } from "@/test-utils/dom";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;
type AckFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "actionAck" }>;

interface Pendings {
  readonly runStatus?: "idle" | "running" | "stopping";
  readonly title?: string;
  readonly messages?: readonly unknown[];
  readonly approvals?: readonly unknown[];
  readonly fileEditApprovals?: readonly unknown[];
  readonly interviews?: readonly unknown[];
}

function snapshotFrame(opts: Pendings): SnapshotFrame {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: opts.runStatus ?? "running",
      chat: { title: opts.title ?? "Chat", messages: opts.messages ?? [], settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: opts.approvals ?? [],
      pendingFileEditApprovals: opts.fileEditApprovals ?? [],
      pendingInterviews: opts.interviews ?? [],
      accumulatedFileChanges: [],
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  } as unknown as SnapshotFrame;
}

const toolApproval = (approvalId: string): unknown => ({
  approvalId,
  toolName: "Bash",
  description: "Run `ls -la`",
  input: null,
  requestedAt: 0,
  kind: "tool",
});

const fileEditApproval = (approvalId: string): unknown => ({
  approvalId,
  toolName: "Edit",
  description: "Edit two files",
  paths: ["src/a.ts", "src/b.ts"],
  operation: "edit",
  input: null,
  requestedAt: 0,
});

/**
 * An assistant message carrying an interview block resolvable by `blockId`.
 * Fields beyond blockId/title/questions are the schema's real shape (Sprint 2's
 * TranscriptView also renders this same message's blocks, so the fixture must
 * satisfy `InterviewBlock` fully, not just what T6's reply flow reads).
 */
const interviewMessages = (blockId: string): readonly unknown[] => [
  {
    role: "assistant",
    messageId: "a1",
    blocks: [
      {
        type: "interview",
        blockId,
        status: "streaming",
        timestamp: 0,
        parentBlockId: null,
        toolName: null,
        title: "A quick decision",
        description: null,
        questions: [
          {
            questionId: "q1",
            question: "Which approach?",
            header: null,
            options: [
              { label: "Rewrite", description: "start fresh", preview: null },
              { label: "Patch", description: "minimal change", preview: null },
            ],
            multiSelect: false,
          },
        ],
        answers: [],
        error: null,
        metadata: null,
      },
    ],
  },
];

const ackFrame = (opts: {
  readonly clientActionId: string;
  readonly status: "accepted" | "rejected";
  readonly reason: string | null;
}): AckFrame =>
  ({
    kind: "actionAck",
    clientActionId: opts.clientActionId,
    action: "approvalDecision",
    status: opts.status,
    reason: opts.reason,
    code: null,
    backgroundStopTaskIds: [],
  }) as unknown as AckFrame;

function renderChatView(fake: FakeStreamConnection): void {
  // A host client is required for `canMutate`/the stale-approve-hazard gate
  // to ever read `true` — its absence used to be indistinguishable from a
  // disconnected one, which is why every reply-dispatch test below also
  // drives the connection to "live".
  const host = createFakeHostClient(() => {
    throw new Error("no request expected in this suite");
  });
  render(
    <HostClientProvider client={host.client}>
      <StreamConnectionProvider connection={fake.connection}>
        <ChatView epicId="e1" chatId="c1" initialTitle={null} onTitleChange={() => {}} />
      </StreamConnectionProvider>
    </HostClientProvider>,
  );
}

function chatSession(fake: FakeStreamConnection): FakeChatSession {
  const session = fake.chatSessions[0];
  if (session === undefined) throw new Error("no chat session opened");
  return session;
}

function sentFrames(session: FakeChatSession): ChatSubscribeClientFrame[] {
  return session.sendAction.mock.calls.map(
    (call) => call[0] as ChatSubscribeClientFrame,
  );
}

describe("ChatView reply dispatch", () => {
  it("sends an approvalDecision frame when a tool approval is approved", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    // Approve/Reject are gated on a LIVE connection (the stale-approve-hazard
    // fix) — established here the same way chat-view-undo.test.tsx does for
    // canMutate, or the button renders disabled and this test measures nothing.
    act(() => {
      chatSession(fake).connection.applyStatus("open", null);
      chatSession(fake).callbacks.onSnapshot(
        snapshotFrame({ approvals: [toolApproval("a1")] }),
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    const frames = sentFrames(chatSession(fake));
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.kind).toBe("approvalDecision");
    if (frame.kind !== "approvalDecision") throw new Error("wrong frame");
    expect(frame.approvalId).toBe("a1");
    expect(frame.decision.approved).toBe(true);
    expect(frame.epicId).toBe("e1");
    expect(frame.chatId).toBe("c1");
    expect(typeof frame.clientActionId).toBe("string");
    expect(frame.clientActionId.length).toBeGreaterThan(0);
  });

  it("sends a fileEditApprovalDecision frame (NOT approvalDecision) for a file-edit approval", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    act(() => {
      chatSession(fake).connection.applyStatus("open", null);
      chatSession(fake).callbacks.onSnapshot(
        snapshotFrame({ fileEditApprovals: [fileEditApproval("f1")] }),
      );
    });

    // The file path(s)/operation are shown so the user knows what they approve.
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    const frame = sentFrames(chatSession(fake))[0];
    expect(frame.kind).toBe("fileEditApprovalDecision");
    if (frame.kind !== "fileEditApprovalDecision") throw new Error("wrong frame");
    expect(frame.approvalId).toBe("f1");
    expect(frame.decision.approved).toBe(true);
  });

  it("sends an interviewAnswer frame with the right blockId + answers shape", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    act(() => {
      chatSession(fake).connection.applyStatus("open", null);
      chatSession(fake).callbacks.onSnapshot(
        snapshotFrame({
          interviews: [{ blockId: "iv1", requestedAt: 0 }],
          messages: interviewMessages("iv1"),
        }),
      );
    });

    // Choose an option, then submit.
    fireEvent.click(await screen.findByRole("button", { name: /Rewrite/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    const frame = sentFrames(chatSession(fake))[0];
    expect(frame.kind).toBe("interviewAnswer");
    if (frame.kind !== "interviewAnswer") throw new Error("wrong frame");
    expect(frame.blockId).toBe("iv1");
    expect(frame.answers).toEqual([
      {
        questionId: "q1",
        question: "Which approach?",
        values: ["Rewrite"],
        notes: null,
      },
    ]);
  });

  it("shows a loading state (not empty) for an interview whose block is not present yet", () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    act(() => {
      chatSession(fake).callbacks.onSnapshot(
        // pending interview announced, but no matching block in messages
        snapshotFrame({ interviews: [{ blockId: "iv-missing", requestedAt: 0 }] }),
      );
    });

    expect(screen.getByText(/Loading question/)).toBeTruthy();
    // No submit control until the prompt resolves.
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBeNull();
  });

  it("surfaces an inline error when the actionAck is rejected", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    act(() => {
      chatSession(fake).connection.applyStatus("open", null);
      chatSession(fake).callbacks.onSnapshot(
        snapshotFrame({ approvals: [toolApproval("a1")] }),
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const sent = sentFrames(chatSession(fake))[0];
    if (sent.kind !== "approvalDecision") throw new Error("wrong frame");

    act(() => {
      chatSession(fake).callbacks.onActionAck(
        ackFrame({
          clientActionId: sent.clientActionId,
          status: "rejected",
          reason: "Approval window expired",
        }),
      );
    });

    expect(screen.getByText("Approval window expired")).toBeTruthy();
    // The item stays actionable (true state): the Approve control is still there.
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
