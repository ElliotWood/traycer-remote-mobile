/**
 * The frame's bell — the app-level "something needs you" affordance.
 *
 * FOUR STATES, and they are the same four the mobile client's bell has,
 * because the state machine is about what is KNOWN and not about styling:
 *
 * | `summary`            | Renders           | Means                          |
 * | -------------------- | ----------------- | ------------------------------ |
 * | `null`               | bell, subtle dot  | no snapshot yet — NOT "none"   |
 * | zero / zero          | bell, nothing     | genuinely nothing waiting      |
 * | `unreadCount > 0`    | bell, brand dot   | unread, nothing blocking       |
 * | `attentionCount > 0` | bell, count badge | someone is blocked on a human  |
 *
 * THE `null` STATE IS THE ONE WORTH THE ROW. A bell that renders "clear"
 * before the first snapshot lands tells the user nothing is waiting at the
 * exact moment we do not know — the empty-versus-loading conflation, on the
 * surface where empty is the whole message. `EMPTY_FEED_STATE.summary` is
 * `null` for this reason and the bell honours it rather than defaulting to
 * zeroes.
 *
 * COUNTS ARE THE HOST'S. `attentionCount` and `unreadCount` come from the
 * feed's own `summary` and are never recomputed from the entries we happen to
 * hold — we hold a paged slice, so a locally-derived count would be a number
 * about our page rather than about the user's world, and it would be smaller
 * in exactly the situation where being smaller is worst.
 *
 * WHY IT LIVES IN THE FRAME. Same argument as the sign-out button beside it:
 * the trailing slot survives navigation and survives a screen throwing, and an
 * interrupt surface reachable only from one screen is reachable only if you
 * can get to that screen.
 */
import type { ReactElement } from "react";
import {
  Button,
  CounterBadge,
  makeStyles,
  mergeClasses,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import { AlertRegular } from "@fluentui/react-icons";
import type { HostNotificationsSummary } from "@traycer/protocol/host/notifications/host-notifications";

const useStyles = makeStyles({
  /** Anchors the badge/dot, which are absolutely positioned over the icon. */
  wrap: {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
  },
  badge: {
    position: "absolute",
    top: "-2px",
    right: "-2px",
    pointerEvents: "none",
  },
  dot: {
    position: "absolute",
    top: "4px",
    right: "4px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    pointerEvents: "none",
  },
  /** Unread, nothing blocking — present but not alarming. */
  dotUnread: { backgroundColor: tokens.colorBrandBackground },
  /**
   * No snapshot yet. Deliberately the LOW-contrast neutral: it must read as
   * "not known" rather than as a quieter kind of "you have mail".
   */
  dotUnknown: { backgroundColor: tokens.colorNeutralForeground4 },
});

export interface NotificationBellProps {
  /** `null` until the first snapshot. Not the same as all-zero. */
  readonly summary: HostNotificationsSummary | null;
  readonly onClick: () => void;
}

/**
 * The label is the accessible name AND the tooltip, so the state is available
 * to a screen reader and not only to a sighted user reading a coloured dot.
 * A count badge with no text alternative is the version of this control that
 * announces "button".
 */
export function notificationBellLabel(
  summary: HostNotificationsSummary | null,
): string {
  if (summary === null) return "Notifications — still loading";
  if (summary.attentionCount > 0) {
    return `Notifications, ${String(summary.attentionCount)} ${summary.attentionCount === 1 ? "needs" : "need"} attention`;
  }
  if (summary.unreadCount > 0) {
    return `Notifications, ${String(summary.unreadCount)} unread`;
  }
  return "Notifications";
}

export function NotificationBell({
  summary,
  onClick,
}: NotificationBellProps): ReactElement {
  const styles = useStyles();
  const label = notificationBellLabel(summary);
  const attentionCount = summary?.attentionCount ?? 0;
  const unreadCount = summary?.unreadCount ?? 0;

  return (
    <Tooltip content={label} relationship="label" withArrow>
      <div className={styles.wrap}>
        <Button
          size="small"
          appearance="subtle"
          aria-label={label}
          icon={<AlertRegular />}
          onClick={onClick}
        />
        {attentionCount > 0 ? (
          <CounterBadge
            className={styles.badge}
            appearance="filled"
            color="danger"
            size="small"
            // Capped by Fluent's own overflow rendering ("9+"), so a user with
            // 200 blocked agents gets a badge that still fits the 40px header
            // rather than one that widens it.
            overflowCount={9}
            count={attentionCount}
            aria-hidden="true"
          />
        ) : summary === null ? (
          <span
            className={mergeClasses(styles.dot, styles.dotUnknown)}
            aria-hidden="true"
          />
        ) : unreadCount > 0 ? (
          <span
            className={mergeClasses(styles.dot, styles.dotUnread)}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </Tooltip>
  );
}
