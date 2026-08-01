/**
 * The tab's auth, over the SAME device flow the PWA uses (decision 4).
 *
 * `MobileAuthService` moved to `clients/shared` for this — no second
 * implementation, no shared secret, and the credential is the real one.
 *
 * The Teams-specific part is not the flow, it is what happens around it. A
 * device flow shows a code and expects you to approve it somewhere else, and
 * inside a Teams tab "somewhere else" is a different application. That is
 * survivable — the poll loop does not care where the approval happens — but
 * the copy has to acknowledge it, which the sign-in view does.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  MobileAuthService,
  type MobileAuthStatus,
} from "@traycer-clients/shared/auth/browser-device-auth-service";
import { AUTHN_BASE_URL } from "@/config";

export interface AuthServiceState {
  readonly auth: MobileAuthService;
  /**
   * `true` until `start()` has settled.
   *
   * The service's initial status is `signed-out`, and `start()` — which
   * rehydrates a persisted session — is asynchronous. So between mount and
   * rehydration the UI is told "signed out" by a service that has not yet
   * looked. Rendering the sign-in screen there presents a button for
   * something that may be about to happen on its own.
   *
   * Elliot hit exactly that: *"I managed to click sign in before it
   * navigated automatically"*. He raced the rehydration and started a device
   * flow that was not needed.
   *
   * It also corrupts the PERSISTENCE test. Reload-and-see-if-you-stay-signed-in
   * is the question we are trying to answer, and a UI that flashes the
   * signed-out screen during every rehydration produces a convincing false
   * negative — the observer sees the sign-in screen and concludes the session
   * did not survive, when it did and simply had not loaded yet.
   *
   * `signed-out` and `not asked yet` are different facts, which is the same
   * distinction as `empty` versus `error` on the fleet, and as
   * `active: false` versus not-visible-from-here. Third time this week.
   */
  readonly restoring: boolean;
}

export function useAuthService(): AuthServiceState {
  const [auth] = useState(
    () =>
      new MobileAuthService({
        authnBaseUrl: AUTHN_BASE_URL,
        // Production authn only accepts `cli`/`desktop` — `mobile` is
        // rejected with a 400. The PWA masquerades as `desktop` for the same
        // reason; matching it keeps one behaviour to reason about rather
        // than two.
        clientId: "desktop",
      }),
  );

  const [restoring, setRestoring] = useState(true);

  // `start()` rehydrates a persisted session. The ref guards StrictMode's
  // deliberate double-invoke, which would otherwise run two device flows.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // `finally`, not `then`: a rehydration that FAILS has also finished
    // asking, and leaving `restoring` true on that path would hang the UI on
    // a spinner forever — trading a false negative for a dead screen.
    void auth.start().finally(() => {
      setRestoring(false);
    });
  }, [auth]);

  return { auth, restoring };
}

export function useAuthStatus(auth: MobileAuthService): MobileAuthStatus {
  return useSyncExternalStore(
    (onChange) => auth.onStatusChange(() => onChange()),
    () => auth.status(),
  );
}
