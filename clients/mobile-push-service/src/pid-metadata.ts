import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Mirror of the writer contract owned by the host (external, not this repo),
 * and of the CLI's own reader (`clients/traycer-cli/src/host/pid-metadata.ts`)
 * — reimplemented here rather than imported since `clients/traycer-cli/src`
 * is not a shared package boundary. Production-only (no dev-environment
 * nesting), matching `host-auth.ts`'s scope.
 */
export interface HostPidMetadata {
  readonly pid: number;
  readonly hostId: string;
  readonly version: string;
  readonly websocketUrl: string;
  readonly startedAt: string;
}

function hostPidMetadataPath(): string {
  return join(homedir(), ".traycer", "host", "pid.json");
}

export async function readHostPidMetadata(): Promise<HostPidMetadata | null> {
  let raw: string;
  try {
    raw = await readFile(hostPidMetadataPath(), "utf8");
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
    typeof obj.version !== "string" ||
    typeof obj.websocketUrl !== "string" ||
    typeof obj.startedAt !== "string"
  ) {
    return null;
  }
  return {
    pid: obj.pid,
    hostId: obj.hostId,
    version: obj.version,
    websocketUrl: obj.websocketUrl,
    startedAt: obj.startedAt,
  };
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
