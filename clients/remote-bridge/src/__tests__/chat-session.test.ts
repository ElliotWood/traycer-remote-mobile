import { describe, expect, it } from "vitest";
import { buildStreamManifest } from "@traycer/protocol/framework/stream-compat";
import { hostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import { mockLocalHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import type {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketOpenEvent,
} from "@traycer-clients/shared/host-transport/ws-factory";
import type {
  IStreamWebSocketFactory,
  StreamWebSocketLike,
  StreamWebSocketMessageEvent,
} from "@traycer-clients/shared/host-transport/ws-stream-factory";
import { ChatSession } from "../chat-session";
import type { HostAuth } from "../host-auth";

/**
 * Regression coverage for two bugs the live D2/D3 verification against a
 * real host caught (and a mock would not have): (1) `getStatus()` silently
 * dropping file-edit approvals from the merged `pendingApprovals` list, and
 * (2) a fresh session answering "not connected" before its first snapshot
 * had actually arrived, instead of waiting for a real answer. Both are
 * pinned here so a refactor - or a third approval kind - regresses loudly.
 */

class StubStreamWebSocket implements StreamWebSocketLike {
  onopen: ((event: WebSocketOpenEvent) => void) | null = null;
  onmessage: ((event: StreamWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;
  readonly textSent: string[] = [];

  send(data: string | Uint8Array): void {
    if (typeof data === "string") this.textSent.push(data);
  }
  close(): void {}
  fireOpen(): void {
    this.onopen?.({ type: "open" });
  }
  fireText(data: unknown): void {
    this.onmessage?.({ type: "text", data: JSON.stringify(data) });
  }
}

function makeFactory(): {
  readonly factory: IStreamWebSocketFactory;
  readonly sockets: StubStreamWebSocket[];
} {
  const sockets: StubStreamWebSocket[] = [];
  return {
    factory: {
      create: () => {
        const socket = new StubStreamWebSocket();
        sockets.push(socket);
        return socket;
      },
    },
    sockets,
  };
}

/** Completes the open/openAck handshake so the client emits its `subscribe` frame. */
function completeHandshake(socket: StubStreamWebSocket): void {
  socket.fireOpen();
  socket.fireText({
    kind: "openAck",
    manifest: buildStreamManifest(hostStreamRpcRegistry),
  });
}

function makeHostAuth(): HostAuth {
  return {
    lease: new MutableBearerLease("token-abc", "user-1"),
    userId: "user-1",
    home: "/fake/home",
    revalidate: async () => "network-error",
    dispose: () => {},
  };
}

const chatFixture = {
  parentId: null,
  id: "chat-1",
  userId: "user-1",
  hostId: "test-host",
  title: "Test chat",
  createdAt: 1000,
  updatedAt: 1000,
  isTitleEditedByUser: false,
  settings: {
    harnessId: "claude",
    model: "claude-sonnet-5",
    permissionMode: "supervised",
    reasoningEffort: null,
    serviceTier: null,
    agentMode: "regular",
    profileId: null,
  },
  activeSessionChain: null,
  claudePendingWakes: [],
  messages: [],
  events: [],
};

/**
 * An assistant row carrying `blocks`, for the interview-question tests.
 *
 * Deliberately NOT typed as `Message` and NOT cast: it is stringified onto
 * the wire and validated by the host's own
 * `chatSubscribeServerFrameSchema` inside `ChatSession`, so a fixture that
 * drifts from the protocol is rejected there rather than compiling into a
 * test that pins a shape the host cannot send. That is also why every test
 * below asserts `connected === true` first — a malformed frame is DROPPED,
 * and a dropped frame would otherwise present as "the questions weren't
 * resolved", which is the exact conclusion under test.
 */
function assistantMessageWithBlocks(blocks: readonly unknown[]) {
  return {
    role: "assistant",
    messageId: "msg-1",
    sender: {
      type: "agent",
      harnessId: "claude",
      agentId: "agent-1",
      displayName: null,
    },
    blocks,
    startedAt: 1000,
    timestamp: 1000,
    turnId: "turn-1",
    usage: null,
  };
}

function interviewBlock(overrides: {
  readonly blockId: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly questions?: readonly unknown[];
}) {
  return {
    blockId: overrides.blockId,
    status: "completed",
    timestamp: 1000,
    parentBlockId: null,
    type: "interview",
    toolName: "AskUser",
    title: overrides.title ?? "Pick a deployment target",
    description: overrides.description ?? "This decides the rollout order.",
    questions: overrides.questions ?? [
      {
        questionId: "q-1",
        question: "Which environment first?",
        header: null,
        options: [
          { label: "Staging", description: "safe", preview: null },
          { label: "Production", description: null, preview: null },
        ],
        multiSelect: false,
      },
    ],
    answers: [],
    error: null,
    metadata: null,
  };
}

function snapshotFrame(overrides: {
  readonly pendingApprovals?: readonly unknown[];
  readonly pendingFileEditApprovals?: readonly unknown[];
  readonly pendingInterviews?: readonly unknown[];
  readonly messages?: readonly unknown[];
}) {
  return {
    kind: "snapshot",
    hasBinaryPayload: false,
    epicId: "epic-1",
    chatId: "chat-1",
    snapshot: {
      chat: { ...chatFixture, messages: overrides.messages ?? [] },
      access: { role: "owner", ownerUserId: "user-1", canAct: true },
      queue: { status: "idle", items: [] },
      activeTurn: null,
      runStatus: "idle",
      pendingApprovals: overrides.pendingApprovals ?? [],
      pendingInterviews: overrides.pendingInterviews ?? [],
      pendingFileEditApprovals: overrides.pendingFileEditApprovals ?? [],
      worktreeBinding: null,
      missingWorktreePaths: [],
      accumulatedFileChanges: [],
    },
  };
}

function makeSession(factory: IStreamWebSocketFactory): {
  readonly session: ChatSession;
  readonly client: WsStreamClient<typeof hostStreamRpcRegistry>;
} {
  const client = new WsStreamClient({
    registry: hostStreamRpcRegistry,
    endpoint: () => mockLocalHostEntry,
    bearer: () => new MutableBearerLease("token-abc", "user-1"),
    auth: null,
    webSocketFactory: factory,
    dialTimeoutMs: 1000,
    openAckTimeoutMs: 1000,
    pingIntervalMs: 25_000,
    pongTimeoutMs: 50_000,
    initialBackoffMs: 10,
    maxBackoffMs: 1_000,
  });
  const session = new ChatSession({
    epicId: "epic-1",
    chatId: "chat-1",
    userId: "user-1",
    wsStreamClient: client,
    auth: makeHostAuth(),
  });
  return { session, client };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("ChatSession.getStatus", () => {
  it("does not answer 'not connected' before the first snapshot - it waits and then reports the real state", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);

    // getStatus() is called BEFORE any snapshot has arrived - it must not
    // resolve to a stale/false "connected: false" answer immediately. It
    // should still be pending once the handshake (but not the snapshot)
    // completes, and only resolve once the real snapshot lands.
    let resolved = false;
    const statusPromise = session.getStatus().then((status) => {
      resolved = true;
      return status;
    });

    await flush();
    completeHandshake(sockets[0]);
    await flush();

    expect(resolved).toBe(false); // handshake alone is not proof - still waiting for the snapshot

    sockets[0].fireText(
      snapshotFrame({
        pendingApprovals: [
          {
            approvalId: "tool-appr-1",
            toolName: "Bash",
            description: "run a command",
            input: null,
            requestedAt: 2000,
          },
        ],
      }),
    );

    const status = await statusPromise;
    expect(resolved).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.pendingApprovals).toEqual([
      {
        approvalId: "tool-appr-1",
        toolName: "Bash",
        description: "run a command",
        requestedAt: 2000,
      },
    ]);

    client.close("test-done");
  });

  it("surfaces both approval kinds - tool-call and file-edit - in the same pendingApprovals list", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);
    await flush();
    completeHandshake(sockets[0]);

    sockets[0].fireText(
      snapshotFrame({
        pendingApprovals: [
          {
            approvalId: "tool-appr-1",
            toolName: "Bash",
            description: "run a command",
            input: null,
            requestedAt: 2000,
          },
        ],
        pendingFileEditApprovals: [
          {
            approvalId: "file-appr-1",
            toolName: "Write",
            description: "write a file",
            paths: ["/tmp/x.txt"],
            operation: "create",
            input: null,
            requestedAt: 2001,
          },
        ],
      }),
    );

    const status = await session.getStatus();
    const ids = status.pendingApprovals.map((a) => a.approvalId).sort();
    // Both kinds present - the regression this pins is `getStatus()` only
    // ever surfacing one of the two internally-tracked lists.
    expect(ids).toEqual(["file-appr-1", "tool-appr-1"]);

    client.close("test-done");
  });

  it("fails with a clear reason rather than guessing when acting on an approval id that isn't currently pending", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);
    await flush();
    completeHandshake(sockets[0]);
    sockets[0].fireText(snapshotFrame({}));
    await session.getStatus();

    const outcome = await session.approve("unknown-id");
    expect(outcome).toEqual({
      kind: "failed",
      reason: "approval unknown-id is not currently pending on this chat",
    });

    client.close("test-done");
  });

  it("fails fast on a non-UNAUTHORIZED fatal close instead of waiting out a timeout for a session that will never recover", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);
    await flush();
    completeHandshake(sockets[0]);
    sockets[0].fireText(
      snapshotFrame({
        pendingApprovals: [
          {
            approvalId: "appr-inflight",
            toolName: "Bash",
            description: "run a command",
            input: null,
            requestedAt: 2000,
          },
        ],
      }),
    );
    await session.getStatus();

    // A pending action is in flight when the fatal close arrives - the
    // frame was sent but no ack (and no reconnect snapshot) will ever come.
    const pending = session.approve("appr-inflight");

    sockets[0].fireText({
      kind: "fatalError",
      details: {
        code: "INCOMPATIBLE",
        reason: "host/client protocol mismatch",
        incompatibleMethods: null,
        upgradeGuidance: null,
      },
    });

    // The in-flight action fails immediately - it does not wait out
    // ActionTracker's unconfirmed-timeout for a session that can never send
    // another frame.
    const pendingOutcome = await pending;
    expect(pendingOutcome.kind).toBe("failed");

    // A call issued AFTER termination also fails immediately, not after
    // waiting out `waitForFirstSnapshot`'s timeout.
    const afterOutcome = await session.sendMessage("hello");
    expect(afterOutcome).toMatchObject({ kind: "failed" });
    expect((afterOutcome as { reason: string }).reason).toContain(
      "chat session is disconnected",
    );

    client.close("test-done");
  });
});

