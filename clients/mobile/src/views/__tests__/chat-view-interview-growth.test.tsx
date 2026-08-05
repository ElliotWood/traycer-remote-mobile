// @vitest-environment jsdom
/**
 * Regression for a real production crash: `InterviewForm` (chat-view.tsx)
 * sizes its `drafts` state once, at mount, from `block.questions.length`.
 * When the SAME interview block (same `blockId`) later carries MORE
 * questions than it did at mount — a reconnect's fresh snapshot replacing a
 * still-streaming block, or a cache-seeded partial block being replaced by
 * the live one — `drafts[qi]` was `undefined` for the new question(s), and
 * reading `.selected` off it threw during render. `PendingSection` (and so
 * `InterviewForm`) renders directly inside `ChatView`'s footer with no
 * per-block boundary, so the throw escaped to `app-shell.tsx`'s
 * `<ErrorBoundary label="this chat">` and took out the ENTIRE chat screen —
 * transcript, pending cards, and composer together. That is the reported
 * "sometimes it blocks the ability to type or send a message": not two
 * separate faults, one crash that removes both at once.
 *
 * Two independent ways the mismatch arises in production, both covered
 * below: a cache-seeded short block replaced by a longer live one (Route 1),
 * and a live snapshot growing mid-session with no cache involved at all
 * (Route 2). Neither is geometric — this needs no browser, jsdom is enough.
 */
