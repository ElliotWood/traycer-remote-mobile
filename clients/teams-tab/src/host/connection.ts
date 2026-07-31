/**
 * The tab's single-host connection: the shared stack, with the tab's config.
 *
 * The wiring lives in
 * `@traycer-clients/shared/host-client/single-host-connection`, which was
 * MOVED out of `clients/mobile` rather than copied when this file needed it.
 * Retry-outside-auth ordering and the bind-plus-context precondition are
 * subtle enough that two drifting copies is a guaranteed future bug, and the
 * mobile suite (411 tests) now exercises the shared module, so this file
 * inherits that coverage instead of starting from none.
 *
 * What is genuinely the tab's: which URL, and which host id.
 */
import {
  createSingleHostConnection,
  type HostConnection,
  type HostConnectionAuth,
} from "@traycer-clients/shared/host-client/single-host-connection";
import { CONFIGURED_HOST_ID, HOST_WS_URL } from "@/config";

export type { HostConnection, HostConnectionAuth };

/**
 * Local UI label for the bound entry.
 *
 * Distinct from {@link CONFIGURED_HOST_ID}, which is the host's real durable
 * id from `pid.json`. The label is what `HostClient` keys on locally; the
 * durable id is what rows carry in `hostId` and what locality is judged
 * against. Conflating them would make every agent look local, which is the
 * failure this surface has already shipped once by another route.
 */
export const TAB_HOST_LABEL = "teams-tab-host";

/**
 * Does this row run somewhere other than the host we are dialed into?
 *
 * Compared against the CONFIGURED host id, never against the local label.
 * Returns `false` for a null id — "not replicated yet" is unknown, not
 * foreign, and rendering unknown as foreign is the same category error as
 * rendering unobservable as idle.
 */
export function isForeignHost(hostId: string | null): boolean {
  if (hostId === null) return false;
  if (CONFIGURED_HOST_ID === "") return false;
  return hostId !== CONFIGURED_HOST_ID;
}

export function createTabHostConnection(
  auth: HostConnectionAuth,
): HostConnection | null {
  return createSingleHostConnection(auth, {
    hostWsUrl: HOST_WS_URL,
    localHostId: TAB_HOST_LABEL,
  });
}
