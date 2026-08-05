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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import {
  EpicStatusRow,
  type EpicConnectionState,
} from "./epic-status-row";
import { ShellStatusProvider } from "./shell-status";
import {
  ShellNotificationsProvider,
  type ShellNotifications,
} from "./shell-notifications";
import { ShellSettingsProvider } from "./shell-settings";
import { ChatScrollContainerProvider } from "./chat-scroll-container";
import { NotificationBell } from "../notifications/notification-bell";

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

/**
 * The fallback when no caller wants the settings handler.
 *
 * MODULE-LEVEL so it is referentially stable. Written inline it would be a
 * fresh function every render, and it is handed straight to a context whose
 * consumer lists it in an effect's dependency array — so every render would
 * republish, which is the exact hazard `shell-notifications` documents about
 * its own handler. A no-op that loops is worse than no no-op.
 */
const NO_SETTINGS_SLOT = (): void => undefined;

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
  /**
   * THE SECOND PERSISTENT REGION, which the audit found and we had one of.
   *
   * Desktop has two: an app header and a per-epic status row, and they are
   * separate because what they say is scoped differently — the header is
   * about the app, the row is about THIS epic. Ours rendered at the top of
   * the screen content, so it scrolled away the moment the epic's rows
   * arrived: a status pill that disappears when there is something to be
   * status ABOUT.
   *
   * `flexShrink: 0` for the same reason as the header. A region that can be
   * squeezed is not persistent, and this one sits directly above content that
   * grows to any length.
   *
   * Rendered only when a screen has published a state. An empty 40px strip on
   * every other screen would be the frame taking space to say nothing.
   */
  status: {
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  /** Takes the remaining height and is the ONLY thing that scrolls. */
  body: {
    // So an absolutely-positioned descendant (the chat route's jump-to-latest
    // chip) anchors to THIS box's visible extent, not the scrolled content's
    // full height, and not the page. No other screen positions a child
    // absolutely today, so this has no effect on them.
    position: "relative",
    flexGrow: 1,
    // The containment desktop uses 197 times and we used zero.
    //
    // BELT AND BRACES HERE, not load-bearing on its own — and that correction
    // came from a mutation that was supposed to turn the shell probe red and
    // didn't. Deleting this line changes nothing on this element, because
    // `overflow` other than `visible` already sets a flex item's automatic
    // minimum size to zero.
    //
    // `overflowY` below is what actually carries it: flipped to `visible` the
    // body grows past the frame, the frame's `overflow: hidden` clips it, and
    // the bottom of the content becomes unreachable — probe red, 368px below
    // the fold and scrollTop stuck at 0. This line stays because the pair is
    // the intent, and it is what keeps a later change to `overflowY` from
    // silently re-arming the defect.
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
  /**
   * Receives the screen's "open settings" handler, or `null` when no screen
   * is publishing one.
   *
   * WHY THIS ONE TRAVELS OUT AND THE BELL'S DOES NOT. The bell is rendered by
   * this component, so its published data can stop here. The account menu is
   * rendered by `App` into {@link AppShellProps.trailing} — ABOVE this
   * component — because it needs the auth service, which the shell
   * deliberately knows nothing about. So the handler has to keep going up.
   *
   * Optional: a shell without it simply never offers the row. See
   * `./shell-settings` for why the row is hidden rather than disabled.
   */
  readonly setOpenSettings?: (open: (() => void) | null) => void;
  readonly children: ReactNode;
}

export function AppShell({
  leading,
  trailing,
  setOpenSettings,
  children,
}: AppShellProps): React.JSX.Element {
  const styles = useStyles();
  /**
   * The status the current screen has published, or `null`.
   *
   * Held HERE rather than passed in as a prop, because the state is born
   * below this component — `epic.subscribe` lives in `EpicScreen` — and the
   * shell must stay a single instance at the top of the tree. See
   * `./shell-status`.
   */
  const [status, setStatus] = useState<EpicConnectionState | null>(null);
  /**
   * The bell's data, published from the screen that owns the feed, or `null`.
   *
   * Held here for the same reason as `status`, and rendered into the TRAILING
   * cluster beside sign-out — the region that survives navigation, which is
   * the whole argument for an app-level interrupt surface living in the frame.
   * See `./shell-notifications`.
   */
  const [notifications, setNotifications] = useState<ShellNotifications | null>(
    null,
  );
  /** The single scroll region below, handed out via context — see `./chat-scroll-container`. */
  const bodyRef = useRef<HTMLDivElement | null>(null);
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
        <div className={styles.trailing}>
          {/*
            BEFORE the caller's cluster, so the bell sits inboard of sign-out.
            Deliberate: the destructive control stays at the far edge, where it
            is hardest to hit by accident, and the bell is the one you reach
            for often.

            Absent entirely until a screen publishes — not a greyed-out bell.
            A control that cannot be told what is waiting has nothing to say,
            and rendering it anyway is the "affordance that silently does
            nothing" this client keeps finding.
          */}
          {notifications === null ? null : (
            <NotificationBell
              summary={notifications.summary}
              onClick={notifications.onOpen}
            />
          )}
          {trailing}
        </div>
      </header>
      {status === null ? null : (
        <div className={styles.status}>
          <EpicStatusRow state={status} />
        </div>
      )}
      {/*
        `data-shell-region` is for LOCATING this element, never for measuring
        it. The shell probe used to find the scrolling region as "the header's
        next sibling", which this commit breaks by inserting a region between
        them — a probe that navigates by structure breaks when the structure
        is the thing being changed.

        The distinction that matters, and the one a `data-` attribute got
        wrong once before: what is MEASURED here is scroll geometry, which the
        browser owns and cannot be faked by an attribute. An attribute
        asserting "this element persisted" was the probe that lied.
      */}
      <div ref={bodyRef} className={styles.body} data-shell-region="body">
        <ShellStatusProvider setStatus={setStatus}>
          <ShellNotificationsProvider setNotifications={setNotifications}>
            <ShellSettingsProvider
              setOpenSettings={setOpenSettings ?? NO_SETTINGS_SLOT}
            >
              <ChatScrollContainerProvider value={bodyRef}>
                {children}
              </ChatScrollContainerProvider>
            </ShellSettingsProvider>
          </ShellNotificationsProvider>
        </ShellStatusProvider>
      </div>
    </div>
  );
}
