import { describe, expect, it, vi, type Mock } from "vitest";
import {
  WAKE_LOCK_STORAGE_KEY,
  isWakeLockPolicyBlocked,
  startScreenWakeLock,
  wakeLockEnabled,
  type PermissionsPolicy,
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
  /**
   * What `allowsFeature("screen-wake-lock")` answers. Left undefined the
   * document exposes NO policy API at all, which is both the jsdom default and
   * the Firefox/Safari reading - so every test that does not opt in is also
   * covering the no-API path.
   */
  readonly allowsFeature?: boolean;
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
  const doc: { visibilityState: DocumentVisibilityState } & VisibilityDocument =
    {
      visibilityState: options.visibility ?? "visible",
      featurePolicy:
        options.allowsFeature === undefined
          ? undefined
          : { allowsFeature: () => options.allowsFeature === true },
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

    const refused = harness({
      request: () => Promise.reject(new Error("nope")),
    });
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

  it("does not request while the page is hidden at startup, and SAYS SO", async () => {
    // This assertion used to be `toEqual([])` - the module reported nothing at
    // all here, so `<html data-wake-lock>` carried no attribute. Absent is not
    // one of the outcomes; it reads the same as an old bundle, a boot that
    // threw, and the module never having been wired.
    const h = harness({ visibility: "hidden" });
    await settle();

    expect(h.sentinels).toHaveLength(0);
    expect(h.outcomes).toEqual(["deferred"]);
  });

  it("reports 'deferred' when the page hides, rather than leaving 'held' standing", async () => {
    const h = harness({});
    await settle();
    expect(h.outcomes).toEqual(["held"]);

    h.setVisibility("hidden");
    await settle();

    // The browser has taken the lock away by now, so an attribute still reading
    // `held` would assert it at the one moment it provably is not.
    expect(h.outcomes).toEqual(["held", "deferred"]);

    h.setVisibility("visible");
    await settle();
    expect(h.outcomes).toEqual(["held", "deferred", "held"]);
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

describe("isWakeLockPolicyBlocked", () => {
  const base = {
    visibilityState: "visible",
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  } as const;

  /** A document exposing Chromium's name for the policy - or none at all. */
  const doc = (policy: PermissionsPolicy | undefined): VisibilityDocument => ({
    ...base,
    featurePolicy: policy,
  });

  /** A document exposing only the spec's renamed alias. */
  const renamedDoc = (policy: PermissionsPolicy): VisibilityDocument => ({
    ...base,
    permissionsPolicy: policy,
  });

  it("is not blocked where the document exposes no policy API", () => {
    // Firefox, Safari and jsdom. The unknown resolves toward ATTEMPTING, which
    // is the same direction the rest of the module errs.
    expect(isWakeLockPolicyBlocked(doc(undefined))).toBe(false);
  });

  it("is blocked exactly when the policy refuses the feature", () => {
    expect(isWakeLockPolicyBlocked(doc({ allowsFeature: () => false }))).toBe(
      true,
    );
    expect(isWakeLockPolicyBlocked(doc({ allowsFeature: () => true }))).toBe(
      false,
    );
  });

  it("asks about screen-wake-lock and nothing else", () => {
    // A check that passed whatever name it was given would read a policy for
    // some other feature and report it as this one's.
    const seen: string[] = [];
    isWakeLockPolicyBlocked(
      doc({
        allowsFeature: (f) => {
          seen.push(f);
          return true;
        },
      }),
    );
    expect(seen).toEqual(["screen-wake-lock"]);
  });

  it("reads the spec's `permissionsPolicy` name too", () => {
    // Chromium ships `featurePolicy`; the spec renamed it. Reading only the
    // Chromium name would silently stop discriminating after a rename - and
    // silently, because the fallback is "not blocked", which looks like health.
    expect(
      isWakeLockPolicyBlocked(renamedDoc({ allowsFeature: () => false })),
    ).toBe(true);
  });

  it("is not blocked when the policy read throws", () => {
    expect(
      isWakeLockPolicyBlocked(
        doc({
          allowsFeature: () => {
            throw new TypeError("unrecognised feature");
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("startScreenWakeLock under a refusing permissions policy", () => {
  it("reports 'policy-blocked' and never asks for a lock it cannot have", async () => {
    const h = harness({ allowsFeature: false });
    await settle();

    expect(h.outcomes).toEqual(["policy-blocked"]);
    expect(h.sentinels).toHaveLength(0);
  });

  it("does not retry on visibility, because the policy cannot change", async () => {
    // Permissions policy is fixed when the document is created, from the
    // frame's `allow` attribute. Listening would request a guaranteed-failing
    // lock on every tab switch for the life of the tab.
    const h = harness({ allowsFeature: false });
    await settle();

    expect(h.hasVisibilityListener()).toBe(false);
  });

  it("is a DIFFERENT reading from a permitted surface whose request is refused", async () => {
    // The whole point. `wakeLock.request` rejects with `NotAllowedError` for
    // both, and the two want opposite next actions: battery saver clears,
    // a Teams tab with no delegation never will.
    const blocked = harness({ allowsFeature: false });
    const permitted = harness({
      allowsFeature: true,
      request: () => Promise.reject(new Error("NotAllowedError")),
    });
    await settle();

    expect(blocked.outcomes).toEqual(["policy-blocked"]);
    expect(permitted.outcomes).toEqual(["unavailable"]);
  });

  it("still holds the lock where the policy permits it", async () => {
    // The control. Without it a check that answered `true` unconditionally
    // would pass every assertion above.
    const h = harness({ allowsFeature: true });
    await settle();

    expect(h.outcomes).toEqual(["held"]);
    expect(h.sentinels).toHaveLength(1);
  });

  it("answers 'off' ahead of the policy, because the user's choice outranks it", async () => {
    const h = harness({ allowsFeature: false, stored: "off" });
    await settle();

    expect(h.outcomes).toEqual(["off"]);
  });
});
