// @vitest-environment jsdom
/**
 * M6 — the Undo controls as the USER reaches them, through `ChatView`.
 *
 * `use-chat.test.ts` already proves the tracked-dispatch mechanism: a key goes
 * `submitting`, an ack resolves it, two keys stay independent. That test cannot
 * fail if nobody calls the tracked form. Reverting `chat-view.tsx`'s
 * `dispatchTrackedAction(revertKey(...), …)` back to the untracked
 * `dispatchAction(…)` typechecks, sends a byte-identical frame, and reddens
 * NOTHING in that suite — the hook's behaviour is bound and the CALL SITE'S
 * CHOICE is not. Testing a hook does not test that anyone uses it.
 *
 * So every assertion below is on something only the TRACKED path can produce:
 * the pending label and the host's rejection reason, both of which come from
 * `replyStatusFor(revertKey(...))` and are simply absent under the untracked
 * call. The dispatched frame is asserted too, but on its own a frame check
 * survives the mutation — it is here for the wiring (`filePaths`,
 * `revertArtifacts`), not for the correlation.
 *
 * Two rows throughout, never one: with a single row "the failure landed on the
 * right key" is unfalsifiable, and this panel's whole M6 change is per-row
 * keying.
 */
import { describe, expect, it } from "vitest";
import {
  chatAccumulatedFileChangeSchema,
  type ChatAccumulatedFileChange,
  type ChatSubscribeClientFrame,
  type ChatSubscribeServerFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { ChatView } from "@/views/chat-view";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { HostClientProvider } from "@/host/host-client-context";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeChatSession,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { act, fireEvent, render, screen } from "@/test-utils/dom";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;
type AckFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "actionAck" }>;

/**
 * Built through the REAL schema, not cast into shape: a fixture that only
 * satisfies the fields this panel happens to read would keep passing after the
 * wire grew a field the panel must respect.
 */
function fileChange(filePath: string): ChatAccumulatedFileChange {
  return chatAccumulatedFileChangeSchema.parse({
    filePath,
    operation: "edit",
    diffSource: "snapshot",
    beforeContent: "one\ntwo\n",
    afterContent: "one\ntwo\nthree\n",
    reason: "snapshot",
    undoable: true,
    artifact: null,
  });
}

const CHANGES: readonly ChatAccumulatedFileChange[] = [
  fileChange("src/a.ts"),
  fileChange("src/b.ts"),
];

function snapshotFrame(changes: readonly ChatAccumulatedFileChange[]): SnapshotFrame {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "idle",
      chat: { title: "Chat", messages: [], settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: [],
      pendingFileEditApprovals: [],
      pendingInterviews: [],
      accumulatedFileChanges: changes,
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  } as unknown as SnapshotFrame;
}

const rejectedAck = (clientActionId: string, reason: string): AckFrame =>
  ({
    kind: "actionAck",
    clientActionId,
    action: "revertFileChanges",
    status: "rejected",
    reason,
    code: null,
    backgroundStopTaskIds: [],
  }) as unknown as AckFrame;

function chatSession(fake: FakeStreamConnection): FakeChatSession {
  const session = fake.chatSessions[0];
  if (session === undefined) throw new Error("no chat session opened");
  return session;
}

function lastFrame(session: FakeChatSession): ChatSubscribeClientFrame {
  const call = session.sendAction.mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing was dispatched");
  return call[0] as ChatSubscribeClientFrame;
}

/**
 * Renders, seeds the changes, and opens the collapsed lower dock.
 *
 * Both Undo controls are gated on `canMutate` — a host client, a LIVE
 * connection and the owner role — so all three are established here. A test
 * that skipped any of them would render disabled buttons and could never
 * dispatch, which is a way to pass by never exercising the thing under test.
 */