import { describe, expect, it } from "vitest";
import type { ChatSubscribeClientFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import { ChatView } from "@/views/chat-view";
import { HostClientProvider } from "@/host/host-client-context";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import {
  createFakeHostClient,
  createFakeStreamConnection,
  type FakeChatSession,
  type FakeStreamConnection,
} from "@/test-utils/fakes";
import { chatCacheStorageKey } from "@/host/use-chat";
import { act, fireEvent, render, screen } from "@/test-utils/dom";

interface QuestionSpec {
  readonly questionId: string | null;
  readonly question: string;
  readonly header?: string | null;
  readonly options: readonly { readonly label: string; readonly description: string | null; readonly preview: null }[];
}

function interviewMessagesCustom(questions: readonly QuestionSpec[]): readonly unknown[] {
  return [
    {
      role: "assistant",
      messageId: "a1",
      blocks: [
        {
          type: "interview",
          blockId: "iv1",
          status: "streaming",
          timestamp: 0,
          parentBlockId: null,
          toolName: null,
          title: "A quick decision",
          description: null,
          questions: questions.map((q) => ({
            questionId: q.questionId,
            question: q.question,
            header: q.header ?? null,
            options: q.options,
            multiSelect: false,
          })),
          answers: [],
          error: null,
          metadata: null,
        },
      ],
    },
  ];
}

function snapshotFrameCustom(questions: readonly QuestionSpec[]): unknown {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "idle",
      chat: { title: "Chat", messages: interviewMessagesCustom(questions), settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: [],
      pendingFileEditApprovals: [],
      pendingInterviews: [{ blockId: "iv1", requestedAt: 0 }],
      accumulatedFileChanges: [],
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  };
}

function sentFrames(session: FakeChatSession): ChatSubscribeClientFrame[] {
  return session.sendAction.mock.calls.map((call) => call[0] as ChatSubscribeClientFrame);
}

function interviewMessages(questionCount: number): readonly unknown[] {
  return [
    {
      role: "assistant",
      messageId: "a1",
      blocks: [
        {
          type: "interview",
          blockId: "iv1",
          status: "streaming",
          timestamp: 0,
          parentBlockId: null,
          toolName: null,
          title: "A quick decision",
          description: null,
          questions: Array.from({ length: questionCount }, (_, i) => ({
            questionId: `q${i + 1}`,
            question: `Question ${i + 1}?`,
            header: null,
            options: [
              { label: "A", description: null, preview: null },
              { label: "B", description: null, preview: null },
            ],
            multiSelect: false,
          })),
          answers: [],
          error: null,
          metadata: null,
        },
      ],
    },
  ];
}

function snapshotFrame(questionCount: number): unknown {
  return {
    kind: "snapshot",
    snapshot: {
      runStatus: "idle",
      chat: { title: "Chat", messages: interviewMessages(questionCount), settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals: [],
      pendingFileEditApprovals: [],
      pendingInterviews: [{ blockId: "iv1", requestedAt: 0 }],
      accumulatedFileChanges: [],
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  };
}

function renderChat(fake: FakeStreamConnection, epicId: string, chatId: string): void {
  // A host client is required for `canMutate`/the stale-approve-hazard gate
  // to ever read `true` — see chat-view.test.tsx's `renderChatView` for why.
  const host = createFakeHostClient(() => {
    throw new Error("no request expected in this suite");
  });
  render(
    <HostClientProvider client={host.client}>
      <StreamConnectionProvider connection={fake.connection}>
        <ChatView epicId={epicId} chatId={chatId} initialTitle={null} onTitleChange={() => {}} />
      </StreamConnectionProvider>
    </HostClientProvider>,
  );
}

describe("interview block growing after InterviewForm has mounted", () => {
  it("Route 2 — a later live snapshot with more questions does not crash the chat screen", async () => {
    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-route2");
    const session = fake.chatSessions[0];

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(1) as never);
    });
    await screen.findByText("Question 1?");

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(2) as never);
    });

    // If InterviewForm crashed, the ErrorBoundary fallback replaced the
    // whole screen — none of this would be present.
    expect(await screen.findByText("Question 2?")).toBeTruthy();
    expect(screen.getByPlaceholderText("Message this agent…")).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("Route 1 — a cache-seeded short block replaced by a longer live snapshot does not crash the chat screen", async () => {
    window.localStorage.setItem(
      chatCacheStorageKey("e1", "c-route1"),
      JSON.stringify({
        title: "Chat",
        messages: interviewMessages(1),
        runStatus: "idle",
        pendingApprovals: [],
        pendingFileEditApprovals: [],
        pendingInterviews: [{ blockId: "iv1", requestedAt: 0 }],
      }),
    );

    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-route1");
    // The cache seed paints synchronously on mount, before any snapshot.
    await screen.findByText("Question 1?");

    const session = fake.chatSessions[0];
    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(3) as never);
    });

    expect(await screen.findByText("Question 3?")).toBeTruthy();
    expect(screen.getByPlaceholderText("Message this agent…")).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("preserves an already-made selection on an earlier question when the block grows", async () => {
    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-preserve");
    const session = fake.chatSessions[0];

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(1) as never);
    });
    const optionA = await screen.findByRole("button", { name: "A" });
    fireEvent.click(optionA);
    expect(optionA.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(2) as never);
    });
    await screen.findByText("Question 2?");

    // Same question 1 "A" button, re-queried after the re-render — still
    // selected, not reset by the block's growth.
    const optionAAfterGrowth = screen.getAllByRole("button", { name: "A" })[0];
    expect(optionAAfterGrowth.getAttribute("aria-pressed")).toBe("true");
  });

  it("a newly-appended question's options are actually tappable after growth (not just crash-free)", async () => {
    // Guards against a fix that pads only the READ side (e.g. `drafts[qi] ??
    // {selected:[],text:""}` at the point of use): `toggleOption` writes via
    // `prev.map(...)`, and mapping over a still-short `prev` can never
    // produce an entry past its own length — tapping a newly-streamed-in
    // question's option would silently do nothing forever.
    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-tappable");
    const session = fake.chatSessions[0];

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(1) as never);
    });
    await screen.findByText("Question 1?");

    act(() => {
      session.callbacks.onSnapshot(snapshotFrame(2) as never);
    });
    await screen.findByText("Question 2?");

    // Question 2's own "A" option — the second "A" button on the page.
    const question2OptionA = screen.getAllByRole("button", { name: "A" })[1];
    expect(question2OptionA.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(question2OptionA);
    expect(question2OptionA.getAttribute("aria-pressed")).toBe("true");

    // Both questions answered ⇒ Submit is enabled (also answer question 1
    // first isn't needed here — this test only needs to prove qi=1 is live).
  });

  it("does not silently discard a free-text answer when options arrive later at the same question count", async () => {
    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-late-options");
    const session = fake.chatSessions[0];

    // Submit answer is gated on a LIVE connection (the stale-approve-hazard
    // fix) — established here or the final `disabled` assertion below is
    // trivially true for the wrong reason.
    act(() => {
      session.connection.applyStatus("open", null);
      session.callbacks.onSnapshot(
        snapshotFrameCustom([{ questionId: "q1", question: "Freeform?", options: [] }]) as never,
      );
    });
    const textInput = await screen.findByPlaceholderText("Type your answer");
    fireEvent.change(textInput, { target: { value: "my typed answer" } });
    expect((textInput as HTMLInputElement).value).toBe("my typed answer");

    act(() => {
      session.callbacks.onSnapshot(
        snapshotFrameCustom([
          {
            questionId: "q1",
            question: "Freeform?",
            options: [
              { label: "A", description: null, preview: null },
              { label: "B", description: null, preview: null },
            ],
          },
        ]) as never,
      );
    });

    // No crash — the question now renders as options, not a text input.
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    // The user is told, not left to wonder where their answer went.
    expect(await screen.findByText(/You typed.*my typed answer/)).toBeTruthy();
    // Submit must NOT be tappable while the stale text is the only "answer" —
    // it was never selected as one of the actual options.
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true);

    // Picking an option clears the stranded-text warning and enables Submit.
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(screen.queryByText(/You typed/)).toBeNull();
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not misattribute an answer when the same questions arrive reordered at a stable count", async () => {
    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-reorder");
    const session = fake.chatSessions[0];

    const q1 = { questionId: "q1", question: "Question 1: which approach", options: [
      { label: "Option 1 for question 1", description: null, preview: null },
      { label: "Option 2 for question 1", description: null, preview: null },
    ] };
    const q2 = { questionId: "q2", question: "Question 2: which approach", options: [
      { label: "Option 1 for question 2", description: null, preview: null },
      { label: "Option 2 for question 2", description: null, preview: null },
    ] };

    // Submit answer is gated on a LIVE connection (the stale-approve-hazard
    // fix), established here or the final submit later in this test sends
    // nothing and the frame assertion measures an empty array.
    act(() => {
      session.connection.applyStatus("open", null);
      session.callbacks.onSnapshot(snapshotFrameCustom([q1, q2]) as never);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Option 1 for question 1" }));

    // Same two questions, swapped order — the schema never guarantees a
    // stable array position, only (when present) a stable `questionId`.
    act(() => {
      session.callbacks.onSnapshot(snapshotFrameCustom([q2, q1]) as never);
    });
    await screen.findByText("Question 2: which approach");

    // Question 1's own answer travels WITH it, not with whichever question
    // now sits at its old array index.
    expect(screen.getByRole("button", { name: "Option 1 for question 1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // Question 2 was never answered — it must not have inherited Question
    // 1's selection just because it moved into that index.
    expect(screen.getByRole("button", { name: "Option 1 for question 2" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Option 2 for question 2" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Option 2 for question 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    const frame = sentFrames(session)[0];
    expect(frame.kind).toBe("interviewAnswer");
    if (frame.kind !== "interviewAnswer") throw new Error("wrong frame");
    const byQuestion = new Map(frame.answers.map((a) => [a.question, a.values]));
    expect(byQuestion.get("Question 1: which approach")).toEqual(["Option 1 for question 1"]);
    expect(byQuestion.get("Question 2: which approach")).toEqual(["Option 2 for question 2"]);
  });

  it("two questions with identical text and no questionId never share one answer, and neither is mispaired across a snapshot", async () => {
    // Genuinely ambiguous case: `questionId: null` on both, byte-identical
    // `question` text — nothing in the schema distinguishes them. The
    // requirement isn't "get it right" (there's no signal to get it right
    // WITH) — it's "never let them silently share a draft, and never carry
    // a stale one across a snapshot where they might have been reordered".
    const dup = { questionId: null, question: "Which color?", options: [
      { label: "Red", description: null, preview: null },
      { label: "Blue", description: null, preview: null },
    ] };

    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-duplicate");
    const session = fake.chatSessions[0];

    act(() => {
      session.callbacks.onSnapshot(snapshotFrameCustom([dup, dup]) as never);
    });
    const redButtons = await screen.findAllByRole("button", { name: "Red" });
    expect(redButtons).toHaveLength(2);

    // Answer only the FIRST occurrence.
    fireEvent.click(redButtons[0]);
    expect(redButtons[0].getAttribute("aria-pressed")).toBe("true");
    // The second occurrence must NOT show as answered too — sharing one
    // draft between two simultaneously-rendered questions is the bug this
    // guards against.
    expect(screen.getAllByRole("button", { name: "Red" })[1].getAttribute("aria-pressed")).toBe("false");

    // A new snapshot arrives (same ambiguous pair, could be either the same
    // two questions or a reorder of them — indistinguishable either way).
    act(() => {
      session.callbacks.onSnapshot(snapshotFrameCustom([dup, dup]) as never);
    });
    await screen.findAllByRole("button", { name: "Red" });

    // Neither occurrence carries the old selection forward — dropped, not
    // risked on a possibly-wrong pairing. Submit is disabled either way
    // (nothing answered), which is itself proof nothing was silently
    // resubmitted against the wrong slot.
    for (const button of screen.getAllByRole("button", { name: "Red" })) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("questions with the same text but DIFFERENT headers keep their answers across a new snapshot — not treated as duplicates", async () => {
    // `header` exists specifically to disambiguate otherwise-identical
    // questions. Folding it into the key means these two are fully distinct
    // (not the lossy `::dup:` path), so a reconnect — the exact trigger
    // this whole sprint exists for — must not wipe an already-answered one.
    const q1 = {
      questionId: null,
      question: "Which color?",
      header: "Decision 1",
      options: [
        { label: "Red", description: null, preview: null },
        { label: "Blue", description: null, preview: null },
      ],
    };
    const q2 = {
      questionId: null,
      question: "Which color?",
      header: "Decision 2",
      options: [
        { label: "Red", description: null, preview: null },
        { label: "Blue", description: null, preview: null },
      ],
    };

    const fake = createFakeStreamConnection();
    renderChat(fake, "e1", "c-header-distinguished");
    const session = fake.chatSessions[0];

    act(() => {
      session.callbacks.onSnapshot(snapshotFrameCustom([q1, q2]) as never);
    });
    await screen.findByText("Decision 1");
    await screen.findByText("Decision 2");

    // Answer ONLY the first question (under "Decision 1").
    fireEvent.click(screen.getAllByRole("button", { name: "Red" })[0]);
    expect(screen.getAllByRole("button", { name: "Red" })[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { name: "Red" })[1].getAttribute("aria-pressed")).toBe("false");

    // A fresh snapshot object, identical content — the reconnect case.
    act(() => {
      session.callbacks.onSnapshot(snapshotFrameCustom([q1, q2]) as never);
    });
    await screen.findByText("Decision 1");

    // The answer survives — these were never actually ambiguous.
    expect(screen.getAllByRole("button", { name: "Red" })[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { name: "Red" })[1].getAttribute("aria-pressed")).toBe("false");
  });
});
