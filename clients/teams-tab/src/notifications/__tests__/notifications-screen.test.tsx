/**
 * @vitest-environment jsdom
 *
 * The screen's three decisions, none of which are visible in the markup:
 *
 *   1. **Dismiss means different things per kind.** An approval/interview is
 *      RESOLVED; anything else is marked read. Getting this backwards hides
 *      the row while leaving the agent still waiting — the failure looks like
 *      success on screen and only shows up as an agent that never resumes.
 *   2. **"Needs attention" is not narrowed by the unread toggle**, because its
 *      definition already includes unread.
 *   3. **"Mark all read" is driven by the HOST's count**, not by what this
 *      page holds. We hold a paged slice.
 *
 * Each is asserted through the request that reaches the client, because all
 * three writes resolve to `{}` and the UI looks identical either way.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  hostNotificationEntrySchema,
  type HostNotificationEntry,
} from "@traycer/protocol/host/notifications/host-notifications";
import type { HostNotificationMutationClient } from "@traycer-clients/shared/epic/host-notification-mutations";
import { NotificationsScreen } from "../notifications-screen";
import type { NotificationsState } from "../use-notifications";

/**
 * jsdom has no `ResizeObserver`, and Fluent's `MessageBar` constructs one to
 * decide whether to reflow. This is the FIRST test in the package to render a
 * `MessageBar` — `sign-in`, `fleet-state` and both authoring forms all use one
 * and none of them are render-tested — so the stub lands here rather than in
 * shared setup.
 *
 * It is a stub, not a fake: reflow behaviour is not what these tests are
 * about, and a stub that never fires callbacks keeps the component on its
 * non-reflowed path deterministically. If a future test asserts ON reflow it
 * needs a real implementation, and this comment is the warning that it will
 * not get one from here.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
// Assigned, not asserted. `implements ResizeObserver` is what makes the cast
// unnecessary — and it also means a future change to the DOM lib's shape
// breaks here loudly rather than being papered over by an `as unknown as`.
globalThis.ResizeObserver = NoopResizeObserver;

afterEach(() => {
  cleanup();
});

const NOW = new Date(2026, 7, 3, 12, 0).getTime();

function entry(over: Record<string, unknown>): HostNotificationEntry {
  return hostNotificationEntrySchema.parse({
    id: "n1",
    kind: "approval.requested",
    outcome: null,
    resolvedAt: null,
    severity: "needs_action",
    updatedAt: NOW - 60_000,
    readAt: null,
    sourceRef: "ap-1",
    epicId: "e1",
    chatId: "c1",
    payload: {},
    ...over,
  });
}

/** What the fake records. Named so the assertions read as wire traffic. */
interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
}

interface FakeClient {
  readonly client: HostNotificationMutationClient;
  readonly calls: RecordedCall[];
}

function fakeClient(): FakeClient {
  const calls: RecordedCall[] = [];
  // ONE assertion, onto the client's own `request` type. The rule against
  // chained `as unknown as` is what forced this shape, and it is the better
  // one: the fake is checked against the real signature rather than smuggled
  // past it.
  const request = ((method: string, params: unknown) => {
    calls.push({ method, params });
    return Promise.resolve({});
  }) as HostNotificationMutationClient["request"];
  return { client: { request }, calls };
}

/** Every argument explicit — no defaults, per this package's lint rule. */
function ready(
  entries: readonly HostNotificationEntry[],
  summary: { unreadCount: number; attentionCount: number } | null,
): NotificationsState {
  return { kind: "ready", entries, summary, epicTitles: {} };
}

function renderScreen(
  state: NotificationsState,
  client: HostNotificationMutationClient | null,
): void {
  render(
    <NotificationsScreen
      state={state}
      client={client}
      now={NOW}
      onOpenChat={vi.fn()}
      onOpenEpic={vi.fn()}
    />,
  );
}

