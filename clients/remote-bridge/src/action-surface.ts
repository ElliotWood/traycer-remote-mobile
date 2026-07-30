import type { Transcript } from "./transcript-projection";
import type { InterviewAnswer } from "@traycer/protocol/persistence/epic/content-blocks";

/**
 * The bridge's entire public surface. Any channel adapter is implementable
 * against this file alone, without reading anything else in this package —
 * it never sees a wire frame, a
 * `clientActionId`, a stream reconnect, or a host RPC.
 *
 * Every mutating method returns a definite {@link ActionOutcome} - never
 * hangs, never resolves without having actually determined what happened.
 * See the docblock on {@link ActionOutcome} for why "the host acknowledged
 * the frame" is deliberately NOT one of the outcomes here.
 */
export interface RemoteBridgeActions {
  /** Every agent (GUI chat or TUI session) visible in the bridge's epic. */
  listAgents(): Promise<readonly AgentSummary[]>;

  /**
   * Current status of one chat: run state plus everything currently
   * awaiting a human decision. Always reflects the bridge's live,
   * connection-verified view (see {@link ChatStatus.connected}) - never a
   * cached value served while the underlying subscription is silently dead.
   */
  getStatus(chatId: string): Promise<ChatStatus>;

  /**
   * Approves a pending approval (tool-call or file-edit — the bridge looks
   * up which from its own tracked state, so the caller never needs to know
   * the distinction). Resolves once the outcome is KNOWN, not once the
   * frame was sent.
   */
  approve(chatId: string, approvalId: string): Promise<ActionOutcome>;

  /** Rejects a pending approval. `reason` is surfaced to the agent as the denial explanation; pass `null` for no reason. */
  reject(
    chatId: string,
    approvalId: string,
    reason: string | null,
  ): Promise<ActionOutcome>;

  /** Answers a pending interview block. */
  answerInterview(
    chatId: string,
    blockId: string,
    answers: readonly InterviewAnswer[],
  ): Promise<ActionOutcome>;

  /** Sends a plain-text user message into a chat (starts or continues a turn). */
  sendMessage(chatId: string, text: string): Promise<ActionOutcome>;

  /**
   * A window of a chat's transcript, projected to prose plus non-prose
   * markers for card-shaped channels (see `transcript-projection.ts`).
   *
   * `offset` counts from the RECENT end — `0` is "now". This is a read, so
   * unlike the action methods it returns data rather than an
   * {@link ActionOutcome}, and an empty window means an empty window, not a
   * failure; use `getStatus().connected` to tell "nothing to show" from
   * "not connected yet".
   */
  getTranscript(
    chatId: string,
    offset: number,
    limit: number,
  ): Promise<Transcript>;
}

/**
 * Outcome of a mutating action, always one of exactly three states — there
 * is no fourth "sent, don't know" state, and no method that returns this
 * type may resolve without reaching one of them (a bounded reconcile
 * timeout resolves to `failed`, never hangs and never guesses `applied`).
 *
 * `applied` and `rejected` both mean the action's fate is KNOWN, but the two
 * routes to knowing it differ, and that difference matters:
 *
 *   - on a FIRST attempt, `applied`/`rejected` come straight from the
 *     correlated `actionAck` — a first accepted/rejected ack for a
 *     genuinely-pending action is itself sufficient evidence.
 *   - on a RESEND after a reconnect raced the original ack, `applied` can
 *     come from either the resend's own ack OR the pending item's absence
 *     in a fresh `chat.subscribe` snapshot — both are safe here specifically
 *     because `ActionTracker` only ever resends a frame whose target
 *     `isSettled` check just came back false (still genuinely pending), so
 *     a resend's ack is meaningful evidence, not a no-op absorb signal. The
 *     snapshot check is what makes this safe in the first place: a
 *     measurement against a real host (throwaway agents, `send` and
 *     `fileEditApprovalDecision`, both dedupe-tested including across a
 *     fresh reconnect - not just re-verified on the same session) found a
 *     duplicate/retried frame ALWAYS comes back `actionAck.status ===
 *     "accepted"`, even when the host silently absorbed it as a no-op — so
 *     `"accepted"` on the wire alone proves the host *processed* a frame,
 *     never that any GIVEN attempt *did* anything new. Reconciling against
 *     the snapshot before ever resending is what closes that gap; a bare ack
 *     from an attempt that was never gated on `isSettled` would not be
 *     enough. (Generic, non-file-edit `approvalDecision` dedup was not
 *     verified the same way and remains unconfirmed - see
 *     `action-tracker.ts`'s docblock.)
 *
 * Treating a bare `"accepted"` ack as proof of effect is the exact bug this
 * surface exists to avoid (see `ws-stream-client.ts`'s `phase !==
 * "subscribed"` drop and its "CRDT convergence absorbs it" comment - true
 * for CRDT deltas, false for actions).
 *
 * A THIRD path also resolves `failed`, deliberately, rather than hanging:
 * `ActionTracker` bounds every issued action with a per-action timer,
 * reset on each reconcile attempt so a slow-but-progressing recovery isn't
 * punished, and firing only when NEITHER an ack NOR any reconcile progress
 * happens for the whole window - the case a real network partition
 * produces. `failed` there means "unconfirmed", not "did not apply": the
 * action may have landed on the host with no way for this process to know.
 */
export type ActionOutcome =
  | { readonly kind: "applied" }
  | {
      readonly kind: "rejected";
      readonly reason: string | null;
      readonly code: string | null;
    }
  | {
      readonly kind: "failed";
      /** Human-readable cause: host closed the frame as malformed, the action id no longer exists, the reconcile window expired, etc. */
      readonly reason: string;
    };

export interface AgentSummary {
  readonly agentId: string;
  readonly title: string | null;
  readonly harnessId: string | null;
  readonly surface: "gui" | "tui";
  /**
   * Actively executing a turn right now, per the host's activity tracker.
   *
   * LOCAL-ONLY, and the qualifier is load-bearing: the activity tracker does
   * not replicate, so this is `false` for every row where `isLocal` is false,
   * whatever that agent is actually doing. Read it as "executing ON THIS
   * HOST", never as "executing".
   */
  readonly active: boolean;
  /** Whether this agent runs on the host being queried. See {@link AgentSummary.active}. */
  readonly isLocal: boolean;
  /** The host the agent runs on, so a caller can say WHICH rather than just "elsewhere". */
  readonly hostId: string;
}

export interface ChatStatus {
  readonly chatId: string;
  readonly title: string | null;
  readonly runStatus: "idle" | "running" | "stopping";
  readonly pendingApprovals: readonly PendingApproval[];
  readonly pendingInterviews: readonly PendingInterview[];
  /**
   * True only when the bridge's `chat.subscribe` session for this chat is
   * genuinely open and past the host's subscribe-accept handshake right
   * now — never true merely because the bridge process is running, and
   * never left stale across a drop. A caller must not treat any field
   * above as current when this is `false`; it reflects the last frame the
   * bridge actually saw before the connection went away.
   */
  readonly connected: boolean;
}

export interface PendingApproval {
  readonly approvalId: string;
  readonly toolName: string;
  readonly description: string;
  readonly requestedAt: number;
}

export interface PendingInterview {
  readonly blockId: string;
  readonly requestedAt: number;
}
