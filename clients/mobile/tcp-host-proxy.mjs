// THROWAWAY: WS-aware TCP passthrough so the phone can reach the loopback host.
// Binds the Tailscale interface :5274 and forwards to 127.0.0.1:55945, but first
// REWRITES the Host + Origin headers of the WS upgrade request to loopback —
// the host WS rejects non-loopback Host. After the header, pipes raw bytes
// (protocol-agnostic, unlike Vite's ws proxy which ECONNRESETs on WS-RPC).
import net from "node:net";

const LISTEN_HOST = "100.110.27.82";
const LISTEN_PORT = 5274;
const TARGET_HOST = "127.0.0.1";
// The Traycer host picks a NEW random port every restart, so never hardcode it:
// read the authoritative port from ~/.traycer/host/pid.json at connect time.
// (Observed: 55945 → 53303 → 59201 across restarts, each one silently breaking
// the phone rig until repointed. Re-reading per connection makes a host restart
// self-healing — reconnect and it finds the new port.)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PID_JSON = join(homedir(), ".traycer", "host", "pid.json");
let lastPort = 59201;

function currentHostPort() {
  try {
    const url = JSON.parse(readFileSync(PID_JSON, "utf8")).websocketUrl;
    const port = Number(new URL(url).port);
    if (Number.isFinite(port) && port > 0) {
      if (port !== lastPort) {
        console.log(`host port changed ${lastPort} -> ${port} (from pid.json)`);
        lastPort = port;
      }
      return port;
    }
  } catch {
    // fall through to the last known port
  }
  return lastPort;
}
const LOOPBACK_ORIGIN = "http://127.0.0.1:5273";

const server = net.createServer((client) => {
  // Resolve the port per-connection so a host restart is self-healing.
  const port = currentHostPort();
  const LOOPBACK_HOST = `${TARGET_HOST}:${port}`;
  const upstream = net.connect(port, TARGET_HOST);
  let buf = Buffer.alloc(0);
  let rewritten = false;
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.end());
  upstream.on("close", () => client.end());
  upstream.pipe(client); // downstream: host -> phone, raw

  client.on("data", (chunk) => {
    if (rewritten) { upstream.write(chunk); return; }
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) {
      if (buf.length > 65536) { rewritten = true; upstream.write(buf); }
      return;
    }
    let head = buf.slice(0, idx).toString("utf8");
    const body = buf.slice(idx + 4); // bytes after headers (usually empty pre-upgrade)
    head = head.replace(/Host:[^\r\n]*/i, `Host: ${LOOPBACK_HOST}`);
    head = head.replace(/Origin:[^\r\n]*/i, `Origin: ${LOOPBACK_ORIGIN}`);
    upstream.write(Buffer.concat([Buffer.from(head + "\r\n\r\n", "utf8"), body]));
    rewritten = true;
  });
});
server.on("error", (e) => console.error("proxy server error:", e.message));
server.listen(LISTEN_PORT, LISTEN_HOST, () =>
  console.log(
    `ws-aware tcp proxy ${LISTEN_HOST}:${LISTEN_PORT} -> ${TARGET_HOST}:${currentHostPort()} ` +
      `(Host/Origin rewritten; port re-read from pid.json per connection)`,
  ),
);
