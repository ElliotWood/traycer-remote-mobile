import { afterEach, describe, expect, it, vi } from "vitest";
import { WsRpcClient } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import type { IStreamSession } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { ChatRunSettings } from "@traycer/protocol/host/agent/gui/subscribe";
import { BridgeClient } from "../bridge-client";
import type { ILogger } from "../logger";

/**
 * The permission mode a chat is BROUGHT TO LIFE in, end to end through
 * `BridgeClient`.
 *
 * This path had no coverage at all, and the bug it guards is the one Elliot
 * hit live: an unattended Teams-dispatched assessment ran as `supervised`,
 * stopped at its first tool call and waited for a tap nobody was coming to
 * give. `875281d5` fixed it by threading `full_access` from the caller; that
 * thread runs `sendMessage` -> `ensureChatSession` -> `resolveDefaultSettings`
 * -> the `ChatRunSettings` handed to a brand-new chat, and **every hop of it
 * is silent when wrong**. A dropped argument does not throw, does not warn and
 * does not fail a type check — it produces a working chat in the wrong mode.
 *
 * So the assertions below are on the resolved settings OBJECT, not on the one
 * field: a whole-object `toEqual` also catches a hop that quietly drops
 * `model` or flips `agentMode`, which a `permissionMode`-only assertion would
 * sail past.
 *
 * `538632ff` then lifted the parameter onto {@link RemoteBridgeActions}, so
 * the shape is now stated where an adapter can read it. That is a contract
 * fix and it leaves the routing exactly as untested as it found it: a type
 * says the argument EXISTS, never that anything carries it to the far end.
 *
 * `ChatSession` is stubbed to capture the `resolveDefaultSettings` callback
 * injected into it. That callback is the real one — the transform under test
 * is `BridgeClient`'s own, and it is not mocked. What is mocked is only what
 * would otherwise reach the filesystem (credentials), a host process (the
 * endpoint poller) or a socket.
 */

const stub = vi.hoisted(() => ({
  /** One entry per `new ChatSession(...)`, in construction order. */
  sessions: [] as Array<{
    readonly chatId: string;
    readonly resolveDefaultSettings: () => Promise<ChatRunSettings | null>;
  }>,
}));

vi.mock("../chat-session", () => ({
  ChatSession: class {
    constructor(opts: {
      readonly chatId: string;
      readonly resolveDefaultSettings: () => Promise<ChatRunSettings | null>;
    }) {
      stub.sessions.push({
        chatId: opts.chatId,
        resolveDefaultSettings: opts.resolveDefaultSettings,
      });
    }
    async sendMessage(): Promise<{ kind: string }> {
      return { kind: "applied" };
    }
    close(): void {}
  },
}));

vi.mock("../host-auth", () => ({
  // A non-JWT bearer on purpose: `readAccessTokenExpiryMs` finds no `exp`,
  // so the proactive refresh scheduler disarms itself instead of leaving a
  // live timer behind every test.
  resolveHostAuth: async () => ({
    lease: new MutableBearerLease("token-abc", "user-1"),
    userId: "user-1",
    home: "/fake/home",
    revalidate: async () => "network-error",
    dispose: () => {},
  }),
  isHostAuthUnavailable: () => false,
}));

vi.mock("../host-endpoint", () => ({
  HostEndpointPoller: class {
    static async start(): Promise<unknown> {
      return new this();
    }
    get(): { hostId: string; websocketUrl: string } {
      return { hostId: "test-host", websocketUrl: "ws://127.0.0.1:1234/rpc" };
    }
    stop(): void {}
  },
}));

/** The one model `agent.listHarnessModels` offers; `resolveDefaultSettings` takes the first. */
const MODEL = "claude-sonnet-5";

function silentLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * The notifications feed the constructor opens. Inert on purpose — this test
 * is about what a SEND resolves, and a feed that delivered frames would open
 * chat sessions of its own and shift every index asserted below.
 */
