/**
 * Pure + mocked-global coverage for S5 (C): the transition detector (the F1
 * fix's shared primitive) plus the permission/delivery wrappers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBlockedTransitions,
  getNotificationPermission,
  notifyBlocked,
  requestNotificationPermission,
  type BlockedState,
} from "../notifications";

describe("detectBlockedTransitions", () => {
  function state(blocked: boolean): BlockedState {
    return { blocked };
  }

  it("never fires on first observation, even if already blocked", () => {
    const prev = {};
    const next = { c1: state(true) };
    expect(detectBlockedTransitions(prev, next)).toEqual([]);
  });

  it("fires on a real false→true transition", () => {
    const prev = { c1: state(false) };
    const next = { c1: state(true) };
    expect(detectBlockedTransitions(prev, next)).toEqual(["c1"]);
  });

  it("does not re-fire while a chat stays blocked across successive calls", () => {
    const prev = { c1: state(true) };
    const next = { c1: state(true) };
    expect(detectBlockedTransitions(prev, next)).toEqual([]);
  });

  it("fires again after an unblock→reblock cycle", () => {
    // Simulates the caller threading `next` back in as the following `prev`.
    let prev: Record<string, BlockedState> = { c1: state(false) };
    let next: Record<string, BlockedState> = { c1: state(true) };
    expect(detectBlockedTransitions(prev, next)).toEqual(["c1"]);

    prev = next;
    next = { c1: state(false) };
    expect(detectBlockedTransitions(prev, next)).toEqual([]); // unblocking never fires

    prev = next;
    next = { c1: state(true) };
    expect(detectBlockedTransitions(prev, next)).toEqual(["c1"]); // reblock fires again
  });

  it("handles multiple chats independently in one map", () => {
    const prev = { a: state(false), b: state(true), c: state(false) };
    const next = { a: state(true), b: state(true), c: state(false) };
    expect(detectBlockedTransitions(prev, next)).toEqual(["a"]);
  });

  it("ignores an id present in prev but absent from next (chat removed)", () => {
    const prev = { c1: state(false) };
    const next = {};
    expect(detectBlockedTransitions(prev, next)).toEqual([]);
  });
});

describe("getNotificationPermission / requestNotificationPermission", () => {
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;

  afterEach(() => {
    (globalThis as { Notification?: unknown }).Notification = originalNotification;
  });

  it("reports 'unsupported' when Notification doesn't exist", () => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(getNotificationPermission()).toBe("unsupported");
  });

  it("reads the live Notification.permission", () => {
    (globalThis as { Notification?: unknown }).Notification = { permission: "denied" };
    expect(getNotificationPermission()).toBe("denied");
  });

  it("requestNotificationPermission delegates to Notification.requestPermission", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    (globalThis as { Notification?: unknown }).Notification = { requestPermission };
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("requestNotificationPermission never throws past the caller on rejection", async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockRejectedValue(new Error("boom")),
    };
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });
});

describe("notifyBlocked", () => {
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    (globalThis as { Notification?: unknown }).Notification = originalNotification;
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("does nothing when permission is not granted", async () => {
    (globalThis as { Notification?: unknown }).Notification = { permission: "denied" };
    const showNotification = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
      configurable: true,
    });

    await notifyBlocked({ epicId: "e1", chatId: "c1", chatTitle: "Fix bug" });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("shows a notification via the SW registration when permission is granted", async () => {
    (globalThis as { Notification?: unknown }).Notification = { permission: "granted" };
    const showNotification = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
      configurable: true,
    });

    await notifyBlocked({ epicId: "e1", chatId: "c1", chatTitle: "Fix bug" });

    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe("Fix bug");
    expect(options).toMatchObject({
      body: "Waiting on you",
      tag: "blocked:e1:c1",
      data: { epicId: "e1", chatId: "c1" },
    });
  });

  it("never throws past the caller when serviceWorker is unavailable", async () => {
    (globalThis as { Notification?: unknown }).Notification = { permission: "granted" };
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });

    await expect(
      notifyBlocked({ epicId: "e1", chatId: "c1", chatTitle: "Fix bug" }),
    ).resolves.toBeUndefined();
  });
});
