/**
 * The sign-in gate (T4, Flow 1). Renders exactly one screen off the auth status
 * and host configuration, via the pure `selectAppScreen` projection:
 *
 *   sign-in / signing-in → the device-flow screen
 *   no-host              → the "set VITE_HOST_WS_URL" prompt (signed in but no
 *                          host to talk to)
 *   signed-in            → the app shell (Fleet → Epic → Chat)
 *
 * `auth` is injected (not constructed here) so this component is renderable in a
 * test with a fake auth + a fake host client provided through
 * `HostClientProvider`. The composition root that wires the real services is
 * `AppRoot`.
 */
import type { ReactElement } from "react";
import { selectAppScreen } from "@/app-screen";
import type { MobileAuthService } from "@/host/auth-service";
import { useAuthStatus } from "@/host/use-auth-status";
import { useHostClientOrNull } from "@/host/host-client-context";
import { AppShell } from "@/app-shell";
import { SignInView } from "@/views/sign-in-view";
import { colors, screen } from "@/views/ui";

export function App({ auth }: { readonly auth: MobileAuthService }): ReactElement {
  const status = useAuthStatus(auth);
  const client = useHostClientOrNull();
  const appScreen = selectAppScreen(status, client !== null);

  switch (appScreen.kind) {
    case "sign-in":
    case "signing-in":
      return (
        <SignInView
          screen={appScreen}
          onSignIn={() => void auth.signIn()}
          onCancel={() => auth.cancelSignIn()}
        />
      );
    case "no-host":
      return <HostConfigPrompt />;
    case "signed-in":
      // Non-null by the gate; the guard is only to satisfy the type narrowing.
      return client === null ? (
        <HostConfigPrompt />
      ) : (
        <AppShell client={client} onSignOut={() => auth.signOut()} />
      );
  }
}

function HostConfigPrompt(): ReactElement {
  // Only reached when no host is configured: `no-host` ⟺ the host client is
  // null ⟺ `HOST_WS_URL === null`. So there is exactly one message to show —
  // no "current endpoint" branch can render here.
  return (
    <main style={screen}>
      <h1 style={{ fontSize: 20 }}>Traycer Remote</h1>
      <p style={{ color: colors.muted }}>
        Set <code>VITE_HOST_WS_URL</code> to your Traycer host — e.g.{" "}
        <code>ws://127.0.0.1:PORT/rpc</code> — then reload.
      </p>
    </main>
  );
}
