/**
 * The notification writes, asserted on the WIRE rather than on the return
 * value — every one of these resolves to `{}`, so a call that sent the wrong
 * request and a call that sent the right one are indistinguishable downstream.
 * What is checked here is the method name and the payload.
 */
import { describe, expect, it } from "vitest";
import {
  markAllNotificationsRead,
  markNotificationEntityRead,
  markNotificationsRead,
  resolveNotifications,
  type HostNotificationMutationClient,
} from "../host-notification-mutations";

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
  // ONE assertion, onto the client's own `request` type rather than a chained
  // `as unknown as` past it — so the fake is checked against the real
  // signature instead of smuggled around it.
  const request = ((method: string, params: unknown) => {
    calls.push({ method, params });
    return Promise.resolve({});
  }) as HostNotificationMutationClient["request"];
  return { client: { request }, calls };
}

describe("markNotificationsRead", () => {
  it("sends the ids variant", async () => {
    const { client, calls } = fakeClient();
    await markNotificationsRead(client, ["a", "b"]);
    expect(calls).toEqual([
      { method: "host.notifications.markRead", params: { kind: "ids", ids: ["a", "b"] } },
    ]);
  });

  /**
   * An empty selection is a NO-OP, not an empty request. The host would accept
   * `ids: []` and do nothing, so sending it is a round trip that changes
   * nothing — and this is the call a "mark selected read" handler makes when
   * nothing is selected.
   */
  it("sends NOTHING for an empty list", async () => {
    const { client, calls } = fakeClient();
    await markNotificationsRead(client, []);
    expect(calls).toEqual([]);
  });
});

describe("markNotificationEntityRead", () => {
  it("sends the entity variant", async () => {
    const { client, calls } = fakeClient();
    await markNotificationEntityRead(client, { epicId: "e1", chatId: "c1" });
    expect(calls).toEqual([
      {
        method: "host.notifications.markRead",
        params: { kind: "entity", entity: { epicId: "e1", chatId: "c1" } },
      },
    ]);
  });
});

describe("markAllNotificationsRead", () => {
  /**
   * THE CUTOFF IS THE CALLER'S, and this is the assertion that keeps it that
   * way. `beforeUpdatedAt` decides which notifications get marked read without
   * ever being seen, so a function that quietly substituted `Date.now()` would
   * mark rows that arrived after the button was pressed. Passing a value the
   * wall clock could never produce is what makes that substitution visible.
   */
  it("sends the cutoff it was given, never its own clock", async () => {
    const { client, calls } = fakeClient();
    await markAllNotificationsRead(client, 1_234);
    expect(calls).toEqual([
      { method: "host.notifications.markAllRead", params: { beforeUpdatedAt: 1_234 } },
    ]);
  });
});

describe("resolveNotifications", () => {
  /**
   * `sourceRef` is forwarded AS-IS, including `null`. The host matches the
   * occurrence token null-safely — a null token only matches a null-sourceRef
   * row — so substituting a value we invented would resolve a different row,
   * or nothing.
   */
  it("forwards the occurrence token unchanged, null sourceRef included", async () => {
    const { client, calls } = fakeClient();
    await resolveNotifications(client, [
      { id: "n1", updatedAt: 10, sourceRef: "ap-1" },
      { id: "n2", updatedAt: 20, sourceRef: null },
    ]);
    expect(calls).toEqual([
      {
        method: "host.notifications.resolve",
        params: {
          occurrences: [
            { id: "n1", updatedAt: 10, sourceRef: "ap-1" },
            { id: "n2", updatedAt: 20, sourceRef: null },
          ],
        },
      },
    ]);
  });

  it("sends nothing for an empty list", async () => {
    const { client, calls } = fakeClient();
    await resolveNotifications(client, []);
    expect(calls).toEqual([]);
  });
});
