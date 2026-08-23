import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  TraycerApp,
  hostRpcRegistry,
  registerHostPickerExtra,
  setHostThemeOverride,
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
import { installClipboardFallback } from "./clipboard-fallback";
import { installFocusPolicy } from "./focus-policy";
import { installMicrophonePolicy } from "./microphone-policy";
import { registerServiceWorker } from "./pwa-shell";
import { startScreenWakeLock } from "./screen-wake-lock";
import {
  applyTeamsHostAttributes,
  initializeTeamsHost,
  teamsThemeToResolved,
} from "./teams-host";
import { resolveTeamsThemeParam } from "./teams-theme-param";
import {
  applyTeamsDeepLink,
  browserDeepLinkWindow,
} from "./teams-deep-link";
import { setTeamsLinkOpener } from "./external-link";
import { createWebNotificationHost } from "./web-notification-host";
import { offerNotificationPermission } from "./notification-permission";
import { ensurePushSubscription } from "./push-subscription";

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

  // BEFORE the first render, for the same reason as the theme below: gui-app
  // reaches `navigator.clipboard.writeText` from eight files, one of which is
  // the hook eighteen components copy through, and the first of those can fire
  // on the first frame the user sees. Wrapping the platform object after React
  // has mounted would leave a window in which copy silently does nothing on the
  // Teams tab - which is the exact defect this removes.
  installClipboardFallback({});

  // Not for the same reason as the wrapper above, and the difference is worth
  // stating: nothing here has to beat the first paint, because dictation cannot
  // start before the mic button is pressed. It is installed here because the
  // ATTRIBUTE has to be stamped whether or not anyone ever presses it - an
  // attribute that waits for a button is absent for an unbounded stretch, and
  // absent reads identically to a boot that threw.
  installMicrophonePolicy({});

  // Before the notification session exists, which is the deadline that matters
  // rather than the first paint: `notification-display.ts` re-reads
  // `document.hasFocus()` at DISPLAY time, so an override installed later would
  // leave the frame reporting the native reading for every emission that
  // arrived in between - and the emissions this gate exists to suppress are
  // exactly the ones that land while the user is opening the chat.
  //
  // A no-op outside a frame, by construction: the PWA and the desktop renderer
  // keep the native method untouched.
  installFocusPolicy({});

  // BEFORE the first render, and that is the entire point of it. Teams
  // substitutes `{theme}` in the manifest's `contentUrl` before requesting the
  // page, so in a Teams tab the theme is already in the URL here - whereas the
  // SDK handshake below cannot answer until a ~100KB dynamic import and a
  // postMessage round trip have completed, by which time the app has painted.
  // Without this a dark-Teams user watches a light tab turn dark.
  //
  // Null in a plain browser, and null in a Teams client that did not substitute
  // the placeholder - see `readTeamsThemeParam` on why an unrecognised value
  // must not resolve to a colour. The handshake remains the authority for
  // theme CHANGES while the tab is open; this only covers first paint, and the
  // two agree by construction because both go through `teamsThemeToResolved`.
  const urlTheme = resolveTeamsThemeParam(window.location.search);
  if (urlTheme !== null) setHostThemeOverride(urlTheme);

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
    // What this replaces did nothing at all: `show()` voided its arguments and
    // `onClick()` returned a disposable that never fired. Upstream has been
    // calling that `show()` on every notifiable row - `notification-display.ts`
    // has no shell gate - so the client was discarding a pipeline it already
    // had. Constructed here rather than inside the host because the service
    // worker is the web shell's, not every consumer's.
    notifications: createWebNotificationHost({}),
  });

  // The directory is the baked host plus every host the user added, each
  // with a MEASURED status. What this replaces returned a single entry with
  // a hardcoded `status: "available"`, so a host that was switched off
  // looked exactly like a live one.
  const getBearerToken = async (): Promise<string | null> => {
    const credentials = await host.tokenStore.get();
    return credentials?.token ?? null;
  };

  const remoteFetcher = createWebHostFetcher({
    resolveBakedHost,
    defaultHostsPath: "/__traycer/hosts",
    getBearerToken,
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
  // `onTheme` fires once on the initial context and again on every Teams theme
  // change. It resolves only when the user's own preference is "system", so a
  // Teams user who explicitly picked light or dark keeps it - see
  // `setHostThemeOverride`.
  void initializeTeamsHost({
    onTheme: (theme) => {
      setHostThemeOverride(teamsThemeToResolved(theme));
    },
    // The app's only door out, and until now it was one `window.open` that
    // cannot report a refusal - measured, three arms, `null` returned whether a
    // page opened or nothing did. Device-code SIGN-IN goes through that same
    // door, so a silent refusal in a tab with no address bar is unrecoverable.
    // `app.openLink` rejects, which is the only failure signal this surface has.
    //
    // Registered here rather than inside the handshake so the decision to USE
    // Teams for links stays with the shell, and arrives only once Teams has
    // answered - a link clicked before then takes the window path, exactly as
    // the PWA does on every click.
    onLinkOpener: setTeamsLinkOpener,
    // The route a Teams card asked for. Absent on an ordinary open, so this
    // fires on almost no load at all - and when it does fire it can reload the
    // document, which is why it is deliberately the LAST thing wired and the
    // only one of these callbacks that can end the session it runs in. See
    // `teams-deep-link.ts` for why a hash assignment alone would silently do
    // nothing.
    onDeepLink: (subPageId) => {
      applyTeamsDeepLink(
        subPageId,
        browserDeepLinkWindow(import.meta.env.BASE_URL),
      );
    },
  }).then((state) => {
    applyTeamsHostAttributes(state, document.documentElement);
  });

  // The PWA layer, also after render and also ours rather than upstream's.
  //
  // Registration waits for `load`, and that is a real deferral rather than a
  // stylistic one: installing the worker re-fetches the entire app shell, and
  // doing that while the first paint is still competing for the same
  // connections makes the FIRST visit slower in order to buy the SECOND one an
  // offline start. On a page that has already fired `load` (a route this can
  // reach, since bootstrap is not guaranteed to run before it) the listener
  // would never fire, so that case registers immediately.
  if (document.readyState === "complete") {
    registerServiceWorker({ container });
  } else {
    window.addEventListener(
      "load",
      () => registerServiceWorker({ container }),
      { once: true },
    );
  }

  // Not deferred: the wake lock reads storage and calls one navigator API, and
  // a screen that dims during the first few seconds is the case it exists to
  // prevent.
  startScreenWakeLock({});

  // The permission a browser will only grant behind a real tap, which upstream
  // has nothing to ask for because its settings panel configures WHICH events
  // notify, not whether the origin may display any. Renders an offer, never a
  // prompt: an unprompted `requestPermission()` does not merely fail on Chrome,
  // it burns the grant for the origin.
  //
  // The `report` hook is the seam that also drives PUSH registration, and it is
  // the right one for a reason worth stating: it fires with `granted` both when
  // the permission was already held at load AND the moment the user taps
  // Enable. Hanging the subscription off the tap alone would leave every
  // returning user unsubscribed; hanging it off load alone would leave a new
  // user unsubscribed until their second visit.
  offerNotificationPermission({
    container,
    report: (outcome) => {
      document.documentElement.dataset.notifications = outcome;
      // CALLED ON EVERY OUTCOME, and the `outcome !== "granted"` guard that
      // used to stand here is deleted rather than widened.
      //
      // It cost nothing and hid the one case that mattered. An embedded surface
      // reports `surface-blocked`, never `granted`, so the guard meant the Teams
      // tab never called this at all and carried NO `data-push` attribute —
      // absent, which reads identically to "old bundle", "boot path threw" and
      // "fine but unmeasured". The three-state rule applies to this attribute as
      // much as to its value.
      //
      // Unconditional is free: `ensurePushSubscription` resolves every negative
      // state before its first network call. Not awaited and never throws.
      void ensurePushSubscription({ getBearer: getBearerToken });
    },
  });
}

bootstrap();
