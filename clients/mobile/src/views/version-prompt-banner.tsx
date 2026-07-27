/// <reference types="vite-plugin-pwa/react" />
/**
 * Sprint 5 (B): the "New version — tap to refresh" prompt.
 *
 * `registerType: "prompt"` (vite.config.ts) means a new SW installs and waits
 * — it never self-activates. This banner is the human in that loop: it shows
 * once `needRefresh` flips true, and tapping it calls `updateServiceWorker`,
 * which tells the waiting worker to `skipWaiting` and reloads once it takes
 * control.
 *
 * Mounted app-wide (in `AppRoot`, not gated on sign-in) since installability
 * and the update prompt are auth-independent — a user should get told about a
 * new build even from the sign-in screen. Does nothing (registers no SW,
 * `needRefresh` never flips) under `bun run dev`, where the SW never
 * registers at all (contract, F2); it is only real under `vite build` +
 * `vite preview`.
 *
 * B-1 (eval round 2): `updateServiceWorker(true)`'s own reload only fires when
 * the library's internal `event.isUpdate` is true — on a first-ever-session
 * tab (no controller yet at initial registration) that flag is false, so a
 * tap activates the new SW but skips the reload, leaving the banner stuck
 * showing a build that's already active. A dedicated `controllerchange`
 * listener below reloads unconditionally whenever control actually changes,
 * making the tap-to-refresh reload airtight regardless of that edge case.
 */
import { useEffect, type ReactElement } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { colors, primaryButton } from "./ui";

/**
 * Browsers only check for a new SW on navigation by default — an already-open
 * tab would never notice a rebuild without polling. This is what makes "I
 * rebuild, the RUNNING client shows the prompt" work with no manual reload.
 */
const SW_UPDATE_CHECK_INTERVAL_MS = 60_000;

export function VersionPromptBanner(): ReactElement | null {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration === undefined) {
        return;
      }
      setInterval(() => {
        void registration.update();
      }, SW_UPDATE_CHECK_INTERVAL_MS);
    },
  });

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onControllerChange = (): void => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 44,
        padding: "10px 16px",
        boxSizing: "border-box",
        background: colors.accent,
        color: "#fff",
        zIndex: 1000,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>New version available</span>
      <button
        type="button"
        style={{
          ...primaryButton,
          width: "auto",
          minHeight: 44,
          padding: "8px 16px",
          background: "#fff",
          color: colors.accent,
        }}
        onClick={() => void updateServiceWorker(true)}
      >
        Tap to refresh
      </button>
    </div>
  );
}
