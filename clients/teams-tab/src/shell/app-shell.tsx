/**
 * The frame. Everything else renders inside it.
 *
 * WHY THIS EXISTS, in one measurement: desktop sets `100vh` at the ROOT four
 * times and uses `min-h-0` containment 197 times below it. The tab set
 * `minHeight: 100vh` on every one of eleven screens and used containment
 * zero times.
 *
 * That is the whole difference, and it is not about `position: sticky` —
 * desktop uses sticky in eleven places, we use it in none, and neither fact
 * matters. **A page that GROWS cannot have a pinned region**, whatever
 * positioning is applied to it. A child that cannot exceed its parent can.
 *
 * So: `100vh` here, ONCE. `minHeight: 0` on every scrollable descendant.
 * `overflow: hidden` on the frame so the page itself never scrolls — the
 * body region does.
 *
 * THE SHELL MUST NOT WAIT FOR DATA. It takes no epic, no snapshot, no
 * connection. It renders on the first frame and the surfaces inside it fill
 * in — which is the acceptance test for this whole piece of work: the shell
 * is correct when it is on screen BEFORE the epic data is.
 *
 * Shared at the FRAME layer, deliberately. Eleven screens previously shared a
 * `page` style and had no shell, which is the wrong layer inverted: the frame
 * is what should be common and the contents are what should differ.
 */
import { useEffect, type ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";

/**
 * How many times this shell has MOUNTED. The persistence probe.
 *
 * A `data-` attribute on the header could not answer this. Three ways it
 * fails: a stale reference survives detachment, a portal can duplicate the
 * element, and `querySelector` may not return the node you mean — so "same
 * node" came back true even against a control forcing a remount on every
 * render, which is impossible if the probe measured what I thought.
 *
 * This is a signal REACT OWNS. `useEffect(…, [])` runs exactly once per
 * mount, and there is no way to remount and still read 1. The rule the old
 * probe broke: measure a signal the framework controls, never one you plant.
 *
 * Left in the shipped build deliberately. It is a counter and a name; it
 * makes the frame's central property observable in production rather than
 * only under a harness, and the alternative — instrumenting for a test and
 * shipping something different — is how a verified build stops being the
 * build that runs.
 */
declare global {
  interface Window {
    __traycerShellMounts?: number;
  }
}

const useStyles = makeStyles({
  /**
   * The only `100vh` in the client.
   *
   * `height`, not `minHeight`: inside a Teams iframe `minHeight` grows the
   * page rather than filling it — dead space on short screens, two
   * scrollbars on long ones — and growth is exactly what makes a pinned
   * region impossible.
   */
  frame: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  /**
   * 40px, matching desktop's `h-10`, and `flexShrink: 0` so it survives a
   * long body. A header that can be squeezed is not a persistent region.
   */
  header: {
    height: "40px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  /** Takes the remaining height and is the ONLY thing that scrolls. */
  body: {
    flexGrow: 1,
    // The containment desktop uses 197 times and we used zero. Without it a
    // flex child refuses to shrink below its content, the frame grows, and
    // the header scrolls away — which is the defect this file exists to fix.
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  /** Pushes the trailing cluster right, as desktop's drag spacer does. */
  spacer: { flexGrow: 1, minWidth: 0 },
  /** Never collapses — desktop's right cluster is `shrink-0`. */
  trailing: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
});

export interface AppShellProps {
  /** Leading content — title, breadcrumb, back. */
  readonly leading?: ReactNode;
  /** Trailing cluster — identity, connection. Never collapses. */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({
  leading,
  trailing,
  children,
}: AppShellProps): React.JSX.Element {
  const styles = useStyles();
  // Empty dep array: once per MOUNT, never on re-render. A remount is the
  // thing being detected, so anything that runs per-render would report the
  // opposite of the property.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__traycerShellMounts = (window.__traycerShellMounts ?? 0) + 1;
  }, []);
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        {leading}
        <div className={styles.spacer} />
        <div className={styles.trailing}>{trailing}</div>
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
