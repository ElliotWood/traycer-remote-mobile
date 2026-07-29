/**
 * Sprint 5 (A, M1b): debounces the "Reconnecting" indicator against the new
 * unconditional focus/visibility/online reconnect triggers.
 *
 * A healthy session force-reconnected on wake still round-trips in well under
 * a second, so surfacing every raw `"reconnecting"` blip would flash the
 * indicator on nearly every alt-tab — a mobile-craft regression, not a
 * liveness improvement. Recovery to `"live"` is always surfaced immediately
 * (there is no reason to hide good news); a move AWAY from `"live"` is only
 * surfaced once it has persisted past `thresholdMs`, so a fast re-dial never
 * visibly flickers and a genuinely stuck/slow reconnect still shows up.
 */
import { useEffect, useRef, useState } from "react";
import type { StreamConnectionState } from "./stream-connection";

export const DEFAULT_THRESHOLD_MS = 1_500;

export function useSettledConnectionState(
  raw: StreamConnectionState,
  thresholdMs: number,
): StreamConnectionState {
  const [settled, setSettled] = useState<StreamConnectionState>(raw);
  // Browser-only (this module never runs under Node) — `number`, not
  // `ReturnType<typeof setTimeout>`, which resolves to Node's ambient
  // `Timeout` type when `@types/node` is also in scope.
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (raw === "live") {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSettled("live");
      return;
    }

    const timer = window.setTimeout(() => {
      timerRef.current = null;
      setSettled(raw);
    }, thresholdMs);
    timerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) {
        timerRef.current = null;
      }
    };
  }, [raw, thresholdMs]);

  return settled;
}
