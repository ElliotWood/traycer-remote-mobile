import type { StreamFrameEnvelope } from "@traycer-clients/shared/host-transport/i-stream-session";
import type { ActionOutcome } from "./action-surface";

/**
 * Correlates one outbound chat action frame to its eventual, PROVEN outcome.
 *
 * The problem this exists to solve, measured against a real host (not
 * theorized): `WsStreamClient.sendClientFrame` drops a frame on the floor
 * whenever `phase !== "subscribed"` (`ws-stream-client.ts` — the comment
 * there claims "Y.js CRDT convergence absorbs it", which is true for CRDT
 * deltas and FALSE for `send`/`approvalDecision`/`fileEditApprovalDecision`/
 * `interviewAnswer` — nothing replays those, so a frame dropped mid-reconnect
 * is gone forever and the caller is told nothing. On mobile this is the bug
 * that makes approve/reject buttons hang.
 *
 * And a live probe against a real host settled the second half of the
 * problem: a duplicate/retried frame with the same `clientActionId` ALWAYS
 * comes back `actionAck.status === "accepted"` — even when the host silently
 * absorbed it as a no-op (already-applied `send`/`fileEditApprovalDecision`,
 * verified across a fresh reconnect, not just the same socket). So
 * `"accepted"` proves the host *processed* the frame, never that it *did*
 * anything new. Trusting a bare ack as proof of effect is the same class of
 * bug as the CRDT-convergence assumption above — this tracker never makes
 * either mistake:
 *
 *   - it never calls `sendClientFrame` directly and trusts the return value
 *     (there isn't one) — it tracks the frame until a REAL signal resolves it
 *   - "real signal" is either a correlated `actionAck`, or — when a reconnect
 *     raced the ack and the ack itself may have been lost with the dead
 *     socket — the tracked item's absence from a FRESH post-reconnect
 *     `chat.subscribe` snapshot (`isSettled`, supplied by the caller per
 *     action; see `chat-session.ts`)
 *   - a still-pending item survives reconnects and resending the identical
 *     frame is safe: measured directly against a real host for `send` and
 *     `fileEditApprovalDecision` (including across a fresh reconnect, not
 *     just the same socket - both dedupe on `clientActionId`, not the
 *     socket). Generic, non-file-edit `approvalDecision` was NOT verified
 *     the same way (the probe that would trigger one - a Bash tool call
 *     under `supervised` - never hit an approval gate at all) and remains
 *     unconfirmed; this tracker assumes the same host-wide dedup mechanism
 *     applies to it, but that assumption is unproven for that one action
 *     kind specifically.
 *   - retries are bounded (`maxReconcileAttempts`) AND every action carries
 *     a per-entry unconfirmed-timeout, reset on each reconcile attempt so a
 *     slow-but-progressing recovery isn't punished. Either bound resolves
 *     `failed` - never leaves the caller's promise hanging forever, which
 *     an ordinary network partition (no ack, no reconnect, ever) otherwise
 *     would: nothing but a timer can end that wait.
 */

const DEFAULT_MAX_RECONCILE_ATTEMPTS = 5;
/**
 * How long an action may sit with zero progress (no ack, no reconcile
 * attempt) before it resolves `failed`. Generous relative to the transport's
 * own `maxBackoffMs` (30s in `bridge-client.ts`) so a reconnect that is
 * genuinely in flight - just slow - wins the race instead of being reported
 * as a false failure. Reset on every `handleReconnectSnapshot` call that
 * still finds this entry pending (see `armTimer`), so a session that keeps
 * reconnecting-and-still-pending never times out mid-recovery; only a
 * connection that produces NO snapshots at all (the partition case) lets
 * this fire.
 */
const DEFAULT_UNCONFIRMED_TIMEOUT_MS = 45_000;

export interface ChatSnapshotView {
  readonly pendingApprovalIds: ReadonlySet<string>;
  readonly pendingInterviewBlockIds: ReadonlySet<string>;
  readonly messageIds: ReadonlySet<string>;
}

export type SettledCheck = (snapshot: ChatSnapshotView) => boolean;

export interface IssueOptions {
  readonly clientActionId: string;
  readonly frame: StreamFrameEnvelope;
  readonly binaryPayload?: Uint8Array | null;
  /**
   * Given a fresh post-reconnect snapshot, true iff this action's target no
   * longer needs a decision (the pending approval/interview is gone, or the
   * message id now appears in history) — i.e. it settled without us seeing
   * the ack. Required: every issued action must be reconcilable this way,
   * or it cannot be tracked safely across a reconnect.
   */
  readonly isSettled: SettledCheck;
}

interface PendingEntry {
  readonly clientActionId: string;
  readonly frame: StreamFrameEnvelope;
  readonly binaryPayload: Uint8Array | null;
  readonly isSettled: SettledCheck;
  readonly resolve: (outcome: ActionOutcome) => void;
  attempts: number;
  settled: boolean;
  timer: NodeJS.Timeout | null;
}

