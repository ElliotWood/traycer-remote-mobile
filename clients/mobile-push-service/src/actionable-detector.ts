import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import type { PushedStateReader } from "./pushed-state-store";

/**
 * Severity alone decides actionability — no `kind` allowlist. `kind` is
 * exactly the same five-value enum severity already discriminates
 * (`host-notifications.ts:28-34`), so a kind clause here would be a
 * tautology today and a silent drop of any future sixth kind at
 * `needs_action`/`failure` severity tomorrow. The repo already settled this
 * for notification hooks (`host-notifications.ts:779-785`); this matches it.
 */
export function isActionable(entry: HostNotificationEntry): boolean {
  return entry.severity === "needs_action" || entry.severity === "failure";
}

export interface ActionableTransition {
  readonly id: string;
  readonly entry: HostNotificationEntry;
}

export interface ActionableDetectorDeps {
  readonly pushedStateStore: PushedStateReader;
  /** Called with every transition accumulated in one coalesce window. */
  readonly onBatch: (transitions: readonly ActionableTransition[]) => Promise<void>;
  readonly coalesceWindowMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

const DEFAULT_COALESCE_WINDOW_MS = 3_000;

/**
 * Edge-triggered, persisted actionable-entry detector with fixed-window
 * coalescing — see the contract's "Actionable-entry detection" + "Coalescing"
 * sections.
 *
 * Edge trigger: a transition fires only on a live `false/absent → true`
 * flip, never on a snapshot (seeded, not fired) and never while already
 * actionable (no re-fire on unrelated row touches).
 *
 * Coalescing is a FIXED window, not a resetting debounce: the first
 * transition after a flush opens a window and starts the timer; every
 * transition arriving before that timer fires joins the same batch; the
 * timer is never restarted by a later arrival. A resetting debounce would
 * starve delivery entirely during a steady trickle of transitions spaced
 * under the window — bounded latency matters more than a slightly larger
 * batch.
 */
export class ActionableDetector {
  private readonly deps: ActionableDetectorDeps;
  private pending: ActionableTransition[] = [];
  private timer: unknown = null;

  constructor(deps: ActionableDetectorDeps) {
    this.deps = deps;
  }

  /** Seeds dedup state from the initial `snapshot.attention.entries` — never pushes. */
  async seedFromSnapshot(
    entries: readonly HostNotificationEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.deps.pushedStateStore.set(entry.id, isActionable(entry));
    }
  }

  /** Feeds one live `upserted` entry through the edge-trigger. */
  async handleUpserted(entry: HostNotificationEntry): Promise<void> {
    const actionable = isActionable(entry);
    const wasActionable = this.deps.pushedStateStore.get(entry.id) ?? false;
    await this.deps.pushedStateStore.set(entry.id, actionable);
    if (actionable && !wasActionable) {
      this.enqueue({ id: entry.id, entry });
    }
  }

  /** On `removed`/`cleared`, drops tracked ids so a later, genuinely new occurrence starts fresh. */
  async handleRemoved(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.deps.pushedStateStore.delete(id);
    }
  }

  private enqueue(transition: ActionableTransition): void {
    this.pending.push(transition);
    if (this.timer !== null) {
      return;
    }
    const setTimer = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const windowMs = this.deps.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
    this.timer = setTimer(() => {
      this.timer = null;
      const batch = this.pending;
      this.pending = [];
      void this.deps.onBatch(batch);
    }, windowMs);
  }
}
