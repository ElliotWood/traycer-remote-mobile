import { randomUUID } from "node:crypto";
import {
  hostRpcRegistry,
  hostStreamRpcRegistry,
} from "@traycer/protocol/host/registry";
import { hostNotificationsSubscribeServerFrameSchema } from "@traycer/protocol/host/notifications/host-notifications";
import {
  WsRpcClient,
  HOST_POST_OPEN_ATTESTATION_WINDOW_MS,
} from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import type { IStreamSession } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { ProactiveRefreshScheduler } from "@traycer-clients/shared/auth/token-refresh-scheduler";
import { withTransientRetry } from "./transient-retry";
import { createNodeWebSocketFactory } from "@traycer-clients/shared/host-transport/node-ws-factory";
import { createNodeStreamWebSocketFactory } from "@traycer-clients/shared/host-transport/node-ws-stream-factory";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import {
  createProactiveRefreshScheduler,
  DEFAULT_REFRESH_LEAD_MS,
  DEFAULT_REFRESH_MIN_DELAY_MS,
} from "@traycer-clients/shared/auth/token-refresh-scheduler";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";
import type { ChatRunSettings } from "@traycer/protocol/host/agent/gui/subscribe";
import type { Transcript } from "./transcript-projection";
import { ChatSession } from "./chat-session";
import { HostEndpointPoller } from "./host-endpoint";
import {
  resolveHostAuth,
  isHostAuthUnavailable,
  type HostAuth,
} from "./host-auth";
import type { ILogger } from "./logger";
import type {
  ActionOutcome,
  AgentSummary,
  ChatStatus,
  RemoteBridgeActions,
} from "./action-surface";

const OPEN_ACK_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 60_000;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const RPC_FRAME_TIMEOUT_MS = 15_000;
const NOTIFICATIONS_INITIAL_LIMIT = 50;
const FIND_APPROVAL_TIMEOUT_MS = 8_000;
const FIND_APPROVAL_POLL_MS = 250;
/** Delay before the one bounded retry of a host-classified-transient unary RPC failure (see `requestWithTransientRetry`). */
const TRANSIENT_RETRY_DELAY_MS = 1_000;
/**
 * Default harness for a chat this bridge starts with no settings of its own
 * yet (`create-chat` mints a chat with `settings: null`). Chosen because it is
 * a member of both `guiHarnessIdSchema` (what a chat's settings accept) and
 * `agentFacingHarnessIdSchema` (what `agent.listHarnessModels` accepts) — the
 * intersection is what makes it usable on both sides of this resolution.
 */
const DEFAULT_HARNESS = "claude";
/** `supervised` routes tool/file-edit approvals back to a human — the mode every adapter on top of this bridge (Teams, D3 CLI) expects by default. */
const DEFAULT_PERMISSION_MODE = "supervised";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Long-running bridge process: holds `host.notifications.feed.subscribe` (to
 * discover chats needing attention without polling) and a `chat.subscribe`
 * session per chat it has been asked to act on. Implements
 * {@link RemoteBridgeActions} — the entire surface a channel adapter uses.
 */
export class BridgeClient implements RemoteBridgeActions {
  /**
   * The epic this bridge process is bound to, for the whole of its life.
   *
   * Public because an adapter has to stamp it onto what it emits — a
   * `watch` event names its epic — and re-resolving `--epic-id`/
   * `$TRAYCER_EPIC_ID` at the call site would put the binding decision in two
   * places that could disagree. Read-only: nothing rebinds a running bridge.
   */
  readonly epicId: string;
  private readonly senderAgentId: string;
  private readonly auth: HostAuth;
  private readonly endpointPoller: HostEndpointPoller;
  private readonly rpcClient: WsRpcClient<typeof hostRpcRegistry>;
  private readonly streamClient: WsStreamClient<typeof hostStreamRpcRegistry>;
  private readonly logger: ILogger;
  private readonly chatSessions = new Map<string, ChatSession>();
  private readonly refreshScheduler: ProactiveRefreshScheduler;
  private notificationsSession: IStreamSession | null = null;
  private disposed = false;