export interface ActionTrackerDeps {
  readonly send: (
    frame: StreamFrameEnvelope,
    binaryPayload: Uint8Array | null,
  ) => void;
  readonly maxReconcileAttempts?: number;
  readonly unconfirmedTimeoutMs?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export class ActionTracker {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly send: ActionTrackerDeps["send"];
  private readonly maxReconcileAttempts: number;
  private readonly unconfirmedTimeoutMs: number;
  private readonly onDiagnostic: (message: string) => void;
  private disposed = false;

  constructor(deps: ActionTrackerDeps) {
    this.send = deps.send;
    this.maxReconcileAttempts =
      deps.maxReconcileAttempts ?? DEFAULT_MAX_RECONCILE_ATTEMPTS;
    this.unconfirmedTimeoutMs =
      deps.unconfirmedTimeoutMs ?? DEFAULT_UNCONFIRMED_TIMEOUT_MS;
    this.onDiagnostic = deps.onDiagnostic ?? (() => {});
  }

  /** Sends the frame and returns a promise that resolves only on a proven outcome — including the unconfirmed-timeout bound, so a dead connection cannot hang it forever. */
  issue(opts: IssueOptions): Promise<ActionOutcome> {
    if (this.disposed) {
      return Promise.resolve({
        kind: "failed",
        reason: "bridge is shutting down",
      });
    }
    if (this.pending.has(opts.clientActionId)) {
      return Promise.resolve({
        kind: "failed",
        reason: `clientActionId ${opts.clientActionId} is already in flight`,
      });
    }
    return new Promise<ActionOutcome>((resolve) => {
      const entry: PendingEntry = {
        clientActionId: opts.clientActionId,
        frame: opts.frame,
        binaryPayload: opts.binaryPayload ?? null,
        isSettled: opts.isSettled,
        resolve,
        attempts: 1,
        settled: false,
        timer: null,
      };
      this.pending.set(opts.clientActionId, entry);
      this.armTimer(entry);
      this.send(entry.frame, entry.binaryPayload);
    });
  }

  /** Feed every `actionAck` frame the chat session receives here. No-op for an unrecognized/already-settled id. */
  handleAck(ack: {
    readonly clientActionId: string;
    readonly status: "accepted" | "rejected";
    readonly reason: string | null;
    readonly code: string | null;
  }): void {
    const entry = this.pending.get(ack.clientActionId);
    if (entry === undefined || entry.settled) return;
    if (ack.status === "rejected") {
      this.settle(entry, {
        kind: "rejected",
        reason: ack.reason,
        code: ack.code,
      });
      return;
    }
    // "accepted" proves the frame was processed - NOT that it changed
    // anything new (see the class docblock). For every action tracked here
    // that is a real, sufficient outcome: the caller asked for a decision
    // to take effect, and an accepted frame means it either just did or
    // already had - both report success from the caller's point of view.
    this.settle(entry, { kind: "applied" });
  }

  /**
   * Call once a fresh snapshot arrives on a NEW subscription (i.e. after a
   * reconnect) — reconciles every still-pending action against it. An
   * action whose target already settled resolves `applied` without ever
   * having seen its ack (the ack may have died with the old socket). An
   * action still genuinely pending is resent on the fresh session (safe -
   * see the class docblock) and gets another chance to ack, with its
   * unconfirmed-timeout reset (real progress just happened, so the clock
   * shouldn't be counting down toward a false failure); exhausting
   * `maxReconcileAttempts` resolves it `failed` rather than retrying
   * forever.
   */
  handleReconnectSnapshot(snapshot: ChatSnapshotView): void {
    for (const entry of this.pending.values()) {
      if (entry.settled) continue;
      if (entry.isSettled(snapshot)) {
        this.onDiagnostic(
          `action ${entry.clientActionId} settled via snapshot reconcile (no ack observed)`,
        );
        this.settle(entry, { kind: "applied" });
        continue;
      }
      if (entry.attempts >= this.maxReconcileAttempts) {
        this.onDiagnostic(
          `action ${entry.clientActionId} exhausted ${String(entry.attempts)} reconcile attempts - failing`,
        );
        this.settle(entry, {
          kind: "failed",
          reason: `unconfirmed after ${String(entry.attempts)} reconcile attempts across reconnects - the action's effect on the host is unknown, not refused`,
        });
        continue;
      }
      entry.attempts += 1;
      this.onDiagnostic(
        `action ${entry.clientActionId} still pending after reconnect - resending (attempt ${String(entry.attempts)})`,
      );
      this.armTimer(entry);
      this.send(entry.frame, entry.binaryPayload);
    }
  }

  /** Resolves every still-outstanding action as `failed` — called on bridge shutdown so nothing hangs past process exit. */
  dispose(): void {
    this.disposed = true;
    this.failAllPending("bridge is shutting down");
  }

  /**
   * Resolves every still-outstanding action as `failed` with a specific
   * reason, WITHOUT marking the tracker disposed (unlike `dispose()`) — for
   * a caller (e.g. `ChatSession` on a non-recoverable fatal close) that
   * wants outstanding actions to fail fast with an accurate cause rather
   * than waiting out their unconfirmed-timeout, while still controlling
   * whether future `issue()` calls are rejected itself.
   */
  failAllPending(reason: string): void {
    for (const entry of this.pending.values()) {
      if (entry.settled) continue;
      this.settle(entry, { kind: "failed", reason });
    }
  }

  /**
   * (Re)arms the unconfirmed-timeout for one entry. Called on `issue()` and
   * again on every reconcile attempt that finds the entry still pending, so
   * the deadline measures "time since the last sign of progress," not "time
   * since the action was first issued" — a slow multi-reconnect recovery
   * keeps resetting the clock as long as it keeps making attempts; only a
   * connection producing NO snapshots at all lets this actually fire.
   */
  private armTimer(entry: PendingEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (entry.settled) return;
      this.onDiagnostic(
        `action ${entry.clientActionId} unconfirmed after ${String(this.unconfirmedTimeoutMs)}ms with no ack and no reconcile progress - failing rather than hanging`,
      );
      this.settle(entry, {
        kind: "failed",
        reason: `unconfirmed after ${String(this.unconfirmedTimeoutMs)}ms - no ack and no reconnect ever reconciled it; the action's effect on the host is unknown, not refused`,
      });
    }, this.unconfirmedTimeoutMs);
  }

  private settle(entry: PendingEntry, outcome: ActionOutcome): void {
    entry.settled = true;
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.pending.delete(entry.clientActionId);
    entry.resolve(outcome);
  }
}
