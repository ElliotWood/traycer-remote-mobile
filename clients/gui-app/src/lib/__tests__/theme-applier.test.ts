import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeMode } from "@/stores/settings/settings-store";

/**
 * `theme-applier.ts` owns the `<html>` theme cascade and installs itself at
 * module load off module-level state (`systemTheme`, `hostThemeOverride`), so
 * every test here re-imports it under `vi.resetModules()` rather than sharing
 * one instance.
 *
 * The rows that matter are the ones that tell an APPLIED host theme apart from
 * an OS signal that happens to agree - see "outranks the OS" below. A suite
 * that only ever puts the host and the OS in agreement would pass just as well
 * against a build that ignores the host entirely.
 */

let osPrefersDark = false;
const mediaListeners = new Set<() => void>();

function installControllableMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches(): boolean {
        return osPrefersDark;
      },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void): void => {
        mediaListeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void): void => {
        mediaListeners.delete(listener);
      },
      addListener: (): undefined => undefined,
      removeListener: (): undefined => undefined,
      dispatchEvent: (): boolean => false,
    }),
  });
}

/** Flips the OS preference and fires the change the applier listens for. */
function setOsPrefersDark(dark: boolean): void {
  osPrefersDark = dark;
  for (const listener of mediaListeners) listener();
}

interface LoadedApplier {
  readonly setHostThemeOverride: (next: "light" | "dark" | null) => void;
  readonly getResolvedTheme: () => "light" | "dark";
  readonly subscribeResolvedTheme: (listener: () => void) => () => void;
}

interface Loaded {
  readonly applier: LoadedApplier;
  readonly setTheme: (theme: ThemeMode) => void;
}

/**
 * Fresh applier + settings store. The user's preference is set BEFORE the
 * applier is imported, because `install()` reads the store during the import's
 * side effects - which is the real startup order too.
 */
async function load(options: {
  osDark?: boolean;
  theme?: ThemeMode;
}): Promise<Loaded> {
  osPrefersDark = options.osDark ?? false;
  vi.resetModules();
  const settings = await import("@/stores/settings/settings-store");
  if (options.theme !== undefined) {
    settings.useSettingsStore.setState({ theme: options.theme });
  }
  const applier = await import("@/lib/theme-applier");
  return {
    applier,
    setTheme: (theme) => {
      settings.useSettingsStore.setState({ theme });
    },
  };
}

/** What the document element actually resolved to. */
function domTheme(): "light" | "dark" | "neither" {
  const list = document.documentElement.classList;
  if (list.contains("dark") && !list.contains("light")) return "dark";
  if (list.contains("light") && !list.contains("dark")) return "light";
  return "neither";
}

