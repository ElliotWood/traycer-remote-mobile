/**
 * Sign-in, in Fluent, for a device flow running inside a Teams tab.
 *
 * The flow is the PWA's unchanged. What differs is the instruction: a device
 * flow tells you to approve the code "in your browser", and inside a Teams
 * tab the user IS in an app, not a browser — on desktop Teams there may not
 * be an obvious browser at all. So the copy names the action rather than the
 * place, and the link opens explicitly.
 *
 * `isStorageDurable()` is surfaced here for the same reason as in the PWA:
 * a Teams tab is a third-party frame, storage may be partitioned or denied,
 * and a user who has to sign in on every load deserves to be told why rather
 * than concluding the product is broken.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  Link,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle1,
  tokens,
} from "@fluentui/react-components";
import { isStorageDurable } from "@traycer-clients/shared/platform/safe-storage";
import type { MobileAuthStatus } from "@traycer-clients/shared/auth/browser-device-auth-service";

const useStyles = makeStyles({
  // Fills its container and paints the theme background. Without the paint
  // the themed panel stopped where the content did and the rest of the tab
  // was the browser's default white — a bright slab under a dark card in
  // dark Teams. Caught in the render; invisible in the markup.
  //
  // `height: 100%`, NOT `minHeight: 100vh`. The original reason for the
  // viewport unit — fill the screen — is now the SHELL's job, and it holds
  // the only `100vh` in the client. Keeping one here would grow the frame
  // from inside a contained body: the header stretches off-screen and the
  // page scrolls, which is precisely what the shell exists to prevent. The
  // paint still matters and stays.
  page: {
    height: "100%",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
    padding: tokens.spacingVerticalXXL,
  },
  wrap: {
    display: "flex",
    flexDirection: "column",
    // `alignItems: flex-start` so controls take their intrinsic width. A
    // column flex container stretches its children by default, which made
    // the primary button span the full 480px panel and read as a banner
    // rather than a button.
    alignItems: "flex-start",
    gap: tokens.spacingVerticalM,
    maxWidth: "480px",
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    letterSpacing: "0.15em",
    padding: `${tokens.spacingVerticalM} 0`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
});

interface SignInProps {
  readonly status: MobileAuthStatus;
  readonly onSignIn: () => void;
  readonly onCancel: () => void;
}

export function SignIn({
  status,
  onSignIn,
  onCancel,
}: SignInProps): ReactElement {
  const styles = useStyles();

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <Subtitle1>Traycer</Subtitle1>
        <Body1>
          {/*
            Says "epics", not "fleet". The screen behind this sign-in is the
            epics list — "Fleet" named a surface that no longer exists, and
            copy promising one thing before a screen shows another is a small
            version of the same defect the whole week has been about.
          */}
          Sign in to see your epics and the agents working on them.
        </Body1>

        {!isStorageDurable() ? (
          <MessageBar intent="info">
            <MessageBarBody>
              Teams is blocking storage for this tab, so you&rsquo;ll stay
              signed in only until it reloads. Everything else works normally.
            </MessageBarBody>
          </MessageBar>
        ) : null}

        {status.kind === "signing-in" && status.progress !== null ? (
          <>
            <Body1>Enter this code to approve the sign-in:</Body1>
            <div className={styles.code}>{status.progress.userCode}</div>
            {/*
            "in your browser" is what a device flow usually says, and it is
            wrong here — the user is in Teams, and on desktop Teams there may
            be no browser in front of them at all. Name the action instead.
          */}
            <Link
              href={status.progress.verificationUriComplete}
              target="_blank"
              rel="noreferrer"
            >
              Open the approval page ↗
            </Link>
            <div className={styles.row}>
              <Spinner size="tiny" />
              <Caption1>Waiting for approval…</Caption1>
            </div>
            <Button appearance="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {status.kind === "signed-out" && status.error !== null ? (
              <MessageBar intent="error">
                <MessageBarBody>{signInError(status.error)}</MessageBarBody>
              </MessageBar>
            ) : null}
            <Button appearance="primary" onClick={onSignIn}>
              Sign in
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function signInError(error: string): string {
  switch (error) {
    case "session-expired":
      return "Your session expired. Sign in again.";
    case "device-denied":
      return "Sign-in was denied. Try again.";
    case "device-expired":
      return "The code expired before it was approved. Try again.";
    case "launch-failed":
      return "Couldn't start sign-in. Check your connection and try again.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}
