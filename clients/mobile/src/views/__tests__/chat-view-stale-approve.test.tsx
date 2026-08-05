// @vitest-environment jsdom
/**
 * mobile-approve-reject-no-connectivity-gate — the render-gate half.
 *
 * `ApproveRejectRow`/the interview Submit button used to gate `disabled` on
 * exactly `status?.phase === "submitting"` — no connection check at all,
 * unlike the same file's `canMutate` (Undo) and the composer's Send button.
 * `use-chat.test.ts`'s "sendReply re-validates the connection at the moment
 * of dispatch" describe block covers the dispatch-layer invariant; this file
 * covers the cheap, common-case fix: the control itself must not even be
 * tappable while blocked, with the reason visible.
 *
 * Both directions are asserted in this SAME file (verification-practices
 * #14 / this ticket's own instinct) — a regression that makes the gate
 * always-blocked or always-open must redden something here, not just look
 * plausible in a file that only ever tests one side.
 */
import { describe, expect, it } from "vitest";
import type { ChatSubscribeServerFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import { ChatView } from "@/views/chat-view";
import { HostClientProvider } from "@/host/host-client-context";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, fireEvent, render, screen } from "@/test-utils/dom";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;

function snapshotFrame(opts: {
  readonly role?: "owner" | "viewer";
  readonly approvals?: readonly unknown[];
  readonly interviews?: readonly unknown[];
  readonly messages?: readonly unknown[];
}): SnapshotFrame {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "idle",
      chat: { title: "Chat", messages: opts.messages ?? [], settings: null },
      access: { role: opts.role ?? "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: opts.approvals ?? [],
      pendingFileEditApprovals: [],
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

function renderChatView(fake: FakeStreamConnection): void {
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

describe("stale-approve-hazard (mobile) — Approve/Reject render gate", () => {
  it("disables Approve/Reject with a visible reason while disconnected, and a tap sends nothing", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    const session = fake.chatSessions[0];
    // Deliberately no `applyStatus("open", ...)` — stays at the real default
    // ("reconnecting"), matching a chat opened before the socket settles.
    act(() => {
      session.callbacks.onSnapshot(snapshotFrame({ approvals: [toolApproval("a1")] }));
    });

    const approve = (await screen.findByRole("button", { name: "Approve" })) as HTMLButtonElement;
    const reject = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(reject.disabled).toBe(true);
    expect(
      screen.getByText("Reconnecting to your host — approving is paused until the connection is back."),
    ).toBeTruthy();

    // A disabled button suppresses the click at the DOM level, but the
    // assertion that actually matters is the emitted state, not the
    // attribute — see verification-practices #9 and this ticket's own
    // instruction to assert on emitted state, not button appearance.
    fireEvent.click(approve);
    expect(session.sendAction).not.toHaveBeenCalled();
  });

  it("enables Approve/Reject once the connection is live for an owner, and a tap sends the frame", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    const session = fake.chatSessions[0];
    act(() => {
      session.connection.applyStatus("open", null);
      session.callbacks.onSnapshot(snapshotFrame({ approvals: [toolApproval("a1")] }));
    });

    const approve = (await screen.findByRole("button", { name: "Approve" })) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(
      screen.queryByText("Reconnecting to your host — approving is paused until the connection is back."),
    ).toBeNull();

    fireEvent.click(approve);
    expect(session.sendAction).toHaveBeenCalledTimes(1);
  });

  it("disables Approve/Reject for a VIEWER even while fully connected, with a permission-specific reason", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    const session = fake.chatSessions[0];
    act(() => {
      session.connection.applyStatus("open", null);
      session.callbacks.onSnapshot(snapshotFrame({ role: "viewer", approvals: [toolApproval("a1")] }));
    });

    const approve = (await screen.findByRole("button", { name: "Approve" })) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    // PERMISSION FIRST (mirrors teams-tab's actionability.ts ordering): a
    // viewer is told why they can't act, not the connection-specific reason
    // that would apply to an owner.
    expect(
      screen.getByText("You have view-only access to this chat, so you can't approve or reject here."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Reconnecting to your host — approving is paused until the connection is back."),
    ).toBeNull();

    fireEvent.click(approve);
    expect(session.sendAction).not.toHaveBeenCalled();
  });

  it("disables the interview Submit answer button the same way, without touching the drafting controls", async () => {
    const fake = createFakeStreamConnection();
    renderChatView(fake);
    const session = fake.chatSessions[0];
    act(() => {
      session.callbacks.onSnapshot(
        snapshotFrame({
          interviews: [{ blockId: "iv1", requestedAt: 0 }],
          messages: interviewMessages("iv1"),
        }),
      );
    });

    // Drafting an answer is a read/local-only action (same precedent as
    // Review-all staying open to a viewer) — the option picker stays usable.
    const option = await screen.findByRole("button", { name: /Rewrite/ });
    expect((option as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(option);
    expect(option.getAttribute("aria-pressed")).toBe("true");

    const submit = screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(session.sendAction).not.toHaveBeenCalled();
  });
});
