/**
 * BROWSER-PROOF SCAFFOLDING ONLY.
 *
 * `mobile-runner-host.ts` is the single file in the whole mobile web entry
 * that imports Capacitor (`@capacitor/browser`, `capacitor-secure-storage-
 * plugin`). Both are aliased to this module by `vite.config.web.ts` so the
 * bundle carries no Capacitor runtime at all - the point of the exercise is
 * to show gui-app itself runs in a plain browser.
 *
 * These are deliberately the laziest correct substitutes:
 *   Browser.open  -> window.open (device-flow sign-in opens a tab)
 *   SecureStorage -> localStorage (NOT secure; a real replacement is P1)
 */

export const Browser = {
  async open(options: { url: string }): Promise<void> {
    window.open(options.url, "_blank", "noopener,noreferrer");
  },
  async close(): Promise<void> {
    // Nothing to close: `open` handed the URL to a separate tab the page
    // does not own.
  },
};

const PREFIX = "traycer.secure.";

export const SecureStoragePlugin = {
  async keys(): Promise<{ value: string[] }> {
    const value: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(PREFIX)) {
        value.push(key.slice(PREFIX.length));
      }
    }
    return { value };
  },
  async get(options: { key: string }): Promise<{ value: string }> {
    const stored = window.localStorage.getItem(`${PREFIX}${options.key}`);
    if (stored === null) {
      // The exact message `mobile-runner-host.ts` pattern-matches on to map a
      // miss to `null` (`isMissingStorageItem`).
      throw new Error("Item with given key does not exist");
    }
    return { value: stored };
  },
  async set(options: { key: string; value: string }): Promise<{
    value: boolean;
  }> {
    window.localStorage.setItem(`${PREFIX}${options.key}`, options.value);
    return { value: true };
  },
  async remove(options: { key: string }): Promise<{ value: boolean }> {
    window.localStorage.removeItem(`${PREFIX}${options.key}`);
    return { value: true };
  },
};
