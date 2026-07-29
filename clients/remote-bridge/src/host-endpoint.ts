import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostTransportEndpoint } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import type { ILogger } from "./logger";
import { requireHomeEnv } from "./host-auth";

/**
 * `~/.traycer/host/pid.json` — mirrors `clients/traycer-cli/src/host/pid-metadata.ts`
 * (read + `isValidLocalHostWebsocketUrl`), copied rather than imported: that
 * module is CLI-private (no `exports` for library consumption), and this
 * package must not depend on `clients/traycer-cli` (see `host-auth.ts`'s
 * docblock for why the same boundary applies there).
 *
 * This is the module that decides which tenant's host process the bridge
 * connects to — resolving it against the wrong identity is exactly the
 * cross-tenant failure `requireHomeEnv()` exists to prevent. That gate is
 * currently only called from `resolveHostAuth()`, so today's single call
 * order (`BridgeClient.start()` awaits `resolveHostAuth()` before ever
 * touching the endpoint) happens to make this safe — but `readHostPidMetadata`
 * and `isValidLocalHostWebsocketUrl` are exported, and nothing in THIS file
 * enforces the ordering that protects them. A future second entry point
 * (a health check, a `bridge doctor`) calling into this module before auth
 * would silently fall through to `os.homedir()`'s OS-user fallback and
 * resolve another tenant's host. `requireHomeEnv()` is a fail-fast GATE, not
 * a path-resolution replacement — credentials still resolve through
 * `cliCredentialsPath()` → `cliConfigDir()` → `join(homedir(), …)`
 * unmodified; the safety comes entirely from the gate running first. Calling
 * it here, locally, makes that true by construction instead of by caller
 * discipline.
 */
interface HostPidMetadata {
  readonly pid: number;
  readonly hostId: string;
  readonly websocketUrl: string;
}

function hostPidMetadataPath(): string {
  const home = requireHomeEnv();
  return join(home, ".traycer", "host", "pid.json");
}

export async function readHostPidMetadata(): Promise<HostPidMetadata | null> {
  // `hostPidMetadataPath()` is deliberately called OUTSIDE the try block
  // below: it can throw `requireHomeEnv()`'s fail-fast error, and that must
  // propagate, not collapse into this function's `catch { return null }`
  // (which exists for ENOENT/read errors on a legitimately-missing pid
  // file, not for "we don't know whose pid file to look for"). Catching it
  // here would silently turn a loud identity-safety failure into the same
  // "no host running" outcome a genuinely-absent file produces — exactly
  // the kind of ordering-dependent safety this fix exists to remove.
  const path = hostPidMetadataPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.pid !== "number" ||
    typeof obj.hostId !== "string" ||
    typeof obj.websocketUrl !== "string"
  ) {
    return null;
  }
  return { pid: obj.pid, hostId: obj.hostId, websocketUrl: obj.websocketUrl };
}

export function isValidLocalHostWebsocketUrl(websocketUrl: string): boolean {
  if (!URL.canParse(websocketUrl)) return false;
  const parsed = new URL(websocketUrl);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return false;
  if (parsed.hostname !== "127.0.0.1") return false;
  if (parsed.pathname !== "/rpc") return false;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  if (parsed.port.length === 0) return false;
  const port = Number.parseInt(parsed.port, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

async function tryResolveEndpoint(
  logger: ILogger,
): Promise<HostTransportEndpoint | null> {
  const metadata = await readHostPidMetadata();
  if (metadata === null) return null;
  if (!isValidLocalHostWebsocketUrl(metadata.websocketUrl)) {
    logger.warn("host pid metadata advertised an invalid websocket URL", {
      hostId: metadata.hostId,
    });
    return null;
  }
  return { hostId: metadata.hostId, websocketUrl: metadata.websocketUrl };
}

function sameEndpoint(
  current: HostTransportEndpoint | null,
  next: HostTransportEndpoint,
): boolean {
  return (
    current !== null &&
    current.hostId === next.hostId &&
    current.websocketUrl === next.websocketUrl
  );
}

const ENDPOINT_POLL_MS = 2_000;

/**
 * Polls `pid.json` into a mutable closure the transport reads on every
 * (re)connect — the same mechanism `traycer monitor` uses to survive a host
 * restart on a new port. Two invariants, both load-bearing for a
 * long-running bridge:
 *
 *   - a good endpoint is NEVER overwritten with `null` (a momentarily
 *     absent/malformed pid file just means "keep dialing the last-known
 *     URL"; a host restart is picked up on its next successful read)
 *   - polls are serialized (an in-flight read can't be clobbered
 *     out-of-order by a newer one that resolves first)
 */
export class HostEndpointPoller {
  private endpoint: HostTransportEndpoint | null = null;
  private pollInFlight = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    initial: HostTransportEndpoint | null,
    private readonly logger: ILogger,
  ) {
    this.endpoint = initial;
  }

  static async start(logger: ILogger): Promise<HostEndpointPoller> {
    const initial = await tryResolveEndpoint(logger);
    const poller = new HostEndpointPoller(initial, logger);
    poller.timer = setInterval(() => {
      poller.poll();
    }, ENDPOINT_POLL_MS);
    return poller;
  }

  get(): HostTransportEndpoint | null {
    return this.endpoint;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    void tryResolveEndpoint(this.logger)
      .then((next) => {
        if (next !== null && !sameEndpoint(this.endpoint, next)) {
          this.endpoint = next;
          this.logger.info("host endpoint refreshed", { hostId: next.hostId });
        }
      })
      .catch((err: unknown) => {
        // `hostPidMetadataPath()` can now throw `requireHomeEnv()`'s
        // fail-fast error (F1) — HOME is documented as set-before-spawn and
        // never mutated, so this should not fire in correct operation, but
        // an uncaught throw on a 2s-interval timer would otherwise become
        // an unhandled promise rejection on every tick. Surface it loudly
        // (this is exactly the identity-safety condition that must never
        // be silent) without crashing the poll loop itself.
        this.logger.error(
          "host endpoint poll failed",
          {},
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .finally(() => {
        this.pollInFlight = false;
      });
  }
}
