/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `vite.config.web.ts`; same scope and same caveat.
 *
 * Builds the phone's host directory: the baked entry (the host that served
 * this page) plus every host the user added, each with a status that was
 * actually MEASURED rather than asserted.
 *
 * The entry this replaces returned a single hardcoded
 * `status: "available"`. That is the defect this module exists to remove:
 * `status` had a renderer and no producer, so an unreachable host was
 * indistinguishable from a live one.
 */
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import type {
  RemoteHostFetcher,
  RemoteHostFetchOutcome,
} from "@traycer-clients/shared/host-client/remote-fetcher";
import { probeHost, type HostProbeResult } from "./probe-host";
import { readStoredHosts } from "./host-store";

/** The baked entry, as `vite.config.web.ts` defines it. */
export interface BakedHost {
  readonly hostId: string;
  readonly label: string;
  readonly kind: "local";
  readonly websocketUrl: string;
  readonly version: string;
  readonly status: "available";
}

/**
 * The last measured probe per host, for the "Manage hosts" sheet. Kept here
 * (rather than probed a second time by the sheet) so the badge in the
 * picker and the reason in the sheet can never disagree.
 */
const lastProbes = new Map<string, HostProbeResult>();
const probeListeners = new Set<() => void>();

export function getLastProbe(hostId: string): HostProbeResult | null {
  return lastProbes.get(hostId) ?? null;
}

export function subscribeToProbes(listener: () => void): () => void {
  probeListeners.add(listener);
  return () => {
    probeListeners.delete(listener);
  };
}

function publishProbe(hostId: string, result: HostProbeResult): void {
  lastProbes.set(hostId, result);
  for (const listener of probeListeners) listener();
}

/**
 * `kind: "local"` for every entry, including remote ones over `wss://`.
 * That is not a contradiction and not a shortcut: in this client `local`
 * means "dial `websocketUrl` directly", which is exactly right for an
 * nginx-fronted host. `remote` means the relay + Noise-NK path, which needs
 * a registry-published public key this deployment has no way to obtain.
 */
function toDirectoryEntry(
  host: { readonly hostId: string; readonly label: string; readonly websocketUrl: string },
  probe: HostProbeResult,
): HostDirectoryEntry {
  return {
    hostId: host.hostId,
    label: host.label,
    kind: "local",
    websocketUrl: host.websocketUrl,
    // Measured, never stored - a remembered version goes stale in silence.
    version: probe.kind === "reachable" ? probe.hostVersion : null,
    // `HostAvailability` has exactly two values, so an unproven host reports
    // `unavailable`. It is NOT the same as a proven-down one, and the sheet
    // distinguishes them by reason - but between the two available values,
    // "we could not confirm this works" must never render as "available".
    status: probe.kind === "reachable" ? "available" : "unavailable",
  };
}

let inFlight: Promise<RemoteHostFetchOutcome> | null = null;

/**
 * Builds the fetcher the app hands to `TraycerApp`. Refreshes are
 * single-flighted: the directory refreshes on picker-open and on several
 * other events, and without this a burst would open several sockets per
 * host at once.
 */
export interface WebHostFetcherDeps {
  /**
   * Resolves the baked entry per refresh rather than closing over it once.
   * Under `vite dev` this re-reads the local host's `pid.json` through the
   * dev-server endpoint, because its port changes on every host restart -
   * a captured port is stale the first time the host bounces.
   */
  readonly resolveBakedHost: () => Promise<BakedHost>;
  readonly getBearerToken: () => Promise<string | null>;
}

export function createWebHostFetcher(
  deps: WebHostFetcherDeps,
): RemoteHostFetcher {
  return async () => {
    if (inFlight !== null) return await inFlight;
    inFlight = refresh(deps).finally(() => {
      inFlight = null;
    });
    return await inFlight;
  };
}

async function refresh(
  deps: WebHostFetcherDeps,
): Promise<RemoteHostFetchOutcome> {
  const bakedHost = await deps.resolveBakedHost();
  const hosts = [
    {
      hostId: bakedHost.hostId,
      label: bakedHost.label,
      websocketUrl: bakedHost.websocketUrl,
    },
    ...readStoredHosts(),
  ];

  const token = await deps.getBearerToken();

  const entries = await Promise.all(
    hosts.map(async (host) => {
      const probe = await probeHost({
        websocketUrl: host.websocketUrl,
        token,
      });
      publishProbe(host.hostId, probe);
      return toDirectoryEntry(host, probe);
    }),
  );

  // Always `hosts`, never `failed`: a probe that fails is a RESULT about a
  // host, not a failure to enumerate hosts. Returning `failed` here would
  // make the directory retain its last-known entries and hide the very
  // status change we just measured.
  return { kind: "hosts", entries };
}
