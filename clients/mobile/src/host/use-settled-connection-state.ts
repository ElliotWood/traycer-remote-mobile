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

const DEFAULT_THRESHOLD_MS = 1_500;

export function useSettledConnectionState(
  raw: StreamConnectionState,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): StreamConnectionState {
  const [settled, setSettled] = useState<StreamConnectionState>(raw);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (raw === "live") {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSettled("live");
      return;
    }

    const timer = setTimeout(() => {
      timerRef.current = null;
      setSettled(raw);
    }, thresholdMs);
    timerRef.current = timer;

    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) {
        timerRef.current = null;
      }
    };
  }, [raw, thresholdMs]);

  return settled;
}
