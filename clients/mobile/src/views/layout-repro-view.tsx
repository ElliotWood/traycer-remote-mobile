/**
 * DEV-ONLY, no-network proof surface for a real-browser layout repro — same
 * pattern as `showcase-view.tsx` (`?showcase=1`): gated behind a query flag in
 * `main.tsx`, lazy-loaded so it never touches the shipped bundle for a normal
 * session.
 *
 * jsdom (what the vitest render tests use) does not run layout — no flexbox
 * resolution, no `dvh`, `getBoundingClientRect()` is all zeros. To actually
 * measure whether the footer clips the composer when N pending cards
 * (interview/approval/file-edit) stack up in `PendingSection`, this mounts
 * the REAL `ChatView` behind a fake, in-memory `HostStreamConnection` (same
 * shape `test-utils/fakes.ts`'s `createFakeStreamConnection` gives the jsdom
 * render tests, reimplemented with plain closures instead of `vi.fn` so this
 * file has no vitest dependency) and exposes a tiny control surface on
 * `window` for a headless Playwright driver (`tests/layout/measure.mjs`) to
 * push snapshots and read real, browser-computed bounding boxes.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatSubscribeServerFrame } from "@traycer/protocol/host/agent/gui/subscribe";
import { HostStreamConnection, StreamConnectionStateStore } from "@/host/stream-connection";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { ChatView } from "@/views/chat-view";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;

const EPIC_ID = "layout-repro-epic";
const CHAT_ID = "layout-repro-chat";

export interface ReproScenario {
  /** One entry per pending interview card, each entry is that interview's question count. */
  readonly interviews?: readonly number[];
  readonly approvalCount?: number;
  readonly fileEditCount?: number;
}

function interviewMessage(blockId: string, questionCount: number): unknown {
  return {
    role: "assistant",
    messageId: `msg-${blockId}`,
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
        questions: Array.from({ length: questionCount }, (_, qi) => ({
          questionId: `${blockId}-q${qi + 1}`,
          question: `Which approach should the agent take for step ${qi + 1}?`,
          header: null,
          options: [
            { label: "Option 1", description: "Pick this for outcome one.", preview: null },
            { label: "Option 2", description: "Pick this for outcome two.", preview: null },
          ],
          multiSelect: false,
        })),
        answers: [],
        error: null,
        metadata: null,
      },
    ],
  };
}

function snapshotFrame(scenario: ReproScenario): SnapshotFrame {
  const interviews = scenario.interviews ?? [];
  const approvalCount = scenario.approvalCount ?? 0;
  const fileEditCount = scenario.fileEditCount ?? 0;

  const messages = interviews.map((questionCount, i) => interviewMessage(`iv${i + 1}`, questionCount));
  const pendingInterviews = interviews.map((_, i) => ({ blockId: `iv${i + 1}`, requestedAt: 0 }));
  const pendingApprovals = Array.from({ length: approvalCount }, (_, i) => ({
    approvalId: `ap${i + 1}`,
    toolName: "Bash",
    description: `Run a command as part of step ${i + 1} — this description is long enough to wrap onto more than one line in the card body.`,
    input: null,
    requestedAt: 0,
    kind: "tool",
  }));
  const pendingFileEditApprovals = Array.from({ length: fileEditCount }, (_, i) => ({
    approvalId: `fe${i + 1}`,
    toolName: "Edit",
    description: `Edit file ${i + 1}`,
    paths: [`src/file-${i + 1}-a.ts`, `src/file-${i + 1}-b.ts`],
    operation: "edit",
    input: null,
    requestedAt: 0,
  }));

  return {
    kind: "snapshot",
    snapshot: {
      // Idle, not running — the composer shows Send (not Stop), matching
      // the reported scenario: the agent stopped to ask and the user is
      // trying to type a reply or send a new message.
      runStatus: "idle",
      chat: { title: "Layout repro", messages, settings: null },
      access: { role: "owner", ownerUserId: "u1" },
      queue: { status: "idle", items: [] },
      pendingApprovals,
      pendingFileEditApprovals,
      pendingInterviews,
      accumulatedFileChanges: [],
      activeTurn: null,
      worktreeBinding: null,
      missingWorktreePaths: [],
    },
  } as unknown as SnapshotFrame;
}

/**
 * A `HostStreamConnection`-shaped object built without the real class's
 * constructor (which dials a socket) — `Object.create` gives it the same
 * prototype so an `instanceof`/method-shape check elsewhere still passes,
 * while every method actually used here (`openChat`) is a plain closure over
 * an in-memory chat session, and nothing touches the network.
 */
function createFakeConnection(onCallbacksReady: (callbacks: ChatStreamCallbacks) => void): HostStreamConnection {
  const fake = Object.create(HostStreamConnection.prototype) as HostStreamConnection;
  Object.assign(fake, {
    openChat(params: { readonly epicId: string; readonly chatId: string; readonly callbacks: ChatStreamCallbacks }) {
      const store = new StreamConnectionStateStore();
      onCallbacksReady(params.callbacks);
      // Mirrors a real dial completing strictly after `openChat` returns —
      // the caller's effect must finish mounting before the first frame
      // arrives, same as the jsdom fakes' `act()`-wrapped snapshot pushes.
      queueMicrotask(() => store.applyStatus("open", null));
      return { stream: { close: () => {}, sendAction: () => {} }, connection: store };
    },
    openEpic(): never {
      throw new Error("layout repro never opens an epic stream");
    },
    reconnectAll: () => {},
  });
  return fake;
}

declare global {
  interface Window {
    __layoutRepro?: {
      readonly ready: true;
      readonly setScenario: (scenario: ReproScenario) => void;
    };
  }
}

export function LayoutReproView(): ReactElement {
  // `callbacks` is captured synchronously during render (via the `useState`
  // lazy initializer below, when `ChatView`'s own effect calls `openChat`),
  // but registering `window.__layoutRepro` and pushing the first snapshot
  // are real side effects on a value OUTSIDE this component — those belong
  // in an effect, not the render body. Child effects (ChatView's `useChat`)
  // commit before this component's own effect, so `callbacksRef.current` is
  // already populated by the time it runs.
  const callbacksRef = useRef<ChatStreamCallbacks | null>(null);
  const [connection] = useState<HostStreamConnection>(() =>
    createFakeConnection((callbacks) => {
      callbacksRef.current = callbacks;
    }),
  );

  useEffect(() => {
    const callbacks = callbacksRef.current;
    if (callbacks === null) return;
    window.__layoutRepro = {
      ready: true,
      setScenario: (scenario: ReproScenario) => callbacks.onSnapshot(snapshotFrame(scenario)),
    };
    callbacks.onSnapshot(snapshotFrame({ interviews: [2] }));
    return () => {
      delete window.__layoutRepro;
    };
  }, []);

  return (
    <StreamConnectionProvider connection={connection}>
      <ChatView epicId={EPIC_ID} chatId={CHAT_ID} initialTitle={null} onTitleChange={() => {}} />
    </StreamConnectionProvider>
  );
}
