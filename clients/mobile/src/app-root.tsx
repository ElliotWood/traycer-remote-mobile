/**
 * Composition root (T4): builds the app-lifetime services once and provides
 * them to the gate.
 *
 *   - `MobileAuthService` (T1) over the configured AuthnV3 base URL. `start()`
 *     rehydrates a persisted session on load (once — a ref guards React 18
 *     StrictMode's double-invoke of the effect).
 *   - `createHostConnection(auth)` (T2) — the bound unary `HostClient`, or
 *     `null` when no host is configured (`HOST_WS_URL` unset). The gate renders
 *     the config prompt in the `null` case.
 *   - a TanStack `QueryClient` for the fleet's paginated `epic.listTasks`.
 *
 * These are singletons for the app's lifetime, so the connection is
 * deliberately not disposed on unmount: `AppRoot` only unmounts on full page
 * teardown (which the browser reclaims), and disposing in an effect cleanup
 * would wrongly tear the connection down under StrictMode's simulated remount.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  defaultShouldDehydrateQuery,
  QueryClient,
  QueryClientProvider,
  useIsRestoring,
  type DehydrateOptions,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { AUTHN_BASE_URL, AUTHN_CONFIGURED, HOST_WS_URL } from "@/config";
import { computeConfigProblems } from "@/config-diagnostics";
import { MobileAuthService } from "@/host/auth-service";
import { AuthServiceProvider } from "@/host/auth-service-context";
import { CACHE_MAX_AGE_MS, CACHE_SCHEMA_VERSION } from "@/host/cache-config";
import { createHostConnection } from "@/host/connection";
import { HostClientProvider } from "@/host/host-client-context";
import { HostStreamConnection } from "@/host/stream-connection";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { App } from "@/App";
import { ConfigErrorScreen } from "@/views/config-error-screen";
import { ErrorBoundary } from "@/views/error-boundary";
import { VersionPromptBanner } from "@/views/version-prompt-banner";

const QUERY_CACHE_STORAGE_KEY = "traycer-remote:query-cache";

/**
 * Only these two unary queries are part of the empty-on-load bug (P0) — the
 * fleet list and comment threads. `snapshots.readSnapshotDiff` /
 * `workspace.readFile` / `agent.gui.getPlan` are lazy, on-expand, potentially
 * large payloads with no "instant paint" requirement; persisting them would
 * only bloat localStorage.
 */
const PERSISTED_QUERY_NAMES: ReadonlySet<string> = new Set([
  "epic.listTasks",
  "epic.listCommentThreads",
]);

export const shouldDehydrateQuery: DehydrateOptions["shouldDehydrateQuery"] = (query) =>
  defaultShouldDehydrateQuery(query) &&
  query.queryKey[0] === "mobile" &&
  typeof query.queryKey[1] === "string" &&
  PERSISTED_QUERY_NAMES.has(query.queryKey[1]);

/**
 * Restoring a persisted `QueryClient` is always at least one microtask past
 * first commit (`persistQueryClient`'s restore is `await`-based even when the
 * underlying `localStorage` read is synchronous), so without this gate the
 * Fleet would render its `isPending` "Loading your epics…" copy for exactly
 * one frame before flipping to the warm data — a real, if brief, flash. This
 * withholds the signed-in app (not the auth-independent `VersionPromptBanner`)
 * until restore settles; restoring `null` for that one tick is invisible
 * (nothing has painted yet), unlike a loading string would be.
 */
function RestoreGate({ children }: { readonly children: ReactNode }): ReactElement | null {
  const isRestoring = useIsRestoring();
  return isRestoring ? null : <>{children}</>;
}

