/**
 * The per-epic status strip — the region the audit found and we had no
 * counterpart for.
 *
 * Desktop's `EpicShellStatusRow` is `h-10 shrink-0`, right-aligned, sitting
 * ABOVE the canvas and SEPARATE from the app header, and it renders
 * `snapshotLoaded ? <EpicConnectionPill /> : null`. Connection state is a
 * property of the EPIC, not of the app, which is why it is scoped here.
 *
 * We had no such region, so our staleness banner went among the list rows —
 * the same mistake one level out: no region existed, so it went where there
 * was room.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS WHERE THE 40-SECOND WAIT LIVES.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The failure mode a shell invites is: frame renders instantly, canvas stays
 * blank for forty seconds. That is not the goal met, it is the blank screen
 * RELOCATED — and it photographs as a win, which is worse.
 *
 * So the frame is populated and the PILL is what waits. Desktop's pattern is
 * `snapshotLoaded ? … : null`; this copies the placement, not only the
 * timing. A person looking at a loading epic sees a real header, a real
 * status strip, and a strip that says what is happening — rather than
 * nothing.
 */
import { makeStyles, tokens, Spinner, Text } from "@fluentui/react-components";

const useStyles = makeStyles({
  row: {
    height: "40px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
  stale: { color: tokens.colorPaletteDarkOrangeForeground1 },
  live: { color: tokens.colorPaletteGreenForeground1 },
});

export type EpicConnectionState =
  /**
   * Waiting on `epic.subscribe`. On a large epic this is ~40s of host-side
   * serialisation, so it MUST say so — a spinner with no duration reads as
   * broken after ten seconds.
   */
  | { readonly kind: "loading" }
  | { readonly kind: "live" }
  /** Rows on screen are real but old. Age is carried, never implied. */
  | { readonly kind: "stale"; readonly ageLabel: string }
  | { readonly kind: "error" };

export function EpicStatusRow({
  state,
}: {
  readonly state: EpicConnectionState;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <output className={styles.row} data-testid="epic-status-row">
      {state.kind === "loading" ? (
        <>
          <Spinner size="tiny" />
          {/*
            Names the cause. The wait is host-side serialisation of a large
            document — measured at ~1s per MB — and a person who knows that
            waits differently from one watching an unexplained spinner.
          */}
          <Text size={200} className={styles.subtle}>
            Loading this epic — large epics take a while
          </Text>
        </>
      ) : null}
      {state.kind === "live" ? (
        <Text size={200} className={styles.live}>
          ● Live
        </Text>
      ) : null}
      {state.kind === "stale" ? (
        // WITH the age, always. "Disconnected" alone gives no basis to judge
        // whether the rows on screen can be trusted; the age is the whole
        // decision.
        <Text size={200} className={styles.stale}>
          Not updating — as of {state.ageLabel}
        </Text>
      ) : null}
      {state.kind === "error" ? (
        <Text size={200} className={styles.stale}>
          Couldn’t reach the host
        </Text>
      ) : null}
    </output>
  );
}
