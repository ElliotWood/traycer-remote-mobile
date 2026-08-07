import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  TraycerApp,
  hostRpcRegistry,
  registerHostPickerExtra,
  setMobileApp,
} from "@traycer-clients/gui-app";
import "./index.css";
import { lastSelectedHostKey } from "@/lib/persist";
import { MobileRunnerHost } from "../mobile-runner-host";
import {
  createWebHostFetcher,
  type BakedHost,
} from "./host-directory-fetcher";
import { ManageHostsPanel } from "./manage-hosts-panel";
import { isStorageDurable, safeStorage } from "./capacitor-web-shim";
import { applyTeamsHostAttributes, initializeTeamsHost } from "./teams-host";

const config = __TRAYCER_GUI_APP_DEV_CONFIG__;

/**
 * The baked `config.host` captures the port as of Vite startup, which goes
 * stale whenever the dev host restarts; the dev-server endpoint re-reads
 * the host's pid.json per request, so each directory refresh gets the live
 * port. In a static build that endpoint does not exist, the fetch fails,
 * and the baked entry is the answer we want anyway.
 *
 * This resolves the ENDPOINT only. Whether the host is actually up is a
 * separate question, answered by a real probe in `host-directory-fetcher`.
 */
async function resolveBakedHost(): Promise<BakedHost> {
  try {
    const response = await fetch(config.devHostPath);
    if (!response.ok) return config.host;
    const parsed: unknown = await response.json();
    if (parsed === null || typeof parsed !== "object") return config.host;
    const record = parsed as Record<string, unknown>;
    const { hostId, version, websocketUrl } = record;
    if (
      typeof hostId !== "string" ||
      typeof version !== "string" ||
      typeof websocketUrl !== "string"
    ) {
      return config.host;
    }
    return { ...config.host, hostId, version, websocketUrl };
  } catch {
    return config.host;
  }
}

/**
 * Selects the host that served this page, the first time this browser runs
 * the app.
 *
 * `HostDirectoryService.getDefaultEntry()` auto-binds only when the
 * directory holds exactly ONE entry - "the zero/many mobile paths require an
 * explicit user gesture before binding". The moment the origin offers a
 * second host by default, that gesture has never happened, so the app sits
 * on the readiness gate forever: `<HostPicker/>` is mounted above the gate,
 * but the only thing that opens it (the nav drawer) is inside it.
 *
 * Writing the persisted selection is exactly the gesture, made on the user's
 * behalf with the only defensible default - the host that served the page.
 * It is a SELECTION, not a claim about reachability: the picker still shows
 * the measured status, and a first-run user can change it immediately.
 * Never overwrites an existing choice.
 */
function seedInitialHostSelection(): void {
  // Through `safeStorage()` rather than raw `localStorage`: under denial the
  // old try/catch swallowed the throw and the gesture was simply never made,
  // so the app sat on the picker. In memory it at least holds for the session.
  const key = lastSelectedHostKey();
  if (safeStorage().getItem(key) === null) {
    safeStorage().setItem(key, config.host.hostId);
  }
}

/**
 * Says so when the session will not survive a reload.
 *
 * MEASURED, and this is why it exists rather than being a nicety. Before the
 * storage port, denying storage produced *"Could not read saved credentials.*
 * *Please try again. store-unavailable"* - an ACCIDENT, the SecurityError
 * escaping into an error state. The port removes the throw, so that message
 * goes with it and the user gets an ordinary sign-in screen that will keep
 * reappearing on every load with nothing to explain it.
 *
 * Removing an incidental disclosure and calling the result an improvement is
 * how a fix makes a product quieter and worse. So the accidental message is
 * replaced with a deliberate one, which is what the retired mobile PWA did
 * (`sign-in-view.tsx` rendered off `isStorageDurable()`).
 *
 * Rendered outside React, in OUR shell, so it costs upstream's UI nothing.
 */
function announceNonDurableStorage(container: HTMLElement): void {
  document.documentElement.dataset.storageDurable = String(isStorageDurable());
  if (isStorageDurable()) return;

  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  banner.dataset.testid = "storage-not-durable";
  banner.textContent =
    "This browser is blocking storage for Traycer, so you will have to sign in again each time you open it.";
  banner.style.cssText =
    "padding:10px 14px;font:13px/1.45 system-ui,sans-serif;text-align:center;" +
    "background:#4a2c00;color:#ffd9a0;border-bottom:1px solid #7a4a00";
  container.before(banner);
}

function bootstrap(): void {
  document.documentElement.classList.add("traycer-mobile-client");
  seedInitialHostSelection();
  // PRODUCT flag, not layout: unlocks mobile-app-only UX policy such as the
  // single-composer draft model. See gui-app's `src/lib/mobile-app.ts` for
  // how this differs from the viewport signal.
  setMobileApp(true);
  const host = new MobileRunnerHost({
    signInUrl: config.signInUrl,
    authnBaseUrl: config.authnBaseUrl,
    hostLabel: config.host.label,
    relayBaseUrl: config.relayBaseUrl,
  });

  // The directory is the baked host plus every host the user added, each
  // with a MEASURED status. What this replaces returned a single entry with
  // a hardcoded `status: "available"`, so a host that was switched off
  // looked exactly like a live one.
  const remoteFetcher = createWebHostFetcher({
    resolveBakedHost,
    defaultHostsPath: "/__traycer/hosts",
    getBearerToken: async () => {
      const credentials = await host.tokenStore.get();
      return credentials?.token ?? null;
    },
  });

  // Registered before the first render, which is the contract
  // `registerHostPickerExtra` documents.
  registerHostPickerExtra(
    <ManageHostsPanel bakedHostId={config.host.hostId} />,
  );

  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("#root element not found in index.html");
  }
  announceNonDurableStorage(container);
  createRoot(container).render(
    <StrictMode>
      <TraycerApp
        runnerHost={host}
        registry={hostRpcRegistry}
        remoteFetcher={remoteFetcher}
      />
    </StrictMode>,
  );

  // AFTER render, and deliberately not awaited. This same bundle is the Teams
  // client and the PWA; in a plain browser the handshake never even loads the
  // SDK, and inside a non-Teams frame it can only settle on a 4s timeout. Both
  // of those are reasons nothing user-visible may wait on it.
  //
  // `notifySuccess()` also means "my content is up", which is only true here.
  void initializeTeamsHost({}).then((state) => {
    applyTeamsHostAttributes(state, document.documentElement);
  });
}

bootstrap();