function renderWithChanges(changes: readonly ChatAccumulatedFileChange[]): FakeStreamConnection {
  const fake = createFakeStreamConnection();
  const host = createFakeHostClient(async () => ({}));
  render(
    <HostClientProvider client={host.client}>
      <StreamConnectionProvider connection={fake.connection}>
        <ChatView epicId="e1" chatId="c1" initialTitle={null} onTitleChange={() => {}} />
      </StreamConnectionProvider>
    </HostClientProvider>,
  );
  act(() => {
    chatSession(fake).connection.applyStatus("open", null);
    chatSession(fake).callbacks.onSnapshot(snapshotFrame(changes));
  });
  // The dock ships collapsed (a UX fix): the panel is behind its summary strip.
  fireEvent.click(screen.getByRole("button", { name: /files ±/ }));
  return fake;
}

/** The confirmation sheet is deliberate and destructive — no Undo skips it. */
function confirmUndo(): void {
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
}

function undoAllButton(): HTMLElement {
  const button = screen
    .getAllByRole("button")
    .find((el) => /^Undo all$|^Undoing…$/.test(el.textContent ?? ""));
  if (button === undefined) throw new Error("no Undo-all control");
  return button;
}

describe("ChatView — the changes panel dispatches Undo through the TRACKED path", () => {
  it("renders Undo-all as pending until an ack arrives, and then shows the host's refusal", () => {
    const fake = renderWithChanges(CHANGES);

    fireEvent.click(undoAllButton());
    confirmUndo();

    const frame = lastFrame(chatSession(fake));
    expect(frame.kind).toBe("revertFileChanges");
    if (frame.kind !== "revertFileChanges") throw new Error("wrong frame");
    // null = every file in the chat, which is what "Undo all" means on the wire.
    expect(frame.filePaths).toBeNull();
    expect(frame.revertArtifacts).toBe(true);

    // Only the tracked call produces this: the untracked one sends the same
    // frame and leaves `replyStatusFor` undefined, so the label never changes.
    expect(undoAllButton().textContent).toContain("Undoing…");

    act(() => {
      chatSession(fake).callbacks.onActionAck(
        rejectedAck(frame.clientActionId, "The file changed on disk since the snapshot."),
      );
    });

    // The host's own wording, not a generic string.
    expect(screen.getByText("The file changed on disk since the snapshot.")).toBeTruthy();
    // The refusal belongs to the Undo-all key alone — neither row wears it.
    expect(screen.getAllByTestId("undo-failure")).toHaveLength(1);
    // A refused revert is retryable: the control comes back rather than
    // staying disabled the way the timer-cleared version left it.
    expect(undoAllButton().textContent).toContain("Undo all");
  });

  it("keys a row's Undo to its own file — the other row is untouched by the rejection", () => {
    const fake = renderWithChanges(CHANGES);

    fireEvent.click(screen.getByRole("button", { name: "Undo changes to src/a.ts" }));
    confirmUndo();

    const frame = lastFrame(chatSession(fake));
    if (frame.kind !== "revertFileChanges") throw new Error("wrong frame");
    expect(frame.filePaths).toEqual(["src/a.ts"]);
    // Not an artifact row, so the host must not be told to revert artifacts.
    expect(frame.revertArtifacts).toBe(false);

    expect(
      screen.getByRole("button", { name: "Undo changes to src/a.ts" }).textContent,
    ).toContain("Undoing…");
    expect(
      screen.getByRole("button", { name: "Undo changes to src/b.ts" }).textContent,
    ).toContain("Undo");
    expect(
      screen.getByRole("button", { name: "Undo changes to src/b.ts" }).textContent,
    ).not.toContain("Undoing…");

    act(() => {
      chatSession(fake).callbacks.onActionAck(
        rejectedAck(frame.clientActionId, "src/a.ts is locked."),
      );
    });

    expect(screen.getByText("src/a.ts is locked.")).toBeTruthy();
    // One failure note, not two: the ack resolved a.ts's key and nothing else.
    expect(screen.getAllByTestId("undo-failure")).toHaveLength(1);
    // And Undo-all did not inherit it either.
    expect(undoAllButton().textContent).toContain("Undo all");
  });
});
