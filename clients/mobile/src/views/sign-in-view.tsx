/**
 * Sign-in screen (T4, Flow 1).
 *
 * Drives the device flow off `MobileAuthService`: a single "Sign in" action
 * starts it, then the app shows the human `userCode` and a tappable verification
 * link while it polls in the background. Cancel aborts back to the prompt; an
 * expiry / denial / failure lands back here with copy matching the terminal
 * error. The screen is a pure function of the `SignInScreen` projection — it
 * holds no state of its own; `App` re-renders it as `auth.status()` transitions.
 */
import type { ReactElement } from "react";
import type { DeviceFlowProgress, MobileAuthError } from "@/host/auth-service";
import type { SignInScreen } from "@/app-screen";
import { isStorageDurable } from "@/host/safe-storage";
import { colors, primaryButton, screen, secondaryButton } from "./ui";

interface SignInViewProps {
  readonly screen: SignInScreen;
  readonly onSignIn: () => void;
  readonly onCancel: () => void;
}

export function signInErrorMessage(error: MobileAuthError): string {
  switch (error) {
    case "session-expired":
      return "Your session expired. Sign in again.";
    case "sign-in-failed":
      return "Sign-in didn't complete. Please try again.";
    case "device-denied":
      return "Sign-in was denied in the browser. Try again.";
    case "device-expired":
      return "The code expired before approval. Try again.";
    case "launch-failed":
      return "Couldn't start sign-in. Check your connection and try again.";
  }
}

export function SignInView({
  screen: state,
  onSignIn,
  onCancel,
}: SignInViewProps): ReactElement {
  return (
    <main style={screen}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Traycer Remote</h1>
      <p style={{ color: colors.muted, marginTop: 0 }}>
        Watch your fleet and answer blocked agents from your phone.
      </p>

      <StorageWarning />

      {state.kind === "sign-in" ? (
        <SignInPrompt error={state.error} onSignIn={onSignIn} />
      ) : (
        <SigningIn progress={state.progress} onCancel={onCancel} />
      )}
    </main>
  );
}

/**
 * Shown only when the browser is denying us persistent storage, in which case
 * the session lives in memory and dies on reload.
 *
 * It exists because the alternative is silent: the user signs in, it works,
 * they reload, and they are signed out again with no explanation — which
 * reads as a broken product rather than as a browser setting. Saying so costs
 * one line and turns an inexplicable loop into an understood limitation.
 *
 * Deliberately NOT an error: nothing has failed, and everything works for as
 * long as the tab is open.
 */
function StorageWarning(): ReactElement | null {
  if (isStorageDurable()) return null;
  return (
    <p
      role="status"
      style={{
        color: colors.muted,
        border: `1px solid ${colors.muted}`,
        borderRadius: 8,
        padding: 12,
        fontSize: 13,
      }}
    >
      This browser is blocking storage for Traycer Remote, so you&rsquo;ll stay
      signed in only until you close or reload this tab. Everything else works
      normally.
    </p>
  );
}

function SignInPrompt({
  error,
  onSignIn,
}: {
  readonly error: MobileAuthError | null;
  readonly onSignIn: () => void;
}): ReactElement {
  return (
    <>
      {error !== null ? (
        <p
          role="alert"
          style={{
            color: colors.danger,
            background: colors.dangerBg,
            border: `1px solid ${colors.danger}`,
            borderRadius: 8,
            padding: 12,
          }}
        >
          {signInErrorMessage(error)}
        </p>
      ) : null}
      <button type="button" style={primaryButton} onClick={onSignIn}>
        Sign in
      </button>
    </>
  );
}

function SigningIn({
  progress,
  onCancel,
}: {
  readonly progress: DeviceFlowProgress | null;
  readonly onCancel: () => void;
}): ReactElement {
  return (
    <div>
      {progress === null ? (
        <p style={{ color: colors.muted }}>Starting sign-in…</p>
      ) : (
        <div>
          <p style={{ marginBottom: 4 }}>
            Enter this code in your browser to approve:
          </p>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 4,
              padding: "12px 0",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {progress.userCode}
          </div>
          <a
            href={progress.verificationUriComplete}
            target="_blank"
            rel="noreferrer"
            style={{ color: colors.accent, wordBreak: "break-all" }}
          >
            Open the approval page ↗
          </a>
          <p style={{ color: colors.muted, marginTop: 16 }}>
            Waiting for approval…
          </p>
        </div>
      )}
      <button
        type="button"
        style={{ ...secondaryButton, marginTop: 12 }}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