  private constructor(opts: {
    readonly epicId: string;
    readonly senderAgentId: string;
    readonly auth: HostAuth;
    readonly endpointPoller: HostEndpointPoller;
    readonly logger: ILogger;
  }) {
    this.epicId = opts.epicId;
    this.senderAgentId = opts.senderAgentId;
    this.auth = opts.auth;
    this.endpointPoller = opts.endpointPoller;
    this.logger = opts.logger;

    this.rpcClient = new WsRpcClient({
      registry: hostRpcRegistry,
      requestId: () => randomUUID(),
      webSocketFactory: createNodeWebSocketFactory(),
      dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
      frameTimeoutMs: RPC_FRAME_TIMEOUT_MS,
      hostAttestationWindowMs: HOST_POST_OPEN_ATTESTATION_WINDOW_MS,
    });

    this.streamClient = new WsStreamClient({
      registry: hostStreamRpcRegistry,
      endpoint: () => this.endpointPoller.get(),
      bearer: () => this.auth.lease,
      // This class owns UNAUTHORIZED recovery itself (see `ChatSession`'s
      // `recoverFromUnauthorized` and the notifications-feed handling
      // below) — the same reason `traycer monitor` passes `auth: null`.
      auth: null,
      // No delegated host-credential-provisioning policy - see the matching
      // note in clients/shared/host-transport/single-host-stream-connection.ts.
      hostCredentialMint: null,
      webSocketFactory: createNodeStreamWebSocketFactory(),
      dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
      openAckTimeoutMs: OPEN_ACK_TIMEOUT_MS,
      pingIntervalMs: PING_INTERVAL_MS,
      pongTimeoutMs: PONG_TIMEOUT_MS,
      initialBackoffMs: INITIAL_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
    });

    this.refreshScheduler = createProactiveRefreshScheduler<NodeJS.Timeout>({
      getToken: () => {
        try {
          return this.auth.lease.getBearerToken();
        } catch {
          return null;
        }
      },
      revalidate: async () => {
        const outcome = await this.auth.revalidate();
        if (outcome === "rotated") {
          this.streamClient.notifyBearerRotated();
        }
        return outcome;
      },
      now: () => Date.now(),
      setTimer: (handler, ms) => setTimeout(handler, ms),
      clearTimer: (handle) => clearTimeout(handle),
      leadMs: DEFAULT_REFRESH_LEAD_MS,
      minDelayMs: DEFAULT_REFRESH_MIN_DELAY_MS,
      onDiagnostic: (message) => this.logger.debug(message, null),
    });
    this.refreshScheduler.start();

    this.openNotificationsFeed();
  }

  static async start(opts: {
    readonly epicId: string;
    readonly senderAgentId: string;
    readonly logger: ILogger;
  }): Promise<BridgeClient> {
    const resolved = await resolveHostAuth();
    if (isHostAuthUnavailable(resolved)) {
      // Self-diagnosing: names the exact path that came up empty, so a
      // `HOME` misconfiguration (the single most likely failure on a
      // multi-tenant deployment) is not indistinguishable from a genuinely
      // signed-out user telling an operator to `traycer login` when the
      // real problem is that `HOME` resolved somewhere with no credentials
      // file at all.
      throw new Error(
        `remote-bridge: no credentials at ${resolved.credentialsPath} - ` +
          "run `traycer login` to authenticate, or check that HOME resolved " +
          "to the intended identity's directory.",
      );
    }
    const auth = resolved;
    // Greppable identity record, per docs/multi-tenant-deployment.md §3(b):
    // on a deployment where every bridge process shares one OS user
    // (separate HOMEs only), this is the process's own attestation of which
    // tenant it resolved as, logged before any host/RPC work begins.
    opts.logger.info("identity resolved", {
      userId: auth.userId,
      home: auth.home,
    });
    const endpointPoller = await HostEndpointPoller.start(opts.logger);
    return new BridgeClient({
      epicId: opts.epicId,
      senderAgentId: opts.senderAgentId,
      auth,
      endpointPoller,
      logger: opts.logger,
    });
  }

