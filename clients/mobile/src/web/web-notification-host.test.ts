import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_CLICK_ACK_MESSAGE,
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_CLIENT_READY_MESSAGE,
  createWebNotificationHost,
  readNotificationPermission,
  type NotificationServiceWorkerHost,
} from "./web-notification-host";

interface Shown {
  title: string;
  body: string;
  data: unknown;
  tag: string | undefined;
}

function fakeServiceWorker(): {
  container: NotificationServiceWorkerHost;
  shown: Shown[];
  toWorker: unknown[];
  emit: (data: unknown) => void;
  listenerCount: () => number;
} {
  const shown: Shown[] = [];
  const toWorker: unknown[] = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  const registration = {
    showNotification: async (
      title: string,
      options: { body: string; data: unknown; tag?: string | undefined },
    ): Promise<void> => {
      shown.push({
        title,
        body: options.body,
        data: options.data,
        tag: options.tag,
      });
    },
  };
  const container: NotificationServiceWorkerHost = {
    ready: Promise.resolve(registration),
    controller: {
      postMessage: (message: unknown): void => {
        toWorker.push(message);
      },
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    container,
    shown,
    toWorker,
    emit: (data: unknown) => {
      for (const listener of [...listeners]) listener({ data });
    },
    listenerCount: () => listeners.size,
  };
}

const GRANTED = (): string => "granted";

/** A V1 activation envelope, shaped as `notification-display.ts` builds it. */
const ENVELOPE = {
  kind: "notificationActivation",
  version: 1,
  route: { kind: "chat", epicId: "epic-1", chatId: "chat-9" },
  feed: { source: "host", id: "feed-3" },
  originHostId: "host-7",
};

describe("createWebNotificationHost", () => {
  describe("show", () => {
    it("displays through the service-worker registration", async () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });

      await host.show(
        "Agent blocked",
        "Needs approval",
        ENVELOPE,
        null,
        null,
        null,
      );

      expect(sw.shown).toEqual([
        {
          title: "Agent blocked",
          body: "Needs approval",
          data: ENVELOPE,
          tag: undefined,
        },
      ]);
    });

    it("carries the payload through UNCHANGED, field for field", async () => {
      // The whole design rests on this. Upstream builds the envelope and
      // upstream parses it back; anything this shell does to it in between -
      // dropping `originHostId`, flattening `route`, coercing a null - lands as
      // a click that routes to the wrong place or opens the notification center
      // instead. A field-by-field assertion would only cover the fields
      // somebody thought of, so this compares the whole object.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });

      await host.show("t", "b", ENVELOPE, null, null, null);

      expect(sw.shown[0]?.data).toEqual(ENVELOPE);
    });

    it("keeps a null payload NULL rather than dropping it to undefined", async () => {
      // Upstream sends `null` for a row with nowhere to route, and the focus
      // bridge distinguishes "unroutable" from "unknown": one opens the
      // notification center, the other is a parse failure. `undefined` here
      // would silently convert the first into the second.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });

      await host.show("t", "b", null, null, null, null);

      expect(sw.shown[0]?.data).toBeNull();
    });

    it("maps replaceKey onto the notification tag", async () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });

      await host.show("t", "b", null, "epic-1", null, null);

      expect(sw.shown[0]?.tag).toBe("epic-1");
    });

    it("REJECTS when permission is not granted, so the receipt stays pending", async () => {
      // Load-bearing, and the reason it is a rejection rather than a silent
      // return: `NotificationEmissionController` records a display receipt in
      // `.then()` and keeps it pending in `.catch()`. Resolving here would mark
      // an undisplayed backlog as delivered, and granting permission later
      // would then surface none of it.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: () => "default",
      });

      await expect(host.show("t", "b", null, null, null, null)).rejects.toThrow(
        /permission is "default"/,
      );
      expect(sw.shown).toEqual([]);
    });

    it("rejects when the client has no service worker at all", async () => {
      const host = createWebNotificationHost({
        serviceWorker: undefined,
        getPermission: GRANTED,
      });
      await expect(host.show("t", "b", null, null, null, null)).rejects.toThrow(
        /no service worker/,
      );
    });
  });

  describe("a permanently blocked surface", () => {
    it("RESOLVES rather than rejecting, so the row is not retried forever", async () => {
      // The counterpart to "REJECTS when permission is not granted" above,
      // and the pair is the whole finding: same denial, opposite next action.
      // Rejecting here tells upstream to retry at a later mount, on a surface
      // measured to have no later mount that could succeed.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: () => "denied",
        isSurfaceBlocked: () => true,
        report: () => undefined,
      });

      await expect(
        host.show("t", "b", null, null, null, null),
      ).resolves.toBeUndefined();
      // Resolving is NOT a claim that anything was drawn.
      expect(sw.shown).toEqual([]);
    });

    it("reports surface-blocked, distinctly from a transient refusal", async () => {
      const sw = fakeServiceWorker();
      const outcomes: string[] = [];
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: () => "denied",
        isSurfaceBlocked: () => true,
        report: (outcome) => outcomes.push(outcome),
      });
      await host.show("t", "b", null, null, null, null);
      expect(outcomes).toEqual(["idle", "surface-blocked"]);
    });

    it("still DISPLAYS when the surface is embedded but the grant is held", async () => {
      // The control that keeps the branch honest, and the reason the surface
      // question is asked only AFTER the permission has failed. A same-origin
      // frame is embedded AND granted - measured - so an implementation that
      // checked the surface first would withhold notifications from a surface
      // that honours them, causing the defect it was written to describe.
      const sw = fakeServiceWorker();
      const outcomes: string[] = [];
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
        isSurfaceBlocked: () => true,
        report: (outcome) => outcomes.push(outcome),
      });

      await host.show("t", "b", null, null, null, null);
      expect(sw.shown.map((entry) => entry.title)).toEqual(["t"]);
      expect(outcomes).toEqual(["idle", "shown"]);
    });

    it("keeps rejecting where the denial is merely transient", async () => {
      const sw = fakeServiceWorker();
      const outcomes: string[] = [];
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: () => "denied",
        isSurfaceBlocked: () => false,
        report: (outcome) => outcomes.push(outcome),
      });

      await expect(host.show("t", "b", null, null, null, null)).rejects.toThrow(
        /permission is "denied"/,
      );
      expect(outcomes).toEqual(["idle", "permission"]);
    });

    it("stamps idle at construction, before anything has been asked of it", () => {
      const sw = fakeServiceWorker();
      const outcomes: string[] = [];
      createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
        report: (outcome) => outcomes.push(outcome),
      });
      // Absent would read identically to "older bundle", "boot path threw" and
      // "fine, never exercised" - and on a quiet day nothing else ever writes.
      expect(outcomes).toEqual(["idle"]);
    });

    it("treats a cross-origin frame as blocked by default, with no injection", async () => {
      // The DEFAULT is what production runs; every row above injects it. This
      // is the one that fails if the wiring to `embedding.ts` is dropped.
      const sw = fakeServiceWorker();
      const outcomes: string[] = [];
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: () => "denied",
        report: (outcome) => outcomes.push(outcome),
      });
      // jsdom is top level, so the default must read NOT blocked here.
      await expect(host.show("t", "b", null, null, null, null)).rejects.toThrow(
        /permission is "denied"/,
      );
      expect(outcomes).toEqual(["idle", "permission"]);
    });
  });

  describe("onClick", () => {
    it("hands the worker's payload to the handler unchanged", () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });
      const handler = vi.fn();
      host.onClick(handler);

      sw.emit({
        type: NOTIFICATION_CLICK_MESSAGE,
        id: "click-1",
        payload: ENVELOPE,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(ENVELOPE);
    });

    it("announces itself to the worker so a cold-open tap can be delivered", () => {
      // The whole cold-open path hangs off this one message. A tap while the
      // app is CLOSED opens a window whose click listener does not exist yet,
      // so the worker's send is dropped with no error; it holds the payload and
      // waits to be told a listener now exists.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });

      host.onClick(vi.fn());

      expect(sw.toWorker).toEqual([
        { type: NOTIFICATION_CLIENT_READY_MESSAGE },
      ]);
    });

    it("acknowledges every delivery, including a redelivered one", () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });
      host.onClick(vi.fn());
      sw.toWorker.length = 0;

      sw.emit({ type: NOTIFICATION_CLICK_MESSAGE, id: "click-1", payload: 1 });
      sw.emit({ type: NOTIFICATION_CLICK_MESSAGE, id: "click-1", payload: 1 });

      expect(sw.toWorker).toEqual([
        { type: NOTIFICATION_CLICK_ACK_MESSAGE, id: "click-1" },
        { type: NOTIFICATION_CLICK_ACK_MESSAGE, id: "click-1" },
      ]);
    });

    it("routes a redelivered click ONCE", () => {
      // The worker resends on a timer until acknowledged and flushes to every
      // open window, both deliberately. Routing each arrival would navigate the
      // user to the same chat repeatedly while the ack was in flight.
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });
      const handler = vi.fn();
      host.onClick(handler);

      sw.emit({
        type: NOTIFICATION_CLICK_MESSAGE,
        id: "click-1",
        payload: ENVELOPE,
      });
      sw.emit({
        type: NOTIFICATION_CLICK_MESSAGE,
        id: "click-1",
        payload: ENVELOPE,
      });
      sw.emit({
        type: NOTIFICATION_CLICK_MESSAGE,
        id: "click-2",
        payload: ENVELOPE,
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("ignores messages that are not ours", () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });
      const handler = vi.fn();
      host.onClick(handler);

      sw.emit({ type: "workbox-broadcast-update" });
      sw.emit("a string");
      sw.emit(null);
      sw.emit(undefined);

      expect(handler).not.toHaveBeenCalled();
    });

    it("removes its listener on dispose", () => {
      const sw = fakeServiceWorker();
      const host = createWebNotificationHost({
        serviceWorker: sw.container,
        getPermission: GRANTED,
      });
      const subscription = host.onClick(vi.fn());
      expect(sw.listenerCount()).toBe(1);

      subscription.dispose();

      expect(sw.listenerCount()).toBe(0);
    });

    it("is inert, not broken, with no service worker", () => {
      const host = createWebNotificationHost({
        serviceWorker: undefined,
        getPermission: GRANTED,
      });
      expect(() => host.onClick(vi.fn()).dispose()).not.toThrow();
    });
  });

  describe("readNotificationPermission", () => {
    it("reports unsupported rather than throwing where Notification is absent", () => {
      // jsdom has no `Notification`, which is also the state on an insecure
      // origin and in some cross-origin frame configurations - including the
      // Teams tab this same bundle serves. A bare `Notification.permission`
      // there is a ReferenceError thrown out of whatever called `show()`.
      expect(
        (globalThis as { Notification?: unknown }).Notification,
      ).toBeUndefined();
      expect(readNotificationPermission()).toBe("unsupported");
    });
  });
});
