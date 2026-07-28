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
    revalidate: async () => "unchanged",
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

function snapshotFrame(overrides: {
  readonly pendingApprovals?: readonly unknown[];
  readonly pendingFileEditApprovals?: readonly unknown[];
  readonly pendingInterviews?: readonly unknown[];
}) {
  return {
    kind: "snapshot",
    hasBinaryPayload: false,
    epicId: "epic-1",
    chatId: "chat-1",
    snapshot: {
      chat: chatFixture,
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
});