  async listAgents(): Promise<readonly AgentSummary[]> {
    const endpoint = this.endpointPoller.get();
    if (endpoint === null) {
      throw new Error("remote-bridge: no host endpoint available yet");
    }
    const response = await withTransientRetry({
      label: "agent.list",
      call: () =>
        this.rpcClient.request(
          "agent.list",
          {
            epicId: this.epicId,
            senderAgentId: this.senderAgentId,
            scope: "user",
          },
          {
            endpoint,
            bearer: this.auth.lease,
            abortSignal: new AbortController().signal,
          },
        ),
      onDiagnostic: (message) => this.logger.warn(message, null),
      delayMs: TRANSIENT_RETRY_DELAY_MS,
    });
    return response.agents.map((a) => ({
      agentId: a.id,
      title: a.title,
      harnessId: a.harnessId,
      surface: a.surface,
      active: a.active,
      // Carried, not dropped. `active` is documented LOCAL-ONLY — it is
      // `false` for every cross-host row regardless of what that agent is
      // doing — so without `isLocal` a caller cannot tell "idle" from "I
      // cannot see this agent's state", and renders a whole remote fleet as
      // idle. `hostId` names WHICH host, so the distinction is explicable
      // rather than just flagged.
      isLocal: a.isLocal,
      hostId: a.hostId,
      // Carried for the same reason as `isLocal`: without it a caller cannot
      // tell "this host cannot SEE that agent" from "this host cannot REACH
      // it". Those are different facts and only one of them makes a row
      // useless.
      capabilities: {
        readTranscript: a.capabilities.readTranscript,
        sendMessage: a.capabilities.sendMessage,
      },
    }));
  }

  async getStatus(chatId: string): Promise<ChatStatus> {
    return this.ensureChatSession(chatId).getStatus();
  }

  async approve(chatId: string, approvalId: string): Promise<ActionOutcome> {
    return this.ensureChatSession(chatId).approve(approvalId);
  }

  async reject(
    chatId: string,
    approvalId: string,
    reason: string | null,
  ): Promise<ActionOutcome> {
    return this.ensureChatSession(chatId).reject(approvalId, reason);
  }

  async answerInterview(
    chatId: string,
    blockId: string,
    answers: readonly InterviewAnswer[],
  ): Promise<ActionOutcome> {
    return this.ensureChatSession(chatId).answerInterview(blockId, answers);
  }

  async sendMessage(chatId: string, text: string): Promise<ActionOutcome> {
    return this.ensureChatSession(chatId).sendMessage(text);
  }

  /**
   * Shaped like {@link listAgents}, deliberately: same unary client, same
   * endpoint poll, same bearer lease, same transient retry. A create is not a
   * reason to invent a second mechanism for reaching the host.
   *
   * NOT routed through `ensureChatSession` — that opens a stream subscription
   * for a chat, and this is the call that brings the chat into existence.
   * Asking for a session first would subscribe to something that does not
   * exist yet, which the host answers with `connected: false` and a null
   * title: a plausible-looking status for a chat nobody made. That is exactly
   * the defect a real user hit with `say hi`.
   */
  async createChat(input: {
    readonly chatId: string;
    readonly title: string;
    readonly hostId: string;
    readonly parentId?: string | null;
  }): Promise<{ readonly chatId: string }> {
    const endpoint = this.endpointPoller.get();
    if (endpoint === null) {
      throw new Error("remote-bridge: no host endpoint available yet");
    }
    const response = await withTransientRetry({
      label: "epic.createChat",
      call: () =>
        this.rpcClient.request(
          "epic.createChat",
          {
            epicId: this.epicId,
            parentId: input.parentId ?? null,
            hostId: input.hostId,
            title: input.title,
            // Client-supplied and idempotent — see the action-surface
            // docblock. The retry below is safe ONLY because this id is
            // fixed by the caller and does not change between attempts.
            chatId: input.chatId,
          },
          {
            endpoint,
            bearer: this.auth.lease,
            abortSignal: new AbortController().signal,
          },
        ),
      onDiagnostic: (message) => this.logger.warn(message, null),
      delayMs: TRANSIENT_RETRY_DELAY_MS,
    });
    // Trust the host's id over the one we sent: identical today, and if they
    // ever diverge the host's is the real one.
    return { chatId: response.chatId };
  }

