/**
 * The handle on the inside of the door.
 *
 * The tab's sign-in persists across reload by design — a device-auth token is
 * rehydrated on start, which is the right behaviour and was reported all day
 * as a success. It was never paired with its consequence: **there was no way
 * to end that session from inside the app.** Sign in as the wrong principal,
 * or on a shared machine, or on a colleague's laptop, and the only remedy was
 * outside the product.
 *
 * `signOut()` has existed on `MobileAuthService` the whole time, shared with
 * the PWA, and this client already held the service. Nothing called it. This
 * is a button, not a feature — which is why it is the cheapest red on the
 * parity contract and why it is worth doing before anything larger.
 *
 * WHY IT LIVES IN THE HEADER'S TRAILING SLOT. `AppShell` already has one, for
 * exactly this: the region that survives navigation. A sign-out reachable
 * only from one screen is reachable only if you can get to that screen, and
 * the states where you most want out — wrong account, a screen erroring — are
 * the states where navigation is least trustworthy.
 *
 * NO CONFIRMATION DIALOG, deliberately. Signing out destroys no work and is
 * undone by signing in again; a confirm step would add a click to the common
 * case to protect against a cheap mistake. The mobile client makes the same
 * call. What it DOES do is say whose session it is ending, because on a
 * shared machine "am I signed in as me?" is the question the button exists to
 * answer.
 */
import type { ReactElement } from "react";
import { Button, Caption1, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    // Never collapses — it sits inside the shell's `trailing` cluster, which
    // is `flexShrink: 0` for the same reason.
    flexShrink: 0,
  },
  /**
   * The identity, subdued.
   *
   * Hidden below the phone breakpoint rather than truncated: an id cut to
   * "user-a1b2…" answers nothing, and the button beside it still works. The
   * label is a disclosure, not a control.
   */
  who: {
    color: tokens.colorNeutralForeground3,
    maxWidth: "22ch",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "@media (max-width: 420px)": { display: "none" },
  },
});

export interface SignOutButtonProps {
  /**
   * Who the session belongs to, as the app knows them. `null` while identity
   * is still resolving — the button still works, because being unable to name
   * the user is not a reason to trap them in the session.
   */
  readonly userId: string | null;
  readonly onSignOut: () => void;
}

export function SignOutButton({
  userId,
  onSignOut,
}: SignOutButtonProps): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.row}>
      {userId === null ? null : (
        <Caption1 className={styles.who} title={userId}>
          {userId}
        </Caption1>
      )}
      <Button size="small" appearance="subtle" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );
}
