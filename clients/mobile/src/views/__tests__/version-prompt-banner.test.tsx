// @vitest-environment jsdom
/**
 * S5 (B): the version-prompt banner, with `virtual:pwa-register/react`
 * mocked (vitest doesn't run through the `VitePWA` plugin, so the real
 * virtual module never resolves under test — this is the deliberate seam).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@/test-utils/dom";

const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
let needRefresh = false;
let onRegisteredSWCallback: ((swUrl: string, reg: unknown) => void) | undefined;

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options?: { onRegisteredSW?: (swUrl: string, reg: unknown) => void }) => {
    onRegisteredSWCallback = options?.onRegisteredSW;
    return {
      needRefresh: [needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker,
    };
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  needRefresh = false;
  updateServiceWorker.mockClear();
  onRegisteredSWCallback = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("VersionPromptBanner", () => {
  it("renders nothing while no refresh is needed", async () => {
    const { VersionPromptBanner } = await import("../version-prompt-banner");
    render(<VersionPromptBanner />);
    expect(screen.queryByText("New version available")).toBeNull();
  });

  it("shows the prompt and calls updateServiceWorker(true) on tap once needRefresh flips true", async () => {
    needRefresh = true;
    const { VersionPromptBanner } = await import("../version-prompt-banner");
    render(<VersionPromptBanner />);

    expect(screen.getByText("New version available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tap to refresh" }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("polls registration.update() periodically once the SW registers", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { VersionPromptBanner } = await import("../version-prompt-banner");
    render(<VersionPromptBanner />);

    expect(onRegisteredSWCallback).toBeDefined();
    onRegisteredSWCallback?.("/sw.js", { update });

    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the registration is undefined (registration failed)", async () => {
    const { VersionPromptBanner } = await import("../version-prompt-banner");
    render(<VersionPromptBanner />);

    expect(() => onRegisteredSWCallback?.("/sw.js", undefined)).not.toThrow();
    vi.advanceTimersByTime(60_000);
    // Nothing to assert on `update` here — just proving no throw with an
    // undefined registration (e.g. registration failed / unsupported browser).
  });

  describe("B-1: controllerchange reload fallback", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const originalNavigator = globalThis.navigator;
    const originalReload = window.location.reload;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      listeners.clear();
      reload = vi.fn();
      Object.defineProperty(window, "location", {
        value: { ...window.location, reload },
        configurable: true,
      });
      Object.defineProperty(globalThis, "navigator", {
        value: {
          ...originalNavigator,
          serviceWorker: {
            addEventListener: (type: string, listener: () => void) => {
              if (!listeners.has(type)) listeners.set(type, new Set());
              listeners.get(type)?.add(listener);
            },
            removeEventListener: (type: string, listener: () => void) => {
              listeners.get(type)?.delete(listener);
            },
          },
        },
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: { ...window.location, reload: originalReload },
        configurable: true,
      });
    });

    it("reloads unconditionally when the SW controller actually changes", async () => {
      const { VersionPromptBanner } = await import("../version-prompt-banner");
      const { unmount } = render(<VersionPromptBanner />);

      for (const listener of listeners.get("controllerchange") ?? []) listener();
      expect(reload).toHaveBeenCalledTimes(1);

      unmount();
    });

    it("removes the controllerchange listener on unmount", async () => {
      const { VersionPromptBanner } = await import("../version-prompt-banner");
      const { unmount } = render(<VersionPromptBanner />);
      expect(listeners.get("controllerchange")?.size).toBe(1);

      unmount();
      expect(listeners.get("controllerchange")?.size).toBe(0);
    });
  });
});
