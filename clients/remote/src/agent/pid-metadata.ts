import { readFile } from "node:fs/promises";

/**
 * Mirror of the writer contract owned by the Traycer Host, reimplemented
 * standalone (see `pid-json-path.ts`'s header comment for why). Tolerates
 * unknown legacy keys by parsing as a wider record and projecting only the
 * keys needed.
 */
export interface HostPidMetadata {
  readonly pid: number;
  readonly hostId: string;
  readonly version: string;
  readonly websocketUrl: string;
  readonly startedAt: string;
}

/**
 * Reads and validates `pid.json`. Returns `null` on any failure (missing
 * file, malformed JSON, malformed shape) rather than throwing - a missing or
 * stale `pid.json` is the ordinary "host not running" state, not an error
 * this process should crash on.
 */
export async function readHostPidMetadata(
  path: string,
): Promise<HostPidMetadata | null> {
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
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
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

/**
 * Loopback-only, `/rpc`-only, well-formed `ws:`/`wss:` URL check - mirrors
 * `clients/traycer-cli/src/host/pid-metadata.ts`'s `isValidLocalHostWebsocketUrl`.
 * A `pid.json` advertising anything else is treated as absent (never dialed).
 */
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
