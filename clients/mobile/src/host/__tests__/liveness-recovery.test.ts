/**
 * Pure-logic coverage for the S5 liveness-recovery wiring (A). Everything is
 * injected (event targets, clock, interval fns) so this runs with no real
 * `window`/`setInterval` — matching the module's own testability design.
 */
import { describe, expect, it, vi } from "vitest";
import { startLivenessRecovery } from "../liveness-recovery";

/** A minimal fake `addEventListener`/`removeEventListener` target a test can fire. */
function fakeEventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function fakeVisibilityTarget(initial: string) {
  const base = fakeEventTarget();
  return { ...base, visibilityState: initial };
}

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms: number): void {
      now += ms;
    },
  };
}

function fakeIntervalRegistry() {
  const handlers = new Map<number, () => void>();
  let nextId = 1;
  return {
    setIntervalFn: (handler: () => void): number => {
      const id = nextId;
      nextId += 1;
      handlers.set(id, handler);
      return id;
    },
    clearIntervalFn: (id: number): void => {
      handlers.delete(id);
    },
    tick(id: number): void {
      handlers.get(id)?.();
    },
    activeCount(): number {
      return handlers.size;
    },
  };
}

describe("startLivenessRecovery", () => {
  it("reconnects unconditionally on focus, online, and visibility→visible", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const clock = fakeClock();

    startLivenessRecovery({
      reconnect,
      isLive: () => true,
      now: clock.now,
      windowTarget,
      documentTarget,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
    });

    windowTarget.fire("focus");
    expect(reconnect).toHaveBeenCalledWith("window-focus");

    clock.advance(6_000);
    windowTarget.fire("online");
    expect(reconnect).toHaveBeenCalledWith("network-online");

    clock.advance(6_000);
    documentTarget.fire("visibilitychange");
    expect(reconnect).toHaveBeenCalledWith("visibility-visible");

    clock.advance(6_000);
    windowTarget.fire("pageshow");
    expect(reconnect).toHaveBeenCalledWith("page-show");

    expect(reconnect).toHaveBeenCalledTimes(4);
  });

  it("does not reconnect on visibilitychange when the document is hidden", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("hidden");

    startLivenessRecovery({
      reconnect,
      isLive: () => true,
      windowTarget,
      documentTarget,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
    });

    documentTarget.fire("visibilitychange");
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("collapses a burst of triggers within the cooldown into one reconnectAll call", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const clock = fakeClock();

    startLivenessRecovery({
      reconnect,
      isLive: () => true,
      cooldownMs: 5_000,
      now: clock.now,
      windowTarget,
      documentTarget,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
    });

    // 10 focus events inside a <5s window — F9/round-2 bound: at most ~1-2 calls.
    for (let i = 0; i < 10; i += 1) {
      windowTarget.fire("focus");
      clock.advance(400); // 10 * 400ms = 4000ms total, well under the 5s cooldown
    }

    expect(reconnect.mock.calls.length).toBeLessThanOrEqual(2);
    expect(reconnect).toHaveBeenCalledWith("window-focus");
  });

  it("lets a trigger fire again once the cooldown has elapsed", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const clock = fakeClock();

    startLivenessRecovery({
      reconnect,
      isLive: () => true,
      cooldownMs: 5_000,
      now: clock.now,
      windowTarget,
      documentTarget,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
    });

    windowTarget.fire("focus");
    clock.advance(5_001);
    windowTarget.fire("focus");

    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it("backstop: only reconnects on its interval tick when NOT live (gentle — a true no-op while healthy)", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const interval = fakeIntervalRegistry();
    let live = true;

    startLivenessRecovery({
      reconnect,
      isLive: () => live,
      backstopIntervalMs: 20_000,
      windowTarget,
      documentTarget,
      setIntervalFn: interval.setIntervalFn,
      clearIntervalFn: interval.clearIntervalFn,
    });

    interval.tick(1);
    expect(reconnect).not.toHaveBeenCalled();

    live = false;
    interval.tick(1);
    expect(reconnect).toHaveBeenCalledWith("liveness-backstop");
  });

  it("F9: the backstop shares the same cooldown as the wake-signal triggers", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const interval = fakeIntervalRegistry();
    const clock = fakeClock();

    startLivenessRecovery({
      reconnect,
      isLive: () => false,
      cooldownMs: 5_000,
      now: clock.now,
      windowTarget,
      documentTarget,
      setIntervalFn: interval.setIntervalFn,
      clearIntervalFn: interval.clearIntervalFn,
    });

    windowTarget.fire("focus");
    expect(reconnect).toHaveBeenCalledTimes(1);

    // Backstop ticks 1s later, still inside the cooldown — must be suppressed.
    clock.advance(1_000);
    interval.tick(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("cleanup removes every listener and clears the interval", () => {
    const reconnect = vi.fn();
    const windowTarget = fakeEventTarget();
    const documentTarget = fakeVisibilityTarget("visible");
    const interval = fakeIntervalRegistry();

    const stop = startLivenessRecovery({
      reconnect,
      isLive: () => true,
      windowTarget,
      documentTarget,
      setIntervalFn: interval.setIntervalFn,
      clearIntervalFn: interval.clearIntervalFn,
    });

    expect(windowTarget.listenerCount("focus")).toBe(1);
    expect(windowTarget.listenerCount("online")).toBe(1);
    expect(windowTarget.listenerCount("pageshow")).toBe(1);
    expect(documentTarget.listenerCount("visibilitychange")).toBe(1);
    expect(interval.activeCount()).toBe(1);

    stop();

    expect(windowTarget.listenerCount("focus")).toBe(0);
    expect(windowTarget.listenerCount("online")).toBe(0);
    expect(windowTarget.listenerCount("pageshow")).toBe(0);
    expect(documentTarget.listenerCount("visibilitychange")).toBe(0);
    expect(interval.activeCount()).toBe(0);

    // Idempotent: a second stop() must not throw or double-clear.
    expect(() => stop()).not.toThrow();
  });
});
