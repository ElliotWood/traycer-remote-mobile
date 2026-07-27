// @vitest-environment jsdom
/**
 * S5 (A, M1b): a fast healthy re-dial must never visibly flash "Reconnecting".
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, renderHook } from "@/test-utils/dom";
import { useSettledConnectionState } from "../use-settled-connection-state";
import type { StreamConnectionState } from "../stream-connection";

/** Explicit prop typing so `rerender` accepts any `StreamConnectionState`, not
 * just the literal `initialProps` happened to start with. */
function useHarness({ raw }: { raw: StreamConnectionState }) {
  return useSettledConnectionState(raw, 1_500);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSettledConnectionState", () => {
  it("surfaces recovery to live immediately", () => {
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { raw: "reconnecting" },
    });
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(result.current).toBe("reconnecting");

    rerender({ raw: "live" });
    // No timer advance needed — live is surfaced synchronously.
    expect(result.current).toBe("live");
  });

  it("debounces a move away from live — a fast re-dial never flashes reconnecting", () => {
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { raw: "live" },
    });
    expect(result.current).toBe("live");

    rerender({ raw: "reconnecting" });
    // Still "live" immediately after the drop — not yet past the threshold.
    expect(result.current).toBe("live");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    // A fast re-dial recovers before the threshold elapses.
    rerender({ raw: "live" });
    expect(result.current).toBe("live");
  });

  it("surfaces a genuinely persistent non-live state once the threshold passes", () => {
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { raw: "live" },
    });

    rerender({ raw: "reconnecting" });
    expect(result.current).toBe("live");

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(result.current).toBe("reconnecting");
  });
});