export function AppRoot(): ReactElement {
  // Fail loudly, before constructing auth/the host connection/anything else:
  // a build missing required env config can't work regardless of what the
  // user does next (see `config-diagnostics.ts`). Computed from build-time
  // constants + `window.location.origin` — both invariant for the page's
  // lifetime — so this early return (before any hooks run) is safe: hook
  // order for a given mounted instance never actually varies.
  const configProblems = computeConfigProblems({
    authnConfigured: AUTHN_CONFIGURED,
    hostWsUrl: HOST_WS_URL,
    origin: typeof window === "undefined" ? "" : window.location.origin,
  });
  if (configProblems.length > 0) {
    return <ConfigErrorScreen problems={configProblems} />;
  }

  /* eslint-disable react-hooks/rules-of-hooks -- the early return above is
   * gated on `configProblems`, computed from build-time constants +
   * `window.location.origin`, both invariant for the page's lifetime (see
   * the comment above it) — so for any given mounted instance, this branch
   * is never taken on one render and skipped on the next; hook order never
   * actually varies for that instance. The rule can't see that invariant
   * statically and flags every hook below as "conditional". */
  const [auth] = useState(
    () =>
      new MobileAuthService({
        authnBaseUrl: AUTHN_BASE_URL,
        // Production authn only allows client_id `cli`/`desktop` (probed
        // 2026-07-26: `client_id:"mobile"` → 400 "must be 'cli' or 'desktop'").
        // Send `desktop` so the RFC 8628 flow is accepted; `hostLabel` still
        // reads "Traycer Remote (mobile)", so device management still shows this
        // as a mobile device. Revert to `"mobile"` once the backend allowlists
        // it (see decisions artifact).
        // ponytail: masquerade as `desktop` until authn accepts `client_id:"mobile"`.
        clientId: "desktop",
      }),
  );
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Must be >= the persister's `maxAge` below — otherwise a query
          // just restored from localStorage is already past its own gcTime
          // window (computed from the ORIGINAL, pre-restore `dataUpdatedAt`)
          // and can be garbage-collected before any component observes it.
          queries: { gcTime: CACHE_MAX_AGE_MS },
        },
      }),
  );
  const [persister] = useState(() =>
    typeof window === "undefined" || !("localStorage" in window)
      ? null
      : createSyncStoragePersister({
          storage: window.localStorage,
          key: QUERY_CACHE_STORAGE_KEY,
        }),
  );
  const [connection] = useState(() => createHostConnection(auth, {}));
  // T5 stands up the streaming stack (T3) the unary wiring never reached: one
  // `HostStreamConnection` for the session's `epic.subscribe` / `chat.subscribe`
  // streams, off the SAME auth. Gated on a configured host (like `connection`)
  // and app-lifetime — not disposed on unmount, for the reason above.
  const [streamConnection] = useState(() =>
    connection === null ? null : new HostStreamConnection(auth),
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void auth.start();
  }, [auth]);
  /* eslint-enable react-hooks/rules-of-hooks */

  const shell = (
    <RestoreGate>
      <AuthServiceProvider auth={auth}>
        <HostClientProvider client={connection?.hostClient ?? null}>
          <StreamConnectionProvider connection={streamConnection}>
            {/* Last resort: catches anything the per-screen boundaries (app-shell.tsx) miss (e.g. the sign-in gate itself). */}
            <ErrorBoundary label="Traycer Remote">
              <App auth={auth} />
            </ErrorBoundary>
          </StreamConnectionProvider>
        </HostClientProvider>
      </AuthServiceProvider>
    </RestoreGate>
  );

  // `persister` is null when localStorage is unavailable (SSR, private-mode
  // edge cases) — fall back to a plain, unpersisted QueryClientProvider
  // rather than crashing. `useIsRestoring()` inside `RestoreGate` defaults to
  // `false` with no `IsRestoringProvider` ancestor, so the gate is a no-op
  // either way.
  return persister === null ? (
    <QueryClientProvider client={queryClient}>
      {shell}
      <VersionPromptBanner />
    </QueryClientProvider>
  ) : (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster: CACHE_SCHEMA_VERSION,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {shell}
      {/* Auth-independent: installability/update prompt applies from the
          sign-in screen onward, not just once signed in — and it must never
          sit behind the restore gate either. */}
      <VersionPromptBanner />
    </PersistQueryClientProvider>
  );
}