  /**
   * Delete a chat — the only destructive verb on this client.
   *
   * NO TRANSIENT RETRY, and that is the difference from `createChat` directly
   * above. A retried create is absorbed by the host's dedupe on the
   * client-supplied `chatId`, so resending is free. A retried delete has no
   * such property: the second attempt addresses a chat that no longer exists,
   * and the honest answers to "did my delete land" and "did someone else's"
   * are indistinguishable from here. An unconfirmed delete is reported as
   * unconfirmed and handed back to the caller — the same rule the approval
   * actions follow, for the same reason.
   *
   * The caller is expected to have confirmed WHICH chat this is. The id alone
   * carries no evidence, and `epic.deleteChat` will delete whatever it is
   * given.
   */
  async deleteChat(chatId: string): Promise<{ readonly deleted: boolean }> {
    const endpoint = this.endpointPoller.get();
    if (endpoint === null) {
      throw new Error("remote-bridge: no host endpoint available yet");
    }
    const response = await this.rpcClient.request(
      "epic.deleteChat",
      { epicId: this.epicId, chatId },
      {
        endpoint,
        bearer: this.auth.lease,
        abortSignal: new AbortController().signal,
      },
    );
    return { deleted: response.deleted };
  }

  async getTranscript(
    chatId: string,
    offset: number,
    limit: number,
  ): Promise<Transcript> {
    return this.ensureChatSession(chatId).getTranscript(offset, limit);
  }

  /**
   * NOT part of {@link RemoteBridgeActions} — a convenience for the D3 CLI
   * adapter only, which (per the brief) addresses an approval by id alone.
   * A channel adapter with its own chat context has no need for this;
   * searches only the chats the bridge is already tracking (via
   * `listAgents`/`getStatus`/the notifications feed), not the whole epic.
   *
   * Bounded-retries for up to `FIND_APPROVAL_TIMEOUT_MS`: a bridge that just
   * started has an EMPTY `chatSessions` map until the notifications feed's
   * initial snapshot lands (asynchronous, not awaited by `start()`) — a
   * caller that queries immediately after startup would otherwise get a
   * false "not found" for an approval that predates the process, not
   * because it isn't pending, but because discovery hasn't caught up yet.
   */
  async findChatForApproval(approvalId: string): Promise<string | null> {
    const deadline = Date.now() + FIND_APPROVAL_TIMEOUT_MS;
    for (;;) {
      for (const [chatId, session] of this.chatSessions) {
        const status = await session.getStatus();
        if (status.pendingApprovals.some((a) => a.approvalId === approvalId)) {
          return chatId;
        }
      }
      if (Date.now() >= deadline) return null;
      await sleep(FIND_APPROVAL_POLL_MS);
    }
  }