describe("dismiss", () => {
  it("RESOLVES an approval rather than marking it read", () => {
    const { client, calls } = fakeClient();
    renderScreen(
      ready([entry({ id: "n1", sourceRef: "ap-1" })], {
        unreadCount: 1,
        attentionCount: 1,
      }),
      client,
    );
    fireEvent.click(screen.getByLabelText(/^Dismiss:/));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("host.notifications.resolve");
    expect(calls[0].params).toEqual({
      occurrences: [{ id: "n1", updatedAt: NOW - 60_000, sourceRef: "ap-1" }],
    });
  });

  it("marks a non-resolvable row read instead", () => {
    const { client, calls } = fakeClient();
    renderScreen(
      ready([
        entry({
          id: "n9",
          kind: "agent.stopped",
          outcome: "completed",
          severity: "done",
          sourceRef: null,
          payload: { outcome: "completed" },
        }),
      ], { unreadCount: 1, attentionCount: 0 }),
      client,
    );
    fireEvent.click(screen.getByLabelText(/^Dismiss:/));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("host.notifications.markRead");
    expect(calls[0].params).toEqual({ kind: "ids", ids: ["n9"] });
  });
});

describe("the unread-only toggle", () => {
  /**
   * The attention row is unread AND blocking; the recent row is read. Turning
   * the toggle on must remove the read one and leave the blocking one — a
   * filter applied to both sections would empty the section it exists to
   * protect.
   */
  it("narrows recent activity but never Needs attention", () => {
    const { client } = fakeClient();
    renderScreen(
      ready([
        entry({ id: "blocking", severity: "needs_action", readAt: null }),
        entry({
          id: "read-row",
          kind: "agent.stopped",
          outcome: "completed",
          severity: "done",
          sourceRef: null,
          readAt: NOW - 30_000,
          payload: { outcome: "completed" },
        }),
      ], { unreadCount: 1, attentionCount: 1 }),
      client,
    );
    expect(screen.queryByText("Needs attention")).not.toBeNull();
    expect(screen.queryByText("Today")).not.toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: /unread only/i }));

    // The read row's whole section is gone; the blocking one is untouched.
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Needs attention")).not.toBeNull();
  });
});

describe("mark all read", () => {
  /**
   * THE HOST'S COUNT DECIDES. This state holds an unread entry but the host
   * says nothing is unread — which happens whenever our page is stale or
   * partial. The button follows the host, so a locally-derived `disabled`
   * would light it up here and send a write that changes nothing.
   */
  it("is disabled on the host's zero even while a local row looks unread", () => {
    const { client } = fakeClient();
    renderScreen(
      ready([entry({ id: "n1", readAt: null })], { unreadCount: 0, attentionCount: 0 }),
      client,
    );
    expect(
      screen.getByRole("button", { name: /mark all read/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("sends this render's clock as the cutoff", () => {
    const { client, calls } = fakeClient();
    renderScreen(ready([entry({ id: "n1" })], { unreadCount: 2, attentionCount: 1 }), client);
    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    expect(calls).toEqual([
      { method: "host.notifications.markAllRead", params: { beforeUpdatedAt: NOW } },
    ]);
  });
});

describe("states", () => {
  it("says loading rather than caught-up before the snapshot", () => {
    renderScreen({ kind: "loading" }, null);
    expect(screen.queryByText(/all caught up/i)).toBeNull();
    screen.getByText(/loading notifications/i);
  });

  it("surfaces a stream error instead of an empty list", () => {
    renderScreen({ kind: "error", detail: "stream closed" }, null);
    expect(screen.queryByText(/all caught up/i)).toBeNull();
    screen.getByText("stream closed");
  });

  it("shows the caught-up state only when the feed is genuinely empty", () => {
    renderScreen(ready([], { unreadCount: 0, attentionCount: 0 }), null);
    screen.getByText(/all caught up/i);
  });

  /**
   * With no host there is nothing to write to, so the controls are disabled
   * rather than dead — the "affordance that silently does nothing" this client
   * keeps finding.
   */
  it("disables the writes when there is no client", () => {
    renderScreen(ready([entry({ id: "n1" })], { unreadCount: 5, attentionCount: 1 }), null);
    expect(
      screen.getByRole("button", { name: /mark all read/i }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByLabelText(/^Dismiss:/).hasAttribute("disabled")).toBe(true);
  });
});
