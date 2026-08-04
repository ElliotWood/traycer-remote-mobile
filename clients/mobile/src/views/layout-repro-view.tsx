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
import { useEffect, useState, type ReactElement } from "react";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import {
  chatSubscribeServerFrameSchema,
  type ChatSubscribeServerFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { GuiAgentCommandOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { WorkspaceFileMentionSuggestion } from "@traycer/protocol/host/workspace/unary-schemas";
import { hostRpcRegistry, type HostRpcRegistry } from "@traycer/protocol/host/index";
import { createRequestContext } from "@traycer/protocol/auth/request-context";
import { HostClient, type IHostQueryInvalidator } from "@traycer-clients/shared/host-client/host-client";
import { MockHostMessenger, type MockHandlerMap } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import { mockInProcessHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { HostStreamConnection, StreamConnectionStateStore } from "@/host/stream-connection";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { HostClientProvider, type MobileHostClient } from "@/host/host-client-context";
import { ChatView } from "@/views/chat-view";

type SnapshotFrame = Extract<ChatSubscribeServerFrame, { readonly kind: "snapshot" }>;

const EPIC_ID = "layout-repro-epic";
const CHAT_ID = "layout-repro-chat";

export interface ReproScenario {
  /** One entry per pending interview card, each entry is that interview's question count. */
  readonly interviews?: readonly number[];
  readonly approvalCount?: number;
  readonly fileEditCount?: number;
  /**
   * One entry per accumulated file change, given as its `filePath`. The paths
   * are the scenario rather than a detail the fixture picks: the Review-all
   * jump rail exists to tell deep paths under a common root apart, so the
   * caller supplies the exact shape it wants measured.
   *
   * These arrive through the real `useChat` reducer (`snap.accumulatedFileChanges`),
   * so this also exercises the wire → props → `LowerDock` → panel → sheet hop
   * that a component-only harness rendering `ReviewAllSheet` directly skips.
   */
  readonly fileChanges?: readonly string[];
  /**
   * M3 — caret-restoration measurement (`measure.mjs`'s `measureCaretAfterPick`)
   * needs a BOUND chat: `@` hides itself entirely when `mentionRoots` is empty
   * (composer.tsx's own honest-absence rule — see `mentionTrigger`), so
   * reaching `MentionSheet` at all requires at least one root. One entry,
   * `isPrimary: true`, is enough; the primary/secondary token classification
   * in `mention-model.ts` is unit-tested elsewhere and not this harness's job.
   */
  readonly boundRoot?: string;
}

function interviewMessage(blockId: string, questionCount: number): object {
  return {
    role: "assistant",
    messageId: `msg-${blockId}`,
    sender: { type: "agent", harnessId: "claude", agentId: "layout-repro", displayName: null },
    startedAt: null,
    timestamp: 0,
    turnId: null,
    usage: null,
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

/**
 * One accumulated file change per path.
 *
 * The diff is deliberately several lines rather than one: with a one-line diff
 * all twelve sections fit on a phone screen at once, and "tapping chip N brings
 * section N into view" then passes against a jump-list that does NOTHING —
 * every section is already in view. The fixture has to make the stack taller
 * than the viewport or the measurement cannot fail.
 */
function accumulatedFileChange(filePath: string, index: number): object {
  const before = Array.from({ length: 6 }, (_, i) => `line ${String(i + 1)} of ${filePath}`);
  const after = before.map((line, i) =>
    i % 2 === 0 ? `${line} — rewritten by change ${String(index + 1)}` : line,
  );
  return {
    filePath,
    operation: "edit",
    diffSource: "snapshot",
    beforeContent: `${before.join("\n")}\n`,
    afterContent: `${after.join("\n")}\n`,
    reason: "snapshot",
    undoable: true,
    artifact: null,
  };
}

/**
 * Validated through the REAL wire-protocol schema (`.parse`, not an
 * assertion) — `ChatSubscribeServerFrame`'s snapshot variant is a large,
 * versioned, discriminated union; the fields this harness doesn't care
 * about (`turnId`, `usage`, …) get real defaults from the schema itself
 * instead of being hand-typed for a case that's irrelevant to a layout
 * test. A malformed fixture throws here, loudly, at the call site — never
 * silently mistyped past a cast.
 */
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

  const frame = chatSubscribeServerFrameSchema.parse({
    kind: "snapshot",
    hasBinaryPayload: false,
    epicId: EPIC_ID,
    chatId: CHAT_ID,
    snapshot: {
      // Idle, not running — the composer shows Send (not Stop), matching
      // the reported scenario: the agent stopped to ask and the user is
      // trying to type a reply or send a new message.
      runStatus: "idle",
      chat: {
        id: CHAT_ID,
        parentId: null,
        userId: "u1",
        hostId: "layout-repro-host",
        title: "Layout repro",
        messages,
        settings: null,
        createdAt: 0,
        updatedAt: 0,
        isTitleEditedByUser: false,
      },
      access: { role: "owner", ownerUserId: "u1", canAct: true },
      queue: { status: "idle", items: [] },
      pendingApprovals,
      pendingFileEditApprovals,
      pendingInterviews,
      accumulatedFileChanges: (scenario.fileChanges ?? []).map(accumulatedFileChange),
      activeTurn: null,
      worktreeBinding:
        scenario.boundRoot === undefined
          ? null
          : {
              entries: [
                {
                  workspacePath: scenario.boundRoot,
                  mode: "local",
                  repoIdentifier: null,
                  worktreePath: null,
                  branch: null,
                  isPrimary: true,
                  isImported: false,
                  setupState: "not_required",
                  setupTerminalSessionId: null,
                  setupExitCode: null,
                  setupFailedAt: null,
                  createdAt: 0,
                },
              ],
            },
      missingWorktreePaths: [],
    },
  });
  if (frame.kind !== "snapshot") throw new Error("unreachable — just built a snapshot frame");
  return frame;
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

/**
 * Fixed catalogue for `/`, deliberately three names sharing the `ponytail-`
 * prefix rather than one — a single command makes "the sheet picked what the
 * query matched" indistinguishable from "the sheet picked the only thing it
 * had" (verification-practices #1: a fixture with one of a kind cannot
 * discriminate identity from luck).
 */
const FAKE_COMMANDS: readonly GuiAgentCommandOption[] = [
  { harnessId: "claude", name: "ponytail-help", description: "Quick-reference card for ponytail.", argumentHint: null, kind: "skill", metadata: {} },
  { harnessId: "claude", name: "ponytail-review", description: "Review for over-engineering.", argumentHint: null, kind: "skill", metadata: {} },
  { harnessId: "claude", name: "ponytail-gain", description: "Show ponytail's measured impact.", argumentHint: null, kind: "skill", metadata: {} },
];

/** Two files, same reason as `FAKE_COMMANDS`: one entry cannot tell "the right row" from "the only row". */
function fakeMentionFiles(root: string): readonly WorkspaceFileMentionSuggestion[] {
  return [
    { kind: "file", id: "f1", label: "app.ts", relPath: "src/app.ts", absolutePath: `${root}/src/app.ts`, workspacePath: root, description: "" },
    { kind: "file", id: "f2", label: "util.ts", relPath: "src/util.ts", absolutePath: `${root}/src/util.ts`, workspacePath: root, description: "" },
  ];
}

interface FakeHostClient {
  readonly client: MobileHostClient;
  /** `setScenario` calls this before pushing the snapshot, so the RPC handlers below see the new binding before any effect they trigger re-fires. */
  setBoundRoot(root: string | null): void;
}

/** No repro run needs cache invalidation — nothing here is TanStack-Query-backed. */
const noopInvalidator: IHostQueryInvalidator = {
  invalidateHostScope: () => undefined,
};

/**
 * A REAL `HostClient<HostRpcRegistry>`, bound to `MockHostMessenger` — the
 * same in-memory messenger `gui-app`'s dev/preview flows and
 * `host-client.test.ts` use, not a hand-rolled duck-type. This is what lets
 * `LayoutReproView` hand `HostClientProvider` a value of the exact type it
 * expects with no cast: the mobile eslint gate bans `as unknown`/chained
 * assertions in `src/` outright (no test-file exemption here), so a plain
 * object literal standing in for the class was never an option.
 *
 * Answers exactly the two RPCs the caret measurement drives —
 * `agent.gui.listCommands` and `workspace.mentionFiles` (`mentionFolders` is
 * asked alongside it and answered empty, so folders never appear and the
 * file rows above stay unambiguous). Every other method this composer's
 * other hooks may call (`agent.gui.listHarnesses`, `agent.gui.listModels`,
 * `providers.list`) has no handler — `MockHostMessenger` rejects those with
 * `RPC_ERROR`, which each hook already turns into its own error phase
 * (`useGuiHarnesses`, `useGuiModels`, `useProviders`), the same "unknown"
 * state a real host's cold read produces, not a crash.
 */
function createFakeHostClient(): FakeHostClient {
  let boundRoot: string | null = null;
  const handlers: MockHandlerMap<HostRpcRegistry> = {
    "agent.gui.listCommands": (params) => ({
      harnessId: params.harnessId,
      commands: [...FAKE_COMMANDS],
    }),
    "workspace.mentionFiles": (params) => {
      const files = boundRoot === null ? [] : fakeMentionFiles(boundRoot);
      const needle = params.query.toLowerCase();
      const matched = files.filter(
        (f) => params.roots.includes(f.workspacePath) && (needle === "" || f.relPath.toLowerCase().includes(needle)),
      );
      return { entries: matched.slice(0, params.limit) };
    },
    "workspace.mentionFolders": () => ({ entries: [] }),
  };
  let requestCounter = 0;
  const messenger = new MockHostMessenger<HostRpcRegistry>({
    registry: hostRpcRegistry,
    handlers,
    requestId: () => {
      requestCounter += 1;
      return `layout-repro-${String(requestCounter)}`;
    },
  });
  const client = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    messenger,
    invalidator: noopInvalidator,
  });
  client.bind(mockInProcessHostEntry);
  client.setRequestContext(
    createRequestContext({
      identity: { userId: "layout-repro-user", username: "layout-repro-user", providerHandle: null },
      bearerToken: "layout-repro-token",
      origin: "renderer",
      connectionId: undefined,
      operationId: undefined,
      externalAbortSignal: undefined,
    }),
  );
  return {
    client,
    setBoundRoot: (root) => {
      boundRoot = root;
    },
  };
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
  // `openChat` is called from `ChatView`'s own `useChat` effect (a CHILD
  // effect, committed before this component's), which is where the fake
  // connection actually hands back its callbacks — asynchronous relative to
  // this component's render, so captured via a state setter (safe to call
  // from anywhere) rather than a ref (flagged as accessed-during-render by
  // static analysis, since the closure that calls it is itself created
  // inside the `useState` lazy initializer, which runs during render).
  const [callbacks, setCallbacks] = useState<ChatStreamCallbacks | null>(null);
  const [connection] = useState<HostStreamConnection>(() => createFakeConnection(setCallbacks));
  const [hostClient] = useState<FakeHostClient>(() => createFakeHostClient());

  useEffect(() => {
    if (callbacks === null) return;
    window.__layoutRepro = {
      ready: true,
      setScenario: (scenario: ReproScenario) => {
        // Set before pushing the snapshot: the new `worktreeBinding` triggers
        // `useMentionFiles`'s canary effect on this same commit, and it must
        // see the updated root, not the previous one.
        hostClient.setBoundRoot(scenario.boundRoot ?? null);
        callbacks.onSnapshot(snapshotFrame(scenario));
      },
    };
    callbacks.onSnapshot(snapshotFrame({ interviews: [2] }));
    return () => {
      delete window.__layoutRepro;
    };
  }, [callbacks, hostClient]);

  return (
    <HostClientProvider client={hostClient.client}>
      <StreamConnectionProvider connection={connection}>
        <ChatView epicId={EPIC_ID} chatId={CHAT_ID} initialTitle={null} onTitleChange={() => {}} />
      </StreamConnectionProvider>
    </HostClientProvider>
  );
}
