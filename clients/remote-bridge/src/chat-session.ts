import { randomUUID } from "node:crypto";
import {
  chatSubscribeServerFrameSchema,
  type ChatApprovalState,
  type ChatFileEditApprovalState,
  type ChatPendingInterviewState,
  type ChatRunStatus,
  type ChatSnapshot,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import type { IStreamSession } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import { ActionTracker, type ChatSnapshotView } from "./action-tracker";
import type { ActionOutcome, ChatStatus } from "./action-surface";
import type { HostAuth } from "./host-auth";

/** Delay before retrying a subscribe whose UNAUTHORIZED close could not be resolved (no rotation available). */
const AUTH_RETRY_DELAY_MS = 5_000;
/** How long a fresh session waits for its first real snapshot before a status/action call gives up rather than acting on data it never actually saw. */
const FIRST_SNAPSHOT_TIMEOUT_MS = 8_000;

/**
 * Owns one chat's `chat.subscribe` session end to end: tracks the live
 * snapshot, keeps `pendingApprovals`/`pendingInterviews` current from both
 * the snapshot and the incremental delta frames between snapshots, and
 * routes every outbound decision through {@link ActionTracker} so none of
 * them can be lost the way `WsStreamClient.sendClientFrame` alone can lose
 * one (see `action-tracker.ts`'s docblock).
 *
 * `connected` is deliberately NOT driven by the stream's `"open"` status
 * alone — `WsStreamClient` fires `"open"` right after sending the subscribe
 * frame, before the host has accepted it (the CLI's own `monitor.ts` notes
 * this: "`open` alone isn't proof"). This class only reports connected once
 * a real snapshot has landed on the CURRENT session, and drops it back to
 * `false` the instant the status leaves `"open"` — so a caller can never
 * observe a stale "connected: true" against a socket that is actually gone.
 */
export class ChatSession {
  readonly chatId: string;
  private readonly epicId: string;
  private readonly userId: string;
  private readonly wsStreamClient: WsStreamClient<HostStreamRpcRegistry>;
  private readonly auth: HostAuth;
  private session: IStreamSession;
  private readonly tracker: ActionTracker;
  private readonly onDiagnostic: (message: string) => void;
  private disposed = false;

  private snapshot: ChatSnapshot | null = null;
  private pendingApprovals: ChatApprovalState[] = [];
  private pendingFileEditApprovals: ChatFileEditApprovalState[] = [];
  private pendingInterviews: ChatPendingInterviewState[] = [];
  private runStatus: ChatRunStatus = "idle";
  private knownMessageIds = new Set<string>();
  private connected = false;
  private firstSnapshotWaiters: Array<() => void> = [];
  /**
   * Set on a fatal close this class does not know how to recover from (any
   * fatal code other than `UNAUTHORIZED` — e.g. `INCOMPATIBLE`; matches
   * `traycer monitor`'s "any non-UNAUTHORIZED fatal is terminal"). Once set,
   * every action/status call fails immediately instead of waiting out
   * `waitForFirstSnapshot`'s timeout or an `ActionTracker` entry's
   * unconfirmed-timeout for a session that will never send another frame -
   * "fail fast" rather than "fail eventually, after making the caller wait
   * for a snapshot that provably cannot arrive."
   */
  private terminated: string | null = null;

  constructor(opts: {
    readonly epicId: string;
    readonly chatId: string;
    readonly userId: string;
    readonly wsStreamClient: WsStreamClient<HostStreamRpcRegistry>;
    readonly auth: HostAuth;
    readonly onDiagnostic?: (message: string) => void;
  }) {
    this.chatId = opts.chatId;
    this.epicId = opts.epicId;
    this.userId = opts.userId;
    this.wsStreamClient = opts.wsStreamClient;
    this.auth = opts.auth;
    this.onDiagnostic = opts.onDiagnostic ?? (() => {});
    this.tracker = new ActionTracker({
      send: (frame, binaryPayload) =>
        this.session.sendClientFrame(frame, binaryPayload),
      onDiagnostic: this.onDiagnostic,
    });
    this.session = this.openSubscription();
  }

  /**
   * (Re)subscribes and wires handlers. Called from the constructor and again
   * whenever a fatal `UNAUTHORIZED` close is recovered from — `auth: null`
   * on the shared `WsStreamClient` (see `bridge-client.ts`) opts out of its
   * built-in stream-auth recovery, so this class owns the same
   * revalidate-then-resubscribe loop `traycer monitor` runs, generalized to
   * a dynamically-opened chat rather than one fixed subscription.
   */
  private openSubscription(): IStreamSession {
    const session = this.wsStreamClient.subscribe("chat.subscribe", {
      epicId: this.epicId,
      chatId: this.chatId,
    });
    session.onServerFrame((envelope) => {
      this.handleServerFrame(envelope);
    });
    session.onStatusChange((status, reason) => {
      if (status !== "open") {
        // Reconnecting or closed: whatever we last knew is now unverified.
        // Do NOT keep reporting connected/pending-state as current.
        this.connected = false;
      }
      if (status === "closed" && reason !== null && reason.kind === "fatalError") {
        if (reason.details.code === "UNAUTHORIZED") {
          void this.recoverFromUnauthorized();
        } else {
          // Non-UNAUTHORIZED fatal (e.g. INCOMPATIBLE): this class has no
          // recovery for it and none will be attempted - the session is
          // permanently dead. Fail fast rather than let callers discover
          // that the slow way, one timeout at a time.
          this.terminate(
            `chat.subscribe closed fatally (${reason.details.code}): ${reason.details.reason}`,
          );
        }
      }
    });
    return session;
  }

  /** Fails every outstanding tracked action immediately and marks the session dead so future calls fail fast instead of waiting out a timeout that can never resolve favorably. */
  private terminate(reason: string): void {
    if (this.terminated !== null) return;
    this.terminated = reason;
    this.onDiagnostic(`chat ${this.chatId}: terminated - ${reason}`);
    this.tracker.failAllPending(`chat session is disconnected: ${reason}`);
    if (this.firstSnapshotWaiters.length > 0) {
      const waiters = this.firstSnapshotWaiters;
      this.firstSnapshotWaiters = [];
      for (const waiter of waiters) waiter();
    }
  }

  private async recoverFromUnauthorized(): Promise<void> {
    if (this.disposed) return;
    const outcome = await this.auth.revalidate();
    if (this.disposed) return;
    if (outcome === "rejected") {
      // Terminal per the locked store's own mapping: the file is gone
      // (concurrent logout), a sign-out stands, or the refresh token is
      // dead. No amount of retrying recovers this without a fresh login.
      this.onDiagnostic(
        `chat ${this.chatId}: credentials rejected - run \`traycer login\``,
      );
      return;
    }
    if (outcome === "rotated") {
      this.onDiagnostic(`chat ${this.chatId}: bearer rotated - resubscribing`);
      this.wsStreamClient.notifyBearerRotated();
      this.session = this.openSubscription();
      return;
    }
    // "network-error": a transient refresh transport blip or a lock held past
    // the wait budget by a concurrent Desktop/CLI mutation - neither is a
    // dead credential. Retry after a delay rather than giving up.
    this.onDiagnostic(
      `chat ${this.chatId}: still unauthorized after a refresh attempt - retrying in ${String(AUTH_RETRY_DELAY_MS)}ms`,
    );
    setTimeout(() => {
      if (this.disposed) return;
      this.session = this.openSubscription();
    }, AUTH_RETRY_DELAY_MS);
  }

  /**
   * Resolves once this session has seen its first real snapshot, or
   * `timeoutMs` elapses. A fresh (or freshly-reconnected) session's
   * `chat.subscribe` handshake is asynchronous — without this, a caller
   * that queries or acts immediately after `ChatSession` construction would
   * see `connected: false` / empty pending lists that are merely "not
   * loaded yet", not a true absence.
   */
  private waitForFirstSnapshot(
    timeoutMs: number = FIRST_SNAPSHOT_TIMEOUT_MS,
  ): Promise<void> {
    if (this.snapshot !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.firstSnapshotWaiters.indexOf(onReady);
        if (idx !== -1) this.firstSnapshotWaiters.splice(idx, 1);
        resolve();
      }, timeoutMs);
      const onReady = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.firstSnapshotWaiters.push(onReady);
    });
  }

  async getStatus(): Promise<ChatStatus> {
    await this.waitForFirstSnapshot();
    return {
      chatId: this.chatId,
      title: this.snapshot?.chat.title ?? null,
      runStatus: this.runStatus,
      // Tool-call approvals and file-edit approvals are tracked separately
      // (they route through different wire actions - `approvalDecision` vs
      // `fileEditApprovalDecision`, see `decide()`), but the surface unifies
      // them: a caller acting on `approve`/`reject` never needs to know
      // which kind an approval id is.
      pendingApprovals: [
        ...this.pendingApprovals.map((a) => ({
          approvalId: a.approvalId,
          toolName: a.toolName,
          description: a.description,
          requestedAt: a.requestedAt,
        })),
        ...this.pendingFileEditApprovals.map((a) => ({
          approvalId: a.approvalId,
          toolName: a.toolName,
          description: a.description,
          requestedAt: a.requestedAt,
        })),
      ],
      pendingInterviews: this.pendingInterviews.map((i) => ({
        blockId: i.blockId,
        requestedAt: i.requestedAt,
      })),
      connected: this.connected,
    };
  }

  async approve(approvalId: string): Promise<ActionOutcome> {
    return this.decide(approvalId, { approved: true });
  }

  async reject(approvalId: string, reason?: string): Promise<ActionOutcome> {
    return this.decide(approvalId, { approved: false, reason });
  }

  private async decide(
    approvalId: string,
    decision: { readonly approved: boolean; readonly reason?: string },
  ): Promise<ActionOutcome> {
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    await this.waitForFirstSnapshot();
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    if (this.snapshot === null) {
      return { kind: "failed", reason: "not connected yet - no snapshot observed" };
    }
    const isToolApproval = this.pendingApprovals.some(
      (a) => a.approvalId === approvalId,
    );
    const isFileEditApproval = this.pendingFileEditApprovals.some(
      (a) => a.approvalId === approvalId,
    );
    if (!isToolApproval && !isFileEditApproval) {
      return {
        kind: "failed",
        reason: `approval ${approvalId} is not currently pending on this chat`,
      };
    }
    const clientActionId = randomUUID();
    const kind = isFileEditApproval ? "fileEditApprovalDecision" : "approvalDecision";
    return this.tracker.issue({
      clientActionId,
      frame: {
        kind,
        hasBinaryPayload: false,
        epicId: this.epicId,
        chatId: this.chatId,
        clientActionId,
        approvalId,
        decision,
      },
      isSettled: (view) => !view.pendingApprovalIds.has(approvalId),
    });
  }

  async answerInterview(
    blockId: string,
    answers: readonly InterviewAnswer[],
  ): Promise<ActionOutcome> {
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    await this.waitForFirstSnapshot();
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    if (this.snapshot === null) {
      return { kind: "failed", reason: "not connected yet - no snapshot observed" };
    }
    if (!this.pendingInterviews.some((i) => i.blockId === blockId)) {
      return {
        kind: "failed",
        reason: `interview ${blockId} is not currently pending on this chat`,
      };
    }
    const clientActionId = randomUUID();
    return this.tracker.issue({
      clientActionId,
      frame: {
        kind: "interviewAnswer",
        hasBinaryPayload: false,
        epicId: this.epicId,
        chatId: this.chatId,
        clientActionId,
        blockId,
        answers,
      },
      isSettled: (view) => !view.pendingInterviewBlockIds.has(blockId),
    });
  }

  async sendMessage(text: string): Promise<ActionOutcome> {
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    await this.waitForFirstSnapshot();
    if (this.terminated !== null) {
      return { kind: "failed", reason: `chat session is disconnected: ${this.terminated}` };
    }
    if (this.snapshot === null) {
      return { kind: "failed", reason: "not connected yet - no snapshot observed" };
    }
    const clientActionId = randomUUID();
    const messageId = clientActionId;
    const settings = this.snapshot.chat.settings;
    return this.tracker.issue({
      clientActionId,
      frame: {
        kind: "send",
        hasBinaryPayload: false,
        epicId: this.epicId,
        chatId: this.chatId,
        clientActionId,
        messageId,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
        sender: { type: "user", userId: this.userId },
        settings,
        accountContext: DEFAULT_ACCOUNT_CONTEXT,
        deliveryPolicy: "auto",
        worktreeIntent: null,
      },
      isSettled: (view) => view.messageIds.has(messageId),
    });
  }

  close(): void {
    this.disposed = true;
    this.tracker.dispose();
    this.session.close();
  }

  private buildSnapshotView(): ChatSnapshotView {
    return {
      pendingApprovalIds: new Set([
        ...this.pendingApprovals.map((a) => a.approvalId),
        ...this.pendingFileEditApprovals.map((a) => a.approvalId),
      ]),
      pendingInterviewBlockIds: new Set(
        this.pendingInterviews.map((i) => i.blockId),
      ),
      messageIds: this.knownMessageIds,
    };
  }

  private handleServerFrame(envelope: unknown): void {
    const parsed = chatSubscribeServerFrameSchema.safeParse(envelope);
    if (!parsed.success) {
      this.onDiagnostic(
        `chat ${this.chatId}: dropped unrecognized frame kind=${String((envelope as { kind?: unknown }).kind)}`,
      );
      return;
    }
    const frame = parsed.data;
    switch (frame.kind) {
      case "snapshot": {
        this.snapshot = frame.snapshot;
        this.pendingApprovals = [...frame.snapshot.pendingApprovals];
        this.pendingFileEditApprovals = [
          ...frame.snapshot.pendingFileEditApprovals,
        ];
        this.pendingInterviews = [...frame.snapshot.pendingInterviews];
        this.runStatus = frame.snapshot.runStatus;
        this.knownMessageIds = new Set(
          frame.snapshot.chat.messages.map((m) => m.messageId),
        );
        this.connected = true;
        this.tracker.handleReconnectSnapshot(this.buildSnapshotView());
        if (this.firstSnapshotWaiters.length > 0) {
          const waiters = this.firstSnapshotWaiters;
          this.firstSnapshotWaiters = [];
          for (const waiter of waiters) waiter();
        }
        return;
      }
      case "actionAck": {
        this.tracker.handleAck({
          clientActionId: frame.clientActionId,
          status: frame.status,
          reason: frame.reason,
          code: frame.code,
        });
        return;
      }
      case "messageAccepted": {
        this.knownMessageIds.add(frame.message.messageId);
        return;
      }
      case "approvalRequested": {
        if (!this.pendingApprovals.some((a) => a.approvalId === frame.approval.approvalId)) {
          this.pendingApprovals.push(frame.approval);
        }
        return;
      }
      case "approvalResolved": {
        this.pendingApprovals = this.pendingApprovals.filter(
          (a) => a.approvalId !== frame.approvalId,
        );
        return;
      }
      case "fileEditApprovalRequested": {
        if (
          !this.pendingFileEditApprovals.some(
            (a) => a.approvalId === frame.approval.approvalId,
          )
        ) {
          this.pendingFileEditApprovals.push(frame.approval);
        }
        return;
      }
      case "fileEditApprovalResolved": {
        this.pendingFileEditApprovals = this.pendingFileEditApprovals.filter(
          (a) => a.approvalId !== frame.approvalId,
        );
        return;
      }
      case "interviewRequested": {
        if (!this.pendingInterviews.some((i) => i.blockId === frame.blockId)) {
          this.pendingInterviews.push({
            blockId: frame.blockId,
            requestedAt: frame.requestedAt,
          });
        }
        return;
      }
      case "interviewAnswered": {
        this.pendingInterviews = this.pendingInterviews.filter(
          (i) => i.blockId !== frame.blockId,
        );
        return;
      }
      case "turnStateChanged": {
        this.runStatus = frame.runStatus;
        return;
      }
      default:
        return;
    }
  }
}
