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

export function useAuthService(): MobileAuthService {
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

  // `start()` rehydrates a persisted session. The ref guards StrictMode's
  // deliberate double-invoke, which would otherwise run two device flows.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void auth.start();
  }, [auth]);

  return auth;
}

export function useAuthStatus(auth: MobileAuthService): MobileAuthStatus {
  return useSyncExternalStore(
    (onChange) => auth.onStatusChange(() => onChange()),
    () => auth.status(),
  );
}
