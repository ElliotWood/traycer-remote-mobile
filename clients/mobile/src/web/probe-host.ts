/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `vite.config.web.ts`; same scope and same caveat.
 *
 * A single-shot reachability probe for one host, used to give the host
 * picker an HONEST per-entry status.
 *
 * Why this exists at all: `HostDirectoryEntry.status` is a field with a
 * renderer and, for a directly-dialled host, no producer - the baked entry
 * was hardcoded `"available"`, so a host that was switched off looked
 * exactly like one that was running. That is the same defect family as the
 * `stale` connection state (a renderer with no producer). This module is
 * the producer.
 *
 * It deliberately re-uses the real handshake pieces rather than
 * re-deriving them:
 *   - `splitConnectionManifest(registry, RELEASED_FLOOR_METHOD_NAMES)` is
 *     the same call `WsRpcClient.buildManifest()` makes. An EMPTY manifest
 *     makes the host close the socket with `fatalError {code:
 *     "INCOMPATIBLE"}`, so it cannot be stubbed out.
 *   - one WebSocket carries one RPC call, and `openAck` must be awaited
 *     before a `request` frame is sent.
 *
 * What a green probe proves, exactly: the socket opened, the host accepted
 * THIS bearer, and it answered `host.status`. That is a real end-to-end
 * check including auth - not a TCP ping. It does not prove the host will
 * still be up a second later, which is why the picker probes on open
 * rather than caching a verdict.
 */
import { splitConnectionManifest } from "@traycer/protocol/framework/capability-manifest";
import { RELEASED_FLOOR_METHOD_NAMES } from "@traycer/protocol/host/released-floor";
import { hostRpcRegistry } from "@traycer-clients/gui-app";

/**
 * The three outcomes a probe can honestly report. `unknown` is NOT folded
 * into `unreachable`: with no bearer we have not learned anything about the
 * host, and rendering "offline" for "we did not ask" is the same lie in the
 * other direction.
 */
export type HostProbeResult =
  | { readonly kind: "reachable"; readonly hostVersion: string }
  | { readonly kind: "unreachable"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

const DEFAULT_PROBE_TIMEOUT_MS = 8_000;

/** `host.status` is on the released floor, so every host answers it. */
const STATUS_METHOD = "host.status";
const FLOOR_SCHEMA_VERSION = { major: 1, minor: 0 } as const;

function readHostVersion(result: unknown): string | null {
  if (result === null || typeof result !== "object") return null;
  const version = (result as Record<string, unknown>).hostVersion;
  return typeof version === "string" && version.length > 0 ? version : null;
}

/**
 * Opens one WebSocket, completes the handshake, asks `host.status`, and
 * closes. Never throws - every failure path collapses into a discriminated
 * result, so a caller mapping N hosts cannot have one bad URL reject the
 * whole refresh.
 */
export async function probeHost(params: {
  readonly websocketUrl: string;
  readonly token: string | null;
  readonly timeoutMs?: number;
}): Promise<HostProbeResult> {
  const { websocketUrl, token } = params;
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  if (token === null) {
    return { kind: "unknown", reason: "Signed out - not probed." };
  }

  let socket: WebSocket;
  try {
    // A malformed URL throws synchronously here rather than firing `error`.
    socket = new WebSocket(websocketUrl);
  } catch {
    return { kind: "unreachable", reason: "Not a valid WebSocket URL." };
  }

  return await new Promise<HostProbeResult>((resolve) => {
    let settled = false;

    const finish = (result: HostProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Closing a socket that never opened is not an error worth surfacing.
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ kind: "unreachable", reason: "Timed out." });
    }, timeoutMs);

    socket.onerror = () => {
      // The browser deliberately withholds the cause of a WebSocket failure
      // (DNS, refused, TLS, mixed-content) from script, so this reason stays
      // vague on purpose rather than inventing a specific one.
      finish({ kind: "unreachable", reason: "Could not connect." });
    };

    socket.onclose = () => {
      finish({ kind: "unreachable", reason: "Connection closed." });
    };

    socket.onopen = () => {
      const manifest = splitConnectionManifest(
        hostRpcRegistry,
        RELEASED_FLOOR_METHOD_NAMES,
      );
      socket.send(
        JSON.stringify({
          kind: "open",
          token,
          manifest: manifest.manifest,
          optionalManifest: manifest.optionalManifest,
        }),
      );
    };

    socket.onmessage = (event: MessageEvent) => {
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (parsed === null || typeof parsed !== "object") {
          finish({ kind: "unreachable", reason: "Unrecognised reply." });
          return;
        }
        frame = parsed as Record<string, unknown>;
      } catch {
        finish({ kind: "unreachable", reason: "Unrecognised reply." });
        return;
      }

      if (frame.kind === "openAck") {
        socket.send(
          JSON.stringify({
            kind: "request",
            requestId: crypto.randomUUID(),
            method: STATUS_METHOD,
            schemaVersion: FLOOR_SCHEMA_VERSION,
            params: {},
          }),
        );
        return;
      }

      if (frame.kind === "response") {
        const hostVersion = readHostVersion(frame.result);
        if (hostVersion === null) {
          // Reached and authenticated, but it did not answer the one floor
          // method every host implements. Report reachable-with-no-version
          // rather than inventing one.
          finish({ kind: "reachable", hostVersion: "unknown" });
          return;
        }
        finish({ kind: "reachable", hostVersion });
        return;
      }

      if (frame.kind === "fatalError") {
        // The host answered - it is up - but refused this connection. The
        // most common causes are a rejected bearer and a manifest the host
        // considers incompatible. Both mean "you cannot use this host right
        // now", which is what the picker needs to convey.
        const details = frame.details;
        const code =
          details !== null &&
          typeof details === "object" &&
          typeof (details as Record<string, unknown>).code === "string"
            ? (details as Record<string, unknown>).code
            : "unknown";
        finish({ kind: "unreachable", reason: `Host refused: ${String(code)}` });
        return;
      }

      finish({ kind: "unreachable", reason: "Unrecognised reply." });
    };
  });
}
