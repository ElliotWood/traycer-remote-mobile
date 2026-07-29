// @vitest-environment jsdom
/**
 * The property that actually matters: clearing the caches must NOT sign the
 * user out. Re-doing a device-code flow on a phone is a real cost, and the
 * whole point of this button is that it's a cheap thing to reach for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalData } from "@/host/clear-local-data";

const AUTH_KEY = "traycer.mobile.auth";

function seedStorage(): void {
  window.localStorage.clear();
  window.localStorage.setItem(AUTH_KEY, '{"token":"keep-me"}');
  window.localStorage.setItem("chat-cache:v1:epic-1:chat-1", "{}");
  window.localStorage.setItem("epic-proj:v1:epic-1", "{}");
  window.localStorage.setItem("artifact-body:v1:room:art", "{}");
  window.localStorage.setItem("traycer.mobile.lastSeen.epic-1.node-1", "123");
  window.localStorage.setItem("traycer-remote:query-cache", "{}");
  // A key from a PREVIOUS cache-schema version. Nothing evicts these today,
  // so a version-specific sweep would strand them forever — the prefix match
  // is what makes the button mean "clear everything stale".
  window.localStorage.setItem("chat-cache:v0:epic-1:chat-old", "{}");
  // Unrelated third-party key — must survive.
  window.localStorage.setItem("some.other.app", "untouched");
}

describe("clearLocalData", () => {
  beforeEach(() => {
    seedStorage();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps the user signed in", async () => {
    await clearLocalData();
    expect(window.localStorage.getItem(AUTH_KEY)).toBe('{"token":"keep-me"}');
  });

  it("removes every cache prefix, including stale older versions", async () => {
    const result = await clearLocalData();

    expect(window.localStorage.getItem("chat-cache:v1:epic-1:chat-1")).toBeNull();
    expect(window.localStorage.getItem("chat-cache:v0:epic-1:chat-old")).toBeNull();
    expect(window.localStorage.getItem("epic-proj:v1:epic-1")).toBeNull();
    expect(window.localStorage.getItem("artifact-body:v1:room:art")).toBeNull();
    expect(window.localStorage.getItem("traycer.mobile.lastSeen.epic-1.node-1")).toBeNull();
    expect(window.localStorage.getItem("traycer-remote:query-cache")).toBeNull();
    expect(result.localStorageKeysRemoved).toBe(6);
  });

  it("leaves unrelated keys alone", async () => {
    await clearLocalData();
    expect(window.localStorage.getItem("some.other.app")).toBe("untouched");
  });

  it("unregisters service workers and deletes cache storage", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
    });
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["workbox-precache-v2"]),
      delete: cacheDelete,
    });

    const result = await clearLocalData();

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cacheDelete).toHaveBeenCalledWith("workbox-precache-v2");
    expect(result.serviceWorker).toBe("ok");
    expect(result.caches).toBe("ok");
  });

  it("still clears the other layers when one of them throws", async () => {
    // This is the recovery path — a single failing layer must never abort
    // the sweep, or the button fails exactly when it's needed most.
    vi.stubGlobal("caches", {
      keys: vi.fn().mockRejectedValue(new Error("boom")),
      delete: vi.fn(),
    });

    const result = await clearLocalData();

    expect(result.caches).toBe("error");
    expect(result.localStorage).toBe("ok");
    expect(window.localStorage.getItem("chat-cache:v1:epic-1:chat-1")).toBeNull();
    expect(window.localStorage.getItem(AUTH_KEY)).not.toBeNull();
  });
});
