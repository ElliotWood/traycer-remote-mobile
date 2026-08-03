/**
 * A one-line viewport readout, on screen so a human can read it INSIDE Teams.
 *
 * ─── Why this exists ───
 *
 * The canvas port turns on one number: `MIN_PANE_PX = 240` in
 * `@/canvas/tile-tree-constants`. A pane may not render below it, so the
 * available width decides whether the canvas can hold two panes, one, or
 * cannot split at all.
 *
 * **That number is not measurable from the harness.** `live-tab-probe.mjs`
 * drives a real browser, but OUTSIDE Teams — what it reports is the browser
 * window, not the iframe Teams hands a personal tab, and Teams mobile is a
 * third number again. Measuring it there would produce a real figure about
 * the wrong subject, which is the same trap as measuring boot PROMPTNESS
 * outside Teams (see the probe's own docblock, where it is named and
 * refused rather than approximated).
 *
 * So this is the instrument for a question the automated instrument cannot
 * reach: it renders where only Teams can render it, and a human reads it.
 *
 * ─── It REPORTS. It does not DECIDE. ───
 *
 * Deliberately no conditional layout hangs off these numbers, and none should
 * until they have been read. A breakpoint chosen from an assumed width would
 * be a decision wearing a measurement's clothes — this project's most-repeated
 * defect. The numbers come first; the layout rule comes after, from them.
 *
 * ─── When to delete it ───
 *
 * When the widths are recorded in the canvas audit artifact and a sizing rule
 * exists. It is a temporary instrument on a shipping screen, and the way a
 * temporary instrument becomes permanent is by having no stated removal
 * condition. That is the condition.
 *
 * ─── What it deliberately does NOT report ───
 *
 * No user agent, no platform string, no Teams context, no host name. Width,
 * height and pixel ratio answer the question; everything else would be
 * environment fingerprinting on a screen a real user sees, and the OSS rule
 * here is that nothing identifying goes anywhere it does not have to.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  line: {
    display: "block",
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
});

interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
}

function read(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    ratio: window.devicePixelRatio,
  };
}

/**
 * Live rather than read-once: Teams resizes the tab iframe when the app's
 * side rail opens, when a meeting panel appears, and on every device
 * rotation. A single mount-time sample would report one arbitrary member of
 * a range and read as if it were the width.
 */
function useViewport(): Viewport | null {
  /*
   * LAZY INITIALISER, not a set-in-effect. The obvious shape here is
   * `useState(null)` plus `setViewport(read())` in the effect, and that is
   * what this was — it added a sixth `react-hooks/set-state-in-effect` error
   * to a package whose baseline is five held ones, which would have buried a
   * new error inside a number everyone already ignores.
   *
   * The lazy form is also just correct: it paints the real width on the FIRST
   * frame instead of rendering nothing and then correcting itself. Both
   * branches still go through `read()`, so there is one reader of `window`.
   */
  const [viewport, setViewport] = useState<Viewport | null>(() =>
    typeof window === "undefined" ? null : read(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = (): void => {
      setViewport(read());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return viewport;
}

/**
 * `MIN_PANE_PX` is NOT imported here on purpose. Printing "fits 2 panes"
 * would be this component deciding, and the arithmetic belongs next to the
 * sizing rule once one exists. The raw numbers are the deliverable.
 */
export function ViewportReadout(): ReactElement | null {
  const styles = useStyles();
  const viewport = useViewport();
  if (viewport === null) return null;
  return (
    <Caption1 className={styles.line} data-testid="viewport-readout">
      viewport {viewport.width}×{viewport.height} · dpr{" "}
      {viewport.ratio.toFixed(2)}
    </Caption1>
  );
}
