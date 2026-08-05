/**
 * React binding for a stream session's connection-state signal (T3).
 *
 * `openEpicStream` / `openChatStream` hand back a `StreamConnectionStateStore`
 * alongside the opened client; this hook subscribes a component to it via
 * `useSyncExternalStore`. The store's `getState` returns a primitive string, so
 * there is no snapshot-identity churn. Snapshot/frame payloads are delivered
 * through the caller's own callbacks (decode is T5/T6), not this hook.
 */
import { useSyncExternalStore } from "react";
import type {
  StreamConnectionState,
  StreamConnectionStateStore,
} from "./stream-connection";

export function useStreamConnectionState(
  store: StreamConnectionStateStore,
): StreamConnectionState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
