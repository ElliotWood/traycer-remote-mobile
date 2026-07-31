/**
 * The states a fleet can be in besides "here are your agents".
 *
 * These are FIRST-CLASS, not fallbacks. The bot's read surface treated
 * everything that wasn't a happy path as one undifferentiated failure card,
 * and the result was that "the host is down", "you have no agents" and "the
 * request errored" all rendered identically — three different user actions
 * behind one message.
 *
 * The distinctions that matter here:
 *
 *   loading       we do not know yet          → wait
 *   empty         we know, and there are none → nothing to do
 *   error         the request failed          → retry
 *   disconnected  we knew, and lost contact   → the data below is STALE
 *
 * `empty` and `error` are the pair most often collapsed, and they are
 * opposites: one is a confident answer, the other is the absence of one. A
 * fleet that renders "No agents" when the request failed is stating something
 * false, which is the same defect as 53 agents reporting Idle.
 */
import type { ReactElement, ReactNode } from "react";
import {
  Body1,
  Button,
  Caption1,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  centre: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingVerticalS,
    // Tall enough that the state reads as the content, not as a caption
    // floating above an empty page.
    minHeight: "220px",
    textAlign: "center",
    padding: tokens.spacingVerticalXXL,
  },
  subtle: { color: tokens.colorNeutralForeground3, maxWidth: "48ch" },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  row: {
    display: "grid",
    // Mirrors the real grid's columns so the skeleton does not reflow into
    // the loaded layout — a jump on load reads as a bug even when it isn't.
    gridTemplateColumns: "minmax(0, 1fr) 120px 120px",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
});

/**
 * Skeleton rows rather than a spinner.
 *
 * A spinner says "something is happening"; a skeleton says "a list of this
 * shape is arriving", which is the actual answer, and it holds the layout so
 * nothing jumps when the data lands.
 */
export function FleetLoading({ rows = 6 }: { rows?: number }): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.rows} aria-busy="true" aria-label="Loading agents">
      <Skeleton>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.row}>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </div>
        ))}
      </Skeleton>
    </div>
  );
}

function State({
  title,
  children,
  action,
  urgent = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  urgent?: boolean;
}): ReactElement {
  const styles = useStyles();
  return (
    // A screen reader must announce the state rather than leaving a blind
    // user with a silently empty region — the blank tab we already shipped
    // once has an exact audio equivalent.
    //
    // `alert` for failures, `status` otherwise, and the difference is real:
    // `status` maps to aria-live="polite" and waits for a pause, which is
    // right for "loading" and "no agents" and wrong for "this didn't work".
    // A failure announced after the user has moved on is a failure they
    // experience as the page doing nothing.
    <div className={styles.centre} role={urgent ? "alert" : "status"}>
      <Subtitle2>{title}</Subtitle2>
      <Body1 className={styles.subtle}>{children}</Body1>
      {action}
    </div>
  );
}

/**
 * A confident answer: the host responded and has nothing to show.
 *
 * Says WHICH host, because "no agents" from the wrong host is the same words
 * as "no agents" from the right one, and the difference is the whole problem.
 */
export function FleetEmpty({ hostId }: { hostId?: string }): ReactElement {
  return (
    <State title="No agents yet">
      Nothing is running on {hostId ? <strong>{hostId}</strong> : "this host"}.
      Start an agent from Traycer on your desktop and it will appear here.
    </State>
  );
}

/**
 * The absence of an answer. Never worded as a fact about the fleet.
 *
 * The `detail` is rendered — unlike the bot's failure card, which suppressed
 * it. In a tab there is no console and no address bar, so a user who can read
 * "connection refused" can act on it, and one who reads "something went
 * wrong" cannot tell us anything we don't already know.
 */
export function FleetError({
  detail,
  onRetry,
}: {
  detail?: string;
  onRetry?: () => void;
}): ReactElement {
  return (
    <State
      title="Couldn’t load your agents"
      action={
        onRetry ? (
          <Button appearance="primary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      This is a problem reaching Traycer, not a statement about your fleet —
      your agents are unaffected.
      {detail ? (
        <>
          {" "}
          <Caption1>({detail})</Caption1>
        </>
      ) : null}
    </State>
  );
}

/**
 * Signed in, and the fleet is not connected to the host yet.
 *
 * This exists because the alternative was worse than a missing feature. The
 * authenticated view rendered the FIXTURE fleet behind a "sample data"
 * warning — honest about the rows being invented, and silent on the question
 * an authenticated user is actually asking, which is *why am I seeing sample
 * data after signing in*. A placeholder before sign-in is reasonable; the
 * same placeholder after sign-in reads as the app claiming to have your
 * fleet.
 *
 * Deliberately NOT the empty state: "no agents" is a claim about the fleet,
 * and we have not asked yet. Deleted in the commit that wires the host.
 */
export function FleetNotWired(): ReactElement {
  return (
    <State title="Not connected to your host yet">
      You&rsquo;re signed in. Showing your real agents is the next piece of
      work — this screen isn&rsquo;t reading from your host yet, so nothing is
      missing and nothing is wrong with your fleet.
    </State>
  );
}

/**
 * Contact lost while rows were already on screen.
 *
 * Deliberately a BANNER over the existing rows rather than a replacement for
 * them. Blanking the grid would assert "no agents", which is a claim we no
 * longer have any basis for — the honest statement is "this is what we last
 * saw, and it may have moved on".
 *
 * `intent="warning"` and an explicit word: high contrast strips the colour,
 * so a banner that is only yellow says nothing at all to some users.
 */
export function FleetStale({
  since,
  onRetry,
}: {
  since?: string;
  onRetry?: () => void;
}): ReactElement {
  return (
    <MessageBar intent="warning">
      <MessageBarBody>
        <strong>Disconnected.</strong> Showing the fleet as it was
        {since ? ` ${since}` : " when contact was lost"}. Statuses below may
        have changed.
      </MessageBarBody>
      {onRetry ? (
        <MessageBarActions>
          <Button size="small" onClick={onRetry}>
            Reconnect
          </Button>
        </MessageBarActions>
      ) : null}
    </MessageBar>
  );
}