beforeEach(() => {
  mediaListeners.clear();
  installControllableMatchMedia();
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setHostThemeOverride", () => {
  it("applies the embedding host's dark theme when the user's preference is system", async () => {
    // The shipped defect, verbatim: a Teams tab in a dark Teams client on a
    // light OS rendered light, because `prefers-color-scheme` inside the frame
    // reports the OS and nothing else was consulted.
    const { applier } = await load({ osDark: false, theme: "system" });
    expect(domTheme()).toBe("light");

    applier.setHostThemeOverride("dark");

    expect(domTheme()).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("outranks the OS signal rather than agreeing with it", async () => {
    // THE CONTROL for the row above. Here the OS says dark and the host says
    // light, so "light" can only have come from the host. Without this row a
    // build that ignored the host entirely would still pass the dark case.
    const { applier } = await load({ osDark: true, theme: "system" });
    expect(domTheme()).toBe("dark");

    applier.setHostThemeOverride("light");

    expect(domTheme()).toBe("light");
    expect(applier.getResolvedTheme()).toBe("light");
  });

  it("does NOT override an explicit light preference", async () => {
    // The reason this is a second ambient signal instead of a `setTheme(...)`
    // call: the settings store is persisted, so writing to it would replace a
    // choice the user made, permanently and invisibly.
    const { applier } = await load({ osDark: false, theme: "light" });

    applier.setHostThemeOverride("dark");

    expect(domTheme()).toBe("light");
    expect(applier.getResolvedTheme()).toBe("light");
  });

  it("does NOT override an explicit dark preference", async () => {
    const { applier } = await load({ osDark: true, theme: "dark" });

    applier.setHostThemeOverride("light");

    expect(domTheme()).toBe("dark");
    expect(applier.getResolvedTheme()).toBe("dark");
  });

  it("retains the host theme so a later switch to system picks it up", async () => {
    // A user who starts explicit and later chooses "system" must land on the
    // HOST's theme, not on the OS's. Proves the override is retained while it
    // is inert rather than dropped.
    const { applier, setTheme } = await load({ osDark: false, theme: "light" });
    applier.setHostThemeOverride("dark");
    expect(domTheme()).toBe("light");

    setTheme("system");

    expect(domTheme()).toBe("dark");
  });

  it("falls back to the CURRENT OS preference when cleared", async () => {
    // Not the one read at module load: the OS flips while the override is in
    // force, and clearing must land on the new value.
    const { applier } = await load({ osDark: false, theme: "system" });
    applier.setHostThemeOverride("dark");
    setOsPrefersDark(true);

    applier.setHostThemeOverride(null);

    expect(domTheme()).toBe("dark");

    setOsPrefersDark(false);
    expect(domTheme()).toBe("light");
  });

  it("ignores an OS change while a host override is set", async () => {
    const { applier } = await load({ osDark: false, theme: "system" });
    applier.setHostThemeOverride("light");

    setOsPrefersDark(true);

    expect(domTheme()).toBe("light");
  });

  it("does not wake subscribers for an OS change the override outranks", async () => {
    // Separate row from the one above ON PURPOSE. The DOM assertion there
    // holds with or without the media listener's override guard, because
    // `ambientTheme()` prefers the override anyway - so it cannot tell whether
    // that guard exists. What the guard actually prevents is a no-op re-apply
    // that wakes every `useSyncExternalStore` consumer, and xterm re-reads its
    // whole palette out of `getComputedStyle` when woken.
    const { applier } = await load({ osDark: false, theme: "system" });
    applier.setHostThemeOverride("light");
    const listener = vi.fn();
    const unsubscribe = applier.subscribeResolvedTheme(listener);

    setOsPrefersDark(true);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps getResolvedTheme in step with the document", async () => {
    // These are two readings of one fact and consumers rely on them agreeing:
    // xterm snapshots its palette from `getComputedStyle` when the subscriber
    // fires, so a stale snapshot ships a stale terminal theme.
    const { applier } = await load({ osDark: false, theme: "system" });

    applier.setHostThemeOverride("dark");
    expect(applier.getResolvedTheme()).toBe("dark");
    expect(domTheme()).toBe("dark");

    applier.setHostThemeOverride(null);
    expect(applier.getResolvedTheme()).toBe("light");
    expect(domTheme()).toBe("light");
  });

  it("notifies subscribers once per real change and not at all for a repeat", async () => {
    // Teams re-pushes the theme on every change; a handler that renotified on
    // an unchanged value would wake every `useSyncExternalStore` consumer.
    const { applier } = await load({ osDark: false, theme: "system" });
    const listener = vi.fn();
    const unsubscribe = applier.subscribeResolvedTheme(listener);

    applier.setHostThemeOverride("dark");
    expect(listener).toHaveBeenCalledTimes(1);

    applier.setHostThemeOverride("dark");
    expect(listener).toHaveBeenCalledTimes(1);

    applier.setHostThemeOverride("light");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("does not notify while the user's preference is explicit", async () => {
    // Nothing resolved changed, so nothing downstream should re-read.
    const { applier } = await load({ osDark: false, theme: "light" });
    const listener = vi.fn();
    const unsubscribe = applier.subscribeResolvedTheme(listener);

    applier.setHostThemeOverride("dark");

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