  /** Graceful shutdown: nothing keeps the event loop alive after this returns. */
  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refreshScheduler.stop();
    this.endpointPoller.stop();
    for (const session of this.chatSessions.values()) session.close();
    this.chatSessions.clear();
    this.notificationsSession?.close();
    this.streamClient.close("bridge-shutdown");
    // Stops the credentials store's background commit-failed continuation
    // timer - without this a disposed bridge could still hold the process
    // open (or attempt a mutation after shutdown began).
    this.auth.dispose();
  }

  private ensureChatSession(chatId: string): ChatSession {
    let session = this.chatSessions.get(chatId);
    if (session === undefined) {
      session = new ChatSession({
        epicId: this.epicId,
        chatId,
        userId: this.auth.lease.identity.userId,
        wsStreamClient: this.streamClient,
        auth: this.auth,
        onDiagnostic: (message) => this.logger.debug(message, null),
        resolveDefaultSettings: () => this.resolveDefaultSettings(),
      });
      this.chatSessions.set(chatId, session);
    }
    return session;
  }

  /**
   * A concrete run-settings tuple for a chat that has none yet — see
   * `ChatSession`'s constructor docblock for why forwarding `null` onto the
   * wire silently drops the message instead of failing.
   *
   * Same shape as `listAgents`/`createChat`: one unary RPC through the
   * shared `rpcClient`, same endpoint poll, same bearer lease. `null` on any
   * failure to resolve (no endpoint, the RPC failing, or the harness listing
   * no models) — the caller refuses to send rather than guessing a slug.
   */
  private async resolveDefaultSettings(): Promise<ChatRunSettings | null> {
    const endpoint = this.endpointPoller.get();
    if (endpoint === null) return null;
    let response;
    try {
      response = await this.rpcClient.request(
        "agent.listHarnessModels",
        {
          epicId: this.epicId,
          senderAgentId: this.senderAgentId,
          harnessId: DEFAULT_HARNESS,
        },
        {
          endpoint,
          bearer: this.auth.lease,
          abortSignal: new AbortController().signal,
        },
      );
    } catch {
      return null;
    }
    const model = response.models[0]?.id;
    if (model === undefined || model.length === 0) return null;
    return {
      harnessId: DEFAULT_HARNESS,
      model,
      permissionMode: DEFAULT_PERMISSION_MODE,
      reasoningEffort: null,
      serviceTier: null,
      agentMode: "regular",
      profileId: null,
    };
  }

  /**
   * Discovers chats needing attention without polling: an `approval.
   * requested`/`interview.requested` notification entry opens (or reuses) a
   * `ChatSession` for that chat so it shows up in status/action calls
   * immediately, not only after a caller happens to ask about it.
   */
  private openNotificationsFeed(): void {
    const session = this.streamClient.subscribe(
      "host.notifications.feed.subscribe",
      {
        initialAttentionLimit: NOTIFICATIONS_INITIAL_LIMIT,
        initialRecentLimit: NOTIFICATIONS_INITIAL_LIMIT,
      },
    );
    this.notificationsSession = session;
    session.onServerFrame((envelope) => {
      const parsed =
        hostNotificationsSubscribeServerFrameSchema.safeParse(envelope);
      if (!parsed.success) return;
      const frame = parsed.data;
      const entries =
        frame.kind === "snapshot"
          ? [...frame.attention.entries, ...frame.recent.entries]
          : frame.kind === "upserted"
            ? [frame.entry]
            : frame.kind === "channelEmission"
              ? frame.rows
              : [];
      for (const entry of entries) {
        if (
          (entry.kind === "approval.requested" ||
            entry.kind === "interview.requested") &&
          entry.epicId === this.epicId &&
          entry.chatId !== null
        ) {
          this.ensureChatSession(entry.chatId);
        }
      }
    });
    session.onStatusChange((status, reason) => {
      if (
        status === "closed" &&
        reason !== null &&
        reason.kind === "fatalError" &&
        reason.details.code === "UNAUTHORIZED"
      ) {
        void this.recoverNotificationsAuth();
      }
    });
  }

  private async recoverNotificationsAuth(): Promise<void> {
    if (this.disposed) return;
    const outcome = await this.auth.revalidate();
    if (this.disposed) return;
    if (outcome === "rotated") {
      this.streamClient.notifyBearerRotated();
    }
    if (outcome !== "rejected") {
      this.openNotificationsFeed();
    }
  }
}
