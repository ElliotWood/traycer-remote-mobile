/**
 * Subscribes a component to `MobileAuthService`'s UI status projection (T4).
 *
 * `onStatusChange` fires the listener immediately with the current value and
 * returns an unsubscribe, and `status()` returns the stable `statusValue`
 * reference (replaced only on a real transition) — exactly the contract
 * `useSyncExternalStore` needs, so the snapshot never churns and the gate
 * re-renders precisely on sign-in / sign-out / device-flow progress.
 */
import { useSyncExternalStore } from "react";
import type { MobileAuthStatus } from "./auth-service";

interface AuthStatusSource {
  status(): MobileAuthStatus;
  onStatusChange(listener: (status: MobileAuthStatus) => void): () => void;
}

export function useAuthStatus(auth: AuthStatusSource): MobileAuthStatus {
  return useSyncExternalStore(
    (onStoreChange) => auth.onStatusChange(() => onStoreChange()),
    () => auth.status(),
  );
}
