import { describe, expect, it, vi } from "vitest";
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import { ActionableDetector, type ActionableTransition } from "../actionable-detector";
import { APPROVAL_ENTRY, STALLED_ENTRY } from "./fixtures";

/** Minimal in-memory stand-in satisfying `PushedStateStore`'s public surface. */
class FakePushedStateStore {
  private state = new Map<string, boolean>();
  get(id: string): boolean | undefined {
    return this.state.get(id);
  }
  async set(id: string, value: boolean): Promise<void> {
    this.state.set(id, value);
  }
  async delete(id: string): Promise<void> {
    this.state.delete(id);
  }
}

/** Manual-flush fake timer: `setTimer` captures the callback instead of scheduling it, so tests control exactly when a coalesce window closes. */
function manualTimer() {
  const scheduled: Array<() => void> = [];
  return {
    setTimer: (fn: () => void): unknown => {
      scheduled.push(fn);
      return scheduled.length - 1;
    },
    flushOne: (): void => {
      const fn = scheduled.shift();
      if (fn === undefined) throw new Error("no timer scheduled");
      fn();
    },
  };
}

function entryWithSeverity(
  base: HostNotificationEntry,
  severity: HostNotificationEntry["severity"],
): HostNotificationEntry {
  return { ...base, severity } as HostNotificationEntry;
}

describe("ActionableDetector edge trigger", () => {
  it("fires on absent -> actionable", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0].id).toBe(APPROVAL_ENTRY.id);
  });

  it("does not re-fire on actionable -> actionable", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(1);
  });

  it("fires again after actionable -> cleared -> actionable", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    await detector.handleRemoved([APPROVAL_ENTRY.id]);
    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]).toHaveLength(1);
  });

  it("snapshot-seeded actionable rows do not fire, including on a subsequent same-state upsert", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.seedFromSnapshot([APPROVAL_ENTRY]);
    // A later upserted frame for the SAME still-actionable row must not fire —
    // seeding already recorded it as actionable, so this is not a transition.
    await detector.handleUpserted(APPROVAL_ENTRY);

    expect(batches).toHaveLength(0);
  });

  it("fires for a kind outside the current five-value enum, at needs_action severity — proves the filter is severity-only", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    // `kind` deliberately widened to `string` — this constructs a value
    // OUTSIDE the real enum on purpose (proves the filter is severity-only,
    // not kind-aware), so it can never structurally satisfy
    // `HostNotificationEntry` as-is. A single assertion between two
    // genuinely-overlapping types (every other field matches; `kind` only
    // widens) needs no `unknown` bridge.
    const futureKindEntry: Omit<HostNotificationEntry, "kind"> & { readonly kind: string } = {
      ...APPROVAL_ENTRY,
      kind: "some.future.kind",
      severity: "needs_action",
    };

    await detector.handleUpserted(futureKindEntry as HostNotificationEntry);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(1);
  });

  it("does not treat a done/info-severity row as actionable", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(entryWithSeverity(APPROVAL_ENTRY, "done"));
    await detector.handleUpserted(entryWithSeverity(STALLED_ENTRY, "info"));

    expect(batches).toHaveLength(0);
  });
});

describe("ActionableDetector coalescing", () => {
  it("a single transition in a window sends exactly one normal batch", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(1);
  });

  it("N transitions inside one window produce exactly one batch of N", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    await detector.handleUpserted(STALLED_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toHaveLength(2);
  });

  it("two transitions in two separate windows produce two batches", async () => {
    const store = new FakePushedStateStore();
    const batches: ActionableTransition[][] = [];
    const timer = manualTimer();
    const detector = new ActionableDetector({
      pushedStateStore: store,
      onBatch: async (t) => {
        batches.push([...t]);
      },
      setTimer: timer.setTimer,
    });

    await detector.handleUpserted(APPROVAL_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    await detector.handleUpserted(STALLED_ENTRY);
    timer.flushOne();
    await vi.waitFor(() => expect(batches).toHaveLength(2));

    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
  });
});
