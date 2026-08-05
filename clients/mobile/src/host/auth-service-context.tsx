/**
 * React context carrying the single `MobileAuthService` instance (push
 * sprint) — mirrors `host-client-context.tsx`'s pattern exactly. Built once
 * at the composition root (`AppRoot`) and threaded down here so the alerts
 * affordance can read the current bearer for the push-service HTTP API
 * without prop-drilling `auth` through every intermediate view.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { MobileAuthService } from "@traycer-clients/shared/auth/browser-device-auth-service";

const AuthServiceContext = createContext<MobileAuthService | null>(null);

export function AuthServiceProvider({
  auth,
  children,
}: {
  readonly auth: MobileAuthService | null;
  readonly children: ReactNode;
}): ReactElement {
  return <AuthServiceContext.Provider value={auth}>{children}</AuthServiceContext.Provider>;
}

export function useAuthServiceOrNull(): MobileAuthService | null {
  return useContext(AuthServiceContext);
}
