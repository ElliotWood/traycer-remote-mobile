// Minimal `/rpc` + `/stream` client for the chat-transfer CLI.
//
// The host closes a `/rpc` socket after one response, so every unary call
// dials its own connection. The `open` frame's manifest may NOT be empty -
// an empty one is answered with `fatalError { code: "INCOMPATIBLE" }` - so we
// advertise the released floor, read straight out of the protocol source
// rather than duplicated here. A duplicated list would drift the moment a
// method is added, and the failure mode is a fatal handshake with no clue why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOOR_SOURCE = join(HERE, "..", "..", "protocol", "src", "host", "released-floor.ts");

let floorCache = null;

/** The released-floor method names, parsed from the single source of truth. */
export function floorMethods() {
  if (floorCache !== null) return floorCache;
  const src = readFileSync(FLOOR_SOURCE, "utf8");
  const body = src.slice(src.indexOf("["), src.lastIndexOf("]"));
  floorCache = [...body.matchAll(/"([a-zA-Z][a-zA-Z.]*)"/g)].map((m) => m[1]);
  if (floorCache.length === 0) {
    throw new Error(`no floor methods parsed from ${FLOOR_SOURCE}`);
  }
  return floorCache;
}

/**
 * Stream manifest. Advertised at the major/minor floor of each line: a host
 * newer than this file still bridges down, and an older one is not excluded.
 */
export const STREAM_MANIFEST = Object.freeze({
  "epic.subscribe": { major: 1, minor: 0 },
  "chat.subscribe": { major: 1, minor: 0 },
  "notifications.subscribe": { major: 1, minor: 0 },
  "terminal.subscribe": { major: 1, minor: 0 },
  "git.subscribeStatus": { major: 1, minor: 0 },
  "resources.subscribe": { major: 1, minor: 0 },
  "agent.inbox.subscribe": { major: 1, minor: 0 },
  "speech.dictate": { major: 1, minor: 0 },
  "migration.run": { major: 1, minor: 0 },
});

function unaryManifest() {
  const m = {};
  for (const name of floorMethods()) m[name] = { major: 1, minor: 0 };
  return m;
}

export class RpcError extends Error {
  constructor(method, code, message) {
    super(`${method}: ${code} — ${message}`);
    this.code = code;
    this.method = method;
  }
}

/** One unary call, one socket. Resolves the `result`, throws on `error`. */
export function rpc(host, method, params, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${host.origin}/rpc`);
    const timer = setTimeout(
      () => settle(reject, new Error(`${method} timed out after ${timeoutMs}ms against ${host.alias}`)),
      timeoutMs,
    );
    let settled = false;
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      fn(value);
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ kind: "open", token: host.token, manifest: unaryManifest() }));
    });
    ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data));
      if (frame.kind === "openAck") {
        // Call at the host's own major, minor 0: the floor line every host in
        // the field still serves.
        const canonical = frame.manifest?.[method] ?? frame.optionalManifest?.[method];
        if (canonical === undefined) {
          settle(reject, new RpcError(method, "E_HOST_UNSUPPORTED", `${host.alias} does not serve this method`));
          return;
        }
        ws.send(JSON.stringify({
          kind: "request",
          requestId: "1",
          method,
          schemaVersion: { major: canonical.major, minor: 0 },
          params,
        }));
        return;
      }
      if (frame.kind === "response") {
        if (frame.error) settle(reject, new RpcError(method, frame.error.code, frame.error.message));
        else settle(resolve, frame.result);
        return;
      }
      if (frame.kind === "fatalError") {
        settle(reject, new Error(`${host.alias} rejected the handshake: ${frame.details?.code} ${frame.details?.reason}`));
      }
    });
    ws.addEventListener("error", () => settle(reject, new Error(`could not reach ${host.alias} at ${host.origin}`)));
    ws.addEventListener("close", (e) => settle(reject, new Error(`${host.alias} closed the socket (${e.code}) ${e.reason}`)));
  });
}

/**
 * Subscribe on `/stream` and resolve the first frame `accept` matches, then
 * close. Enough for the read-only snapshots this tool needs; it is not a
 * long-lived subscription.
 */
export function streamOnce(host, method, params, accept, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${host.origin}/stream`);
    ws.binaryType = "arraybuffer";
    const kinds = [];
    let settled = false;
    const timer = setTimeout(
      () => settle(reject, new Error(`${method} produced no matching frame within ${timeoutMs}ms (saw: ${kinds.join(", ") || "nothing"})`)),
      timeoutMs,
    );
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      fn(value);
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ kind: "open", token: host.token, manifest: STREAM_MANIFEST }));
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return; // paired binary payload; unused here
      const frame = JSON.parse(event.data);
      kinds.push(frame.kind);
      if (frame.kind === "openAck") {
        ws.send(JSON.stringify({ kind: "subscribe", method, schemaVersion: STREAM_MANIFEST[method], params }));
        return;
      }
      if (frame.kind === "fatalError") {
        settle(reject, new Error(`${host.alias} rejected the stream handshake: ${frame.details?.code} ${frame.details?.reason}`));
        return;
      }
      if (accept(frame)) settle(resolve, frame);
    });
    ws.addEventListener("error", () => settle(reject, new Error(`could not reach ${host.alias} at ${host.origin}`)));
    ws.addEventListener("close", (e) => settle(reject, new Error(`${host.alias} closed the stream (${e.code}) ${e.reason}; saw: ${kinds.join(", ") || "nothing"}`)));
  });
}

/**
 * A chat as the given host sees it. Works for a chat bound to a DIFFERENT
 * host - the epic's Yjs room is replicated, so every host holds the full
 * transcript. See README for what that does and does not make true.
 */
export function readChat(host, epicId, chatId) {
  return streamOnce(host, "chat.subscribe", { epicId, chatId }, (f) => f.kind === "snapshot")
    .then((f) => f.snapshot);
}

/** The epic's replicated metadata: repos, workspaces and their owning hosts. */
export function readEpicMeta(host, epicId) {
  return streamOnce(host, "epic.subscribe", { epicId }, (f) => f.kind === "snapshot" && f.meta !== undefined)
    .then((f) => f.meta);
}