function inertStreamSession(): IStreamSession {
  return {
    sendClientFrame: () => {},
    onServerFrame: () => {},
    onStatusChange: () => {},
    requestReconnect: () => {},
    close: () => {},
  };
}

/**
 * The single response `resolveDefaultSettings` reads. One assertion, on a
 * named type, rather than a chain: `request` is generic over the whole host
 * registry, so its per-method result type is not nameable at a spy boundary.
 */
type HarnessModelsResponse = { readonly models: readonly { id: string }[] };

async function startBridge(): Promise<BridgeClient> {
  vi.spyOn(WsStreamClient.prototype, "subscribe").mockReturnValue(
    inertStreamSession(),
  );
  const response: HarnessModelsResponse = { models: [{ id: MODEL }] };
  vi.spyOn(WsRpcClient.prototype, "request").mockResolvedValue(
    response as never,
  );
  return BridgeClient.start({
    epicId: "epic-1",
    senderAgentId: "agent-1",
    logger: silentLogger(),
  });
}

/** The settings the resolver produces for the chat opened by the Nth send. */
async function settingsForSession(
  index: number,
): Promise<ChatRunSettings | null> {
  const session = stub.sessions[index];
  if (session === undefined) {
    throw new Error(
      `no ChatSession was constructed at index ${index} — ` +
        `${stub.sessions.length} exist`,
    );
  }
  return session.resolveDefaultSettings();
}

afterEach(() => {
  stub.sessions.length = 0;
  vi.restoreAllMocks();
});

describe("BridgeClient permission-mode routing", () => {
  it("carries an explicit full_access through to the new chat's settings", async () => {
    const bridge = await startBridge();

    await bridge.sendMessage("chat-1", "run the assessment", "full_access");

    expect(await settingsForSession(0)).toEqual({
      harnessId: "claude",
      model: MODEL,
      permissionMode: "full_access",
      reasoningEffort: null,
      serviceTier: null,
      agentMode: "regular",
      profileId: null,
    });
  });

  it("falls back to supervised when the caller states no mode", async () => {
    const bridge = await startBridge();

    await bridge.sendMessage("chat-1", "hello", undefined);

    expect(await settingsForSession(0)).toEqual({
      harnessId: "claude",
      model: MODEL,
      permissionMode: "supervised",
      reasoningEffort: null,
      serviceTier: null,
      agentMode: "regular",
      profileId: null,
    });
  });

  /**
   * The control for the two rows above. Without it they agree with a
   * `BridgeClient` that ignores its argument and hardcodes one mode — the
   * `full_access` row would still be the only one that could fail, and a
   * reader could not tell a routed value from a constant.
   */
  it("routes per chat, so two chats opened by one bridge can differ", async () => {
    const bridge = await startBridge();

    await bridge.sendMessage("unattended", "go", "full_access");
    await bridge.sendMessage("interactive", "go", undefined);

    const [unattended, interactive] = await Promise.all([
      settingsForSession(0),
      settingsForSession(1),
    ]);
    expect(stub.sessions.map((s) => s.chatId)).toEqual([
      "unattended",
      "interactive",
    ]);
    expect(unattended?.permissionMode).toBe("full_access");
    expect(interactive?.permissionMode).toBe("supervised");
  });

  /**
   * Reaching an EXISTING chat must not re-decide the mode. `ensureChatSession`
   * returns the cached session, so the resolver captured at open time is the
   * one that stays wired — a second send that re-resolved would let a later
   * caller silently downgrade a running unattended chat.
   */
  it("does not re-open or re-decide the mode for a chat it already holds", async () => {
    const bridge = await startBridge();

    await bridge.sendMessage("chat-1", "first", "full_access");
    await bridge.sendMessage("chat-1", "second", undefined);

    expect(stub.sessions).toHaveLength(1);
    expect((await settingsForSession(0))?.permissionMode).toBe("full_access");
  });
});