/**
 * The `interviewRequested` frame carries `{ blockId, requestedAt }` and
 * nothing else — no questions. The questions live in the persisted
 * `interview` block, which this session already holds in
 * `snapshot.chat.messages` and used to discard. Until these landed, an
 * adapter could announce that an interview existed and could never render
 * one; the Teams bot's card said so in as many words.
 *
 * What each test pins is the null-vs-empty distinction, because collapsing
 * it puts a Submit button under zero questions and sends `answers: []` to an
 * agent that is waiting for a real answer.
 */
describe("ChatSession.getStatus - interview questions", () => {
  it("resolves a pending interview's title, description and questions from the snapshot's own messages", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);

    const statusPromise = session.getStatus();
    await flush();
    completeHandshake(sockets[0]);
    await flush();

    sockets[0].fireText(
      snapshotFrame({
        pendingInterviews: [{ blockId: "iv-1", requestedAt: 3000 }],
        messages: [
          assistantMessageWithBlocks([interviewBlock({ blockId: "iv-1" })]),
        ],
      }),
    );

    const status = await statusPromise;
    // CONTROL: a malformed fixture is dropped by the frame schema, and a
    // dropped frame looks exactly like "the questions did not resolve".
    expect(status.connected).toBe(true);

    expect(status.pendingInterviews).toEqual([
      {
        blockId: "iv-1",
        requestedAt: 3000,
        title: "Pick a deployment target",
        description: "This decides the rollout order.",
        questions: [
          {
            questionId: "q-1",
            question: "Which environment first?",
            header: null,
            options: [
              { label: "Staging", description: "safe", preview: null },
              { label: "Production", description: null, preview: null },
            ],
            multiSelect: false,
          },
        ],
      },
    ]);

    client.close("test-done");
  });

  it("reports questions as NULL - not [] - when the pending interview's block is absent from the snapshot", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);

    const statusPromise = session.getStatus();
    await flush();
    completeHandshake(sockets[0]);
    await flush();

    // A real state, not a contrived one: a snapshot taken mid-turn can name
    // a pending interview whose block has not landed in `chat.messages` yet.
    sockets[0].fireText(
      snapshotFrame({
        pendingInterviews: [{ blockId: "iv-missing", requestedAt: 4000 }],
        messages: [],
      }),
    );

    const status = await statusPromise;
    expect(status.connected).toBe(true);

    expect(status.pendingInterviews).toEqual([
      {
        blockId: "iv-missing",
        requestedAt: 4000,
        title: null,
        description: null,
        questions: null,
      },
    ]);
    // Stated separately from the deep-equal above so the failure message
    // names the distinction rather than printing two large objects.
    expect(status.pendingInterviews[0]?.questions).toBeNull();

    client.close("test-done");
  });

  it("reports questions as [] when the block IS present and genuinely asks nothing", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);

    const statusPromise = session.getStatus();
    await flush();
    completeHandshake(sockets[0]);
    await flush();

    sockets[0].fireText(
      snapshotFrame({
        pendingInterviews: [{ blockId: "iv-empty", requestedAt: 5000 }],
        messages: [
          assistantMessageWithBlocks([
            interviewBlock({ blockId: "iv-empty", questions: [] }),
          ]),
        ],
      }),
    );

    const status = await statusPromise;
    expect(status.connected).toBe(true);

    // `[]` and `null` are different answers: this one means "we read the
    // block", the other means "we never found it".
    expect(status.pendingInterviews[0]?.questions).toEqual([]);
    expect(status.pendingInterviews[0]?.questions).not.toBeNull();

    client.close("test-done");
  });

  it("does not read questions off a NON-interview block that happens to carry the same id", async () => {
    const { factory, sockets } = makeFactory();
    const { session, client } = makeSession(factory);

    const statusPromise = session.getStatus();
    await flush();
    completeHandshake(sockets[0]);
    await flush();

    // Block ids are unique per block, not per kind. Matching on the id alone
    // returns a block with no `questions` at all, which past a cast is
    // `undefined` at runtime rather than a type error.
    sockets[0].fireText(
      snapshotFrame({
        pendingInterviews: [{ blockId: "iv-2", requestedAt: 6000 }],
        messages: [
          assistantMessageWithBlocks([
            {
              blockId: "iv-2",
              status: "completed",
              timestamp: 1000,
              parentBlockId: null,
              type: "text",
              text: "not an interview",
            },
          ]),
        ],
      }),
    );

    const status = await statusPromise;
    expect(status.connected).toBe(true);

    expect(status.pendingInterviews[0]?.questions).toBeNull();
    expect(status.pendingInterviews[0]?.title).toBeNull();

    client.close("test-done");
  });
});
