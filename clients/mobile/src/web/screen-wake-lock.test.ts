import { describe, expect, it, vi, type Mock } from "vitest";
import {
  WAKE_LOCK_STORAGE_KEY,
  startScreenWakeLock,
  wakeLockEnabled,
  type VisibilityDocument,
  type WakeLockHandle,
  type WakeLockNavigator,
  type WakeLockOutcome,
} from "./screen-wake-lock";

/** Only `release` and the `release` event are reached by this module. */
interface FakeSentinel {
  release: Mock;
  addEventListener(type: "release", listener: () => void): void;
  /** Battery saver taking the lock away without asking. */
  dropByOs(): void;
}

function fakeSentinel(): FakeSentinel {
  const listeners = new Set<() => void>();
  return {
    release: vi.fn(() => Promise.resolve()),
    addEventListener(_type: "release", fn: () => void): void {
      listeners.add(fn);
    },
    dropByOs(): void {
      for (const fn of listeners) fn();
    },
  };
}

interface Harness {
  readonly sentinels: FakeSentinel[];
  readonly outcomes: WakeLockOutcome[];
  stop(): void;
  setVisibility(state: DocumentVisibilityState): void;
  hasVisibilityListener(): boolean;
}

interface HarnessOptions {
  readonly stored?: string | null;
  readonly visibility?: DocumentVisibilityState;
  readonly request?: () => Promise<WakeLockHandle>;
  readonly noWakeLock?: boolean;
}

function harness(options: HarnessOptions): Harness {
  const sentinels: FakeSentinel[] = [];
  const defaultRequest = (): Promise<WakeLockHandle> => {
    const sentinel = fakeSentinel();
    sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  };
  const request = options.request ?? defaultRequest;

  const listeners = new Set<() => void>();
  const doc: { visibilityState: DocumentVisibilityState } & VisibilityDocument = {
    visibilityState: options.visibility ?? "visible",
    addEventListener(_type: "visibilitychange", fn: () => void): void {
      listeners.add(fn);
    },
    removeEventListener(_type: "visibilitychange", fn: () => void): void {
      listeners.delete(fn);
    },
  };

  const navigator: WakeLockNavigator =
    options.noWakeLock === true ? {} : { wakeLock: { request } };

  const outcomes: WakeLockOutcome[] = [];
  const stop = startScreenWakeLock({
    navigator,
    document: doc,
    read: () => options.stored ?? null,
    report: (outcome) => outcomes.push(outcome),
  });

  return {
    sentinels,
    outcomes,
    stop,
    setVisibility(state: DocumentVisibilityState): void {
      doc.visibilityState = state;
      for (const fn of listeners) fn();
    },
    hasVisibilityListener: () => listeners.size > 0,
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("wakeLockEnabled", () => {
  it("defaults to ON when nothing is stored", () => {
    // Elliot's explicit, informed choice - he was told the battery cost. Read
    // the module docblock before changing this.
    expect(wakeLockEnabled(() => null)).toBe(true);
  });

  it("is off only for a stored 'off'", () => {
    expect(wakeLockEnabled(() => "off")).toBe(false);
  });

  it("holds the lock for the retired 'while-running' setting", () => {
    // THE DISCLOSED REDUCTION, as a test rather than a sentence. The old
    // preference had three values and `while-running` needed to know whether
    // an agent was working - which the shell cannot see. Mapping it to "hold"
    // errs toward the default the user actually chose. A reader who thinks
    // that is the wrong call has this test to change, instead of discovering
    // the behaviour from a device.
    expect(wakeLockEnabled(() => "while-running")).toBe(true);
  });

  it("reads the key the retired client wrote", () => {
    // Same key, so a device that ran the old PWA keeps its setting. A new key
    // would silently re-enable the lock for anyone who had turned it off.
    expect(WAKE_LOCK_STORAGE_KEY).toBe("traycer.mobile.wakeLock");
  });
});

describe("startScreenWakeLock", () => {
  it("acquires a lock and reports that it is held", async () => {
    const h = harness({});
    await settle();

    expect(h.sentinels).toHaveLength(1);
    expect(h.outcomes).toEqual(["held"]);
  });

  it("requests nothing when the stored preference is off", async () => {
    const h = harness({ stored: "off" });
    await settle();

    expect(h.sentinels).toHaveLength(0);
    expect(h.outcomes).toEqual(["off"]);
    expect(h.hasVisibilityListener()).toBe(false);
  });

  it("reports 'unsupported' separately from 'unavailable'", async () => {
    // Two different facts: the browser has no API at all, versus it has one
    // that refused this time (low battery, power saving). Collapsing them is
    // how a later probe concludes the feature works because an attribute was
    // merely present.
    const missing = harness({ noWakeLock: true });
    await settle();
    expect(missing.outcomes).toEqual(["unsupported"]);

    const refused = harness({ request: () => Promise.reject(new Error("nope")) });
    await settle();
    expect(refused.outcomes).toEqual(["unavailable"]);
  });

  it("RE-ACQUIRES after the page is hidden and shown again", async () => {
    // The trap the whole module exists for: the browser silently releases the
    // lock every time the page hides and never restores it. Without this the
    // feature works exactly once, which to a user is indistinguishable from it
    // never having worked.
    const h = harness({});
    await settle();
    expect(h.sentinels).toHaveLength(1);

    h.setVisibility("hidden");
    await settle();
    h.setVisibility("visible");
    await settle();

    expect(h.sentinels).toHaveLength(2);
  });

  it("does not stack a second lock while one is already held", async () => {
    const h = harness({});
    await settle();
    h.setVisibility("visible");
    await settle();

    expect(h.sentinels).toHaveLength(1);
  });

  it("re-acquires after the OS drops the lock on its own", async () => {
    const h = harness({});
    await settle();
    h.sentinels[0].dropByOs();

    h.setVisibility("hidden");
    await settle();
    h.setVisibility("visible");
    await settle();

    expect(h.sentinels).toHaveLength(2);
  });

  it("does not request while the page is hidden at startup", async () => {
    const h = harness({ visibility: "hidden" });
    await settle();

    expect(h.sentinels).toHaveLength(0);
    expect(h.outcomes).toEqual([]);
  });

  it("releases the lock and unsubscribes when stopped", async () => {
    const h = harness({});
    await settle();

    h.stop();

    expect(h.sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(h.hasVisibilityListener()).toBe(false);
  });

  it("releases a lock that arrives after stop", async () => {
    // `request` is async, so a stop between the call and its resolution leaves
    // a live sentinel nothing holds a reference to - the screen stays on with
    // no way to turn it off.
    const sentinel = fakeSentinel();
    let resolveRequest: ((value: WakeLockHandle) => void) | undefined;
    const h = harness({
      request: () =>
        new Promise<WakeLockHandle>((resolve) => {
          resolveRequest = resolve;
        }),
    });

    h.stop();
    resolveRequest?.(sentinel);
    await settle();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});
