import type { IncomingMessage, ServerResponse } from "node:http";
import { validateAuthTokenIdentityAccessOnly } from "@traycer-clients/shared/auth/auth-validation";
import type { Registry } from "./registry";
import type { GatewayConfig } from "./config";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isFromTrustedLocalProxy(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  return LOOPBACK_ADDRESSES.has(remote);
}

/**
 * Derives the scheme/host for `websocketUrl`, per the M1 contract's
 * security note: `X-Forwarded-Proto`/`X-Forwarded-Host` are only trusted
 * when the connection itself is from loopback (where `tailscale serve`
 * actually dials in from) - an arbitrary direct caller to the public port
 * could forge those headers otherwise. A non-loopback caller gets
 * `publicScheme`/`publicHost` config (or the connection's own raw `Host`,
 * as a last resort that only ever affects the URL that SAME caller gets
 * back) - never the forwarded headers.
 */
export function deriveSchemeAndHost(
  req: IncomingMessage,
  config: GatewayConfig,
): { readonly scheme: "ws" | "wss"; readonly host: string } {
  const trusted = isFromTrustedLocalProxy(req);
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];

  const scheme: "ws" | "wss" =
    config.publicScheme ??
    (trusted && forwardedProto === "https" ? "wss" : trusted && forwardedProto === "http" ? "ws" : "ws");

  const host =
    config.publicHost ??
    (trusted && typeof forwardedHost === "string" && forwardedHost.length > 0
      ? forwardedHost
      : (req.headers.host ?? ""));

  return { scheme, host };
}

export interface HostDirectoryEntryOut {
  readonly hostId: string;
  readonly label: string;
  readonly kind: "remote";
  readonly websocketUrl: string;
  readonly version: string;
  readonly status: "available" | "unavailable";
}

export async function handleGetHosts(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Registry,
  config: GatewayConfig,
): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (match === null) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
    return;
  }
  // Checked and discarded - never persisted, never reused to dial a host or
  // agent (M1 contract, B1). This is the one gateway route that reads a
  // client credential at all.
  const result = await validateAuthTokenIdentityAccessOnly(
    config.authnUpstream,
    match[1],
  );
  if (result.kind !== "valid") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
    return;
  }

  registry.reconcileLapsedHeartbeats();
  const { scheme, host } = deriveSchemeAndHost(req, config);
  const entries: HostDirectoryEntryOut[] = registry.list().map((entry) => ({
    hostId: entry.hostId,
    label: entry.label,
    kind: "remote",
    websocketUrl: `${scheme}://${host}/h/${entry.hostId}/rpc`,
    version: entry.version,
    status: entry.status,
  }));

  // R3: zero agents ever registered is a normal first-run state - `[]`,
  // never 404/500/empty-body.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(entries));
}
