/**
 * @vitest-environment jsdom
 *
 * The bell's four states, and the one that matters is `null`.
 *
 * A bell that renders "clear" before the first snapshot tells the user nothing
 * is waiting at the exact moment we do not know — which is the empty-versus-
 * loading conflation on the surface where empty IS the message. The feed's own
 * `EMPTY_FEED_STATE.summary` is `null` for this reason, and these tests are
 * what stop a later "sensible default" of `{0,0}` from throwing it away.
 *
 * ASSERTED ON THE ACCESSIBLE NAME, not on the dot's colour. The name is what a
 * screen reader gets and it is the only part of this control that carries the
 * state in text — a test on class names would pass against a bell that
 * announces "button" and nothing else.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NotificationBell, notificationBellLabel } from "../notification-bell";

// Explicit — `globals` is unset in this package, so nothing registers this for
// us and every render would otherwise stack in the same document.
afterEach(() => {
  cleanup();
});

describe("notificationBellLabel", () => {
  it("distinguishes not-yet-known from nothing-waiting", () => {
    expect(notificationBellLabel(null)).toBe("Notifications — still loading");
    expect(notificationBellLabel({ unreadCount: 0, attentionCount: 0 })).toBe(
      "Notifications",
    );
  });

  it("reports attention ahead of unread, since attention is the blocking count", () => {
    expect(notificationBellLabel({ unreadCount: 9, attentionCount: 2 })).toBe(
      "Notifications, 2 need attention",
    );
  });

  it("singularises one", () => {
    expect(notificationBellLabel({ unreadCount: 1, attentionCount: 1 })).toBe(
      "Notifications, 1 needs attention",
    );
  });

  it("falls back to the unread count when nothing is blocking", () => {
    expect(notificationBellLabel({ unreadCount: 3, attentionCount: 0 })).toBe(
      "Notifications, 3 unread",
    );
  });
});

describe("NotificationBell", () => {
  it("renders the attention COUNT when something is blocking", () => {
    render(
      <NotificationBell
        summary={{ unreadCount: 9, attentionCount: 2 }}
        onClick={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: /2 need attention/i });
    // The badge itself, not just the name — this is the visible signal.
    expect(screen.getByText("2")).toBeDefined();
  });

  /**
   * The count is the HOST's `attentionCount`, and the unread count must not
   * leak into the badge. A bell showing 9 when 2 need action teaches the user
   * to ignore the badge, which is the failure mode the whole control has.
   */
  it("does not show the unread count as the badge", () => {
    render(
      <NotificationBell
        summary={{ unreadCount: 9, attentionCount: 2 }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText("9")).toBeNull();
  });

  it("shows no count when nothing is blocking", () => {
    render(
      <NotificationBell
        summary={{ unreadCount: 3, attentionCount: 0 }}
        onClick={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: /3 unread/i });
    expect(screen.queryByText("3")).toBeNull();
  });

  it("says loading rather than clear before the first snapshot", () => {
    render(<NotificationBell summary={null} onClick={vi.fn()} />);
    screen.getByRole("button", { name: /still loading/i });
  });

  it("calls onClick exactly once when pressed", () => {
    const onClick = vi.fn<() => void>();
    render(
      <NotificationBell
        summary={{ unreadCount: 0, attentionCount: 0 }}
        onClick={onClick}
      />,
    );
    screen.getByRole("button", { name: "Notifications" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
