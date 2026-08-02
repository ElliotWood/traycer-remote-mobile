/**
 * The bell's slot in the frame — the same seam as `./shell-status`, for the
 * same reason and with one extra constraint.
 *
 * THE CONSTRAINT. The shell must stay ONE instance (a second one costs the
 * frame's whole purpose — measured at `mounts 1 -> 2` when it happened), so it
 * lives at the top of `App`. The notification summary is born BELOW it, in the
 * screen that owns the host connection, because a subscription cannot be
 * opened behind a conditional. State born below the frame has to travel up to
 * be rendered inside it.
 *
 * WHY A CALLBACK TRAVELS TOO, when `shell-status` deliberately carries only
 * data. The bell has to navigate, and navigation state is NOT global here:
 * `useRoute` holds its own `useState` per call site, so a bell calling its own
 * `useRoute().navigate` would push the URL and update the shell's copy of the
 * route while the screen's copy — the one that decides what renders — never
 * heard about it. The address bar would change and the page would not. So the
 * screen that owns the route publishes the handler, and the frame calls it.
 *
 * THE HANDLER MUST BE STABLE. It is in the publishing effect's dependency
 * list, so a fresh closure each render republishes each render. `useCallback`
 * over `navigate` (itself stable) is what makes that true — this is the same
 * hazard `shell-status` avoids by refusing to carry a `ReactNode`, arriving
 * through the one door that has to stay open.
 */
import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { HostNotificationsSummary } from "@traycer/protocol/host/notifications/host-notifications";

/** What the frame needs in order to render a bell: the counts and a way in. */
export interface ShellNotifications {
  /** `null` until the first snapshot — see `NotificationBell`. */
  readonly summary: HostNotificationsSummary | null;
  /** MUST be referentially stable. See the module docblock. */
  readonly onOpen: () => void;
}

export type ShellNotificationsSetter = (
  value: ShellNotifications | null,
) => void;

/**
 * Defaults to a NO-OP rather than throwing.
 *
 * A screen rendered outside the shell — a preview harness, a test — should
 * lose its bell, not crash. Same call as `shell-status` makes: a missing frame
 * is a developer's problem, not a user's.
 */
const ShellNotificationsContext = createContext<ShellNotificationsSetter>(
  () => undefined,
);

export function ShellNotificationsProvider({
  setNotifications,
  children,
}: {
  readonly setNotifications: ShellNotificationsSetter;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ShellNotificationsContext.Provider value={setNotifications}>
      {children}
    </ShellNotificationsContext.Provider>
  );
}

/**
 * Publish the feed summary into the frame's bell.
 *
 * The dependency list is the summary's FIELDS, not the object, because the
 * object is rebuilt on every render of the screen that owns it — the identical
 * rule `useShellStatus` documents, and for the identical reason.
 *
 * `null` clears the slot, and so does unmount. A signed-out or previewing
 * screen therefore shows NO bell rather than an empty one: a bell that cannot
 * be told what is waiting is an affordance that silently does nothing, which
 * is the class of defect this client keeps finding.
 */
export function useShellNotifications(
  summary: HostNotificationsSummary | null,
  onOpen: (() => void) | null,
): void {
  const setNotifications = useContext(ShellNotificationsContext);
  const attentionCount = summary?.attentionCount ?? null;
  const unreadCount = summary?.unreadCount ?? null;
  useEffect(() => {
    if (onOpen === null) {
      setNotifications(null);
      return;
    }
    setNotifications({ summary, onOpen });
    return () => {
      setNotifications(null);
    };
    // `summary` is deliberately absent: `attentionCount` and `unreadCount` are
    // its entire identity, and depending on the object republishes every
    // render. See the module docblock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNotifications, attentionCount, unreadCount, onOpen]);
}
