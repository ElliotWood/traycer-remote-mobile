import {
  useSettingsStore,
  type ThemeMode,
} from "@/stores/settings/settings-store";
import type { ThemePreset } from "@/lib/theme-presets";

/**
 * Imperative owner of the document-element theme attributes (`class`,
 * `data-theme`, `color-scheme`). Subscribes to the settings store and the
 * `matchMedia` listener at module load - outside React - so DOM mutations
 * land **before** React re-renders the component tree.
 *
 * Why this can't be a `useEffect` in `ThemeProvider`: React fires effects
 * during commit, and child effects fire before parent effects. xterm.js
 * captures its palette as a JS object via `getComputedStyle` inside a
 * `useMemo` during render. If `applyVariant` runs in `ThemeProvider`'s
 * effect (parent, last to fire), the child has already read the stale
 * cascade and pushed a stale `ITheme` into `term.options.theme`. The
 * surrounding Tailwind UI never showed this race because Tailwind utilities
 * resolve `var(...)` at paint time against the live cascade - they don't
 * snapshot the value into JS.
 *
 * The applier sidesteps the entire React commit cycle: store update
 * triggers the applier listener synchronously (Zustand calls listeners in
 * subscription order, all before returning from `setState`), DOM is
 * mutated, React's own subscriber then schedules the re-render, children
 * re-render, and `getComputedStyle` reads the freshly-classed DOM.
 */

export type ResolvedTheme = "light" | "dark";

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(theme: ThemeMode, system: ResolvedTheme): ResolvedTheme {
  return theme === "system" ? system : theme;
}

function applyVariant(resolved: ResolvedTheme, preset: ThemePreset): void {
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  root.setAttribute("data-theme", preset);
}

let systemTheme: ResolvedTheme = readSystemTheme();

/**
 * An embedding host's own light/dark signal, when the app is running inside
 * one that has a theme of its own (a Teams personal tab). `null` in the
 * ordinary case - a browser window, where the OS media query IS the ambient
 * signal.
 *
 * This is deliberately a SECOND ambient source rather than a write to the
 * settings store. `prefers-color-scheme` inside an embedded frame reports the
 * OS, which is not the same question as "what theme is the surrounding app
 * showing" - Teams' theme is set independently of the OS. Pushing the host
 * theme into the store instead would overwrite the user's own explicit
 * preference and persist it, which is a worse outcome than the mismatch.
 */
let hostThemeOverride: ResolvedTheme | null = null;

/** The ambient signal `"system"` resolves against: the host's, else the OS's. */
function ambientTheme(): ResolvedTheme {
  return hostThemeOverride ?? systemTheme;
}

const resolvedListeners = new Set<() => void>();

function applyFromState(): void {
  if (typeof window === "undefined") return;
  const s = useSettingsStore.getState();
  applyVariant(resolve(s.theme, ambientTheme()), s.themePreset);
}

function notify(): void {
  for (const listener of resolvedListeners) listener();
}

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;

  // Initial sync. Zustand's `persist` middleware rehydrates from
  // localStorage synchronously during store creation, which runs before
  // this module's import side effects, so `getState()` is already
  // populated with the user's persisted preference.
  applyFromState();

  useSettingsStore.subscribe((state, prev) => {
    if (state.theme === prev.theme && state.themePreset === prev.themePreset) {
      return;
    }
    applyFromState();
    notify();
  });

  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", () => {
      const next = readSystemTheme();
      if (next === systemTheme) return;
      systemTheme = next;
      // Still recorded above, so that clearing the host override falls back to
      // the CURRENT OS pref rather than the one read at module load - but a
      // host override outranks the OS while it is set, so nothing to re-apply.
      if (hostThemeOverride !== null) return;
      // OS pref only affects the resolved value when the user picked
      // "system"; otherwise the cascade is already correct and a re-emit
      // would be a no-op for downstream consumers.
      if (useSettingsStore.getState().theme !== "system") return;
      applyFromState();
      notify();
    });
  }
}

install();

/**
 * `useSyncExternalStore` snapshot. Returns the current resolved
 * light/dark mode without touching the DOM. Stable identity across
 * renders for the same logical state - primitives compare by value.
 */
export function getResolvedTheme(): ResolvedTheme {
  return resolve(useSettingsStore.getState().theme, ambientTheme());
}

/**
 * Reports the embedding host's own light/dark theme, or clears it with `null`.
 *
 * Applies EXACTLY where the OS `prefers-color-scheme` signal applies - only
 * when the user's own preference is `"system"`. A user who explicitly picked
 * light or dark keeps it inside the host, which is the whole reason this is a
 * separate signal rather than a `setTheme(...)` call: the store is persisted,
 * so writing to it would silently and permanently replace a choice the user
 * made.
 *
 * Idempotent. Safe to call before or after the settings store has rehydrated,
 * and safe to call repeatedly - a host that pushes theme changes (Teams does)
 * re-invokes this on every change.
 */
export function setHostThemeOverride(next: ResolvedTheme | null): void {
  if (next === hostThemeOverride) return;
  hostThemeOverride = next;
  if (typeof window === "undefined") return;
  // Mirrors the media-query listener: an explicit light/dark preference is
  // already on the document, so there is nothing to re-apply and a `notify()`
  // would wake every `useSyncExternalStore` consumer for an unchanged value.
  if (useSettingsStore.getState().theme !== "system") return;
  applyFromState();
  notify();
}

/**
 * `useSyncExternalStore` subscribe. Listener fires after DOM has been
 * mutated, so any consumer that re-reads `getComputedStyle` in response
 * sees the new cascade.
 */
export function subscribeResolvedTheme(listener: () => void): () => void {
  resolvedListeners.add(listener);
  return () => {
    resolvedListeners.delete(listener);
  };
}
