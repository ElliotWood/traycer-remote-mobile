// WebSocket relay that adds permessage-deflate on the internet-facing leg.
//
// WHY THIS EXISTS
// `epic.subscribe` sends the ENTIRE epic Y.Doc on every subscribe - measured
// 18.8 MB for one epic and 122 MB for another, against ~31 KB actually
// rendered. On a LAN that is invisible. Over the internet it is the dominant
// felt latency, and it is why the Azure origin feels slower than the tailnet
// one for the same data.
//
// The Traycer host does not negotiate permessage-deflate: its 101 response
// carries no `Sec-WebSocket-Extensions`, and the runtime binary contains no
// deflate support or env var. That is filed upstream as a protocol gap and is
// not fixable here.
//
// But the expensive hop is browser <-> VM (internet). VM <-> host is loopback,
// where compression buys nothing and costs CPU. So this relay:
//
//   browser  --wss + permessage-deflate-->  nginx  -->  THIS  --plain ws-->  host
//
// gives the ~4x measured reduction on the only leg where bytes cost time,
// while leaving the host untouched.
//
// It also re-reads pid.json PER CONNECTION, so a host restart (which picks a
// fresh ephemeral port) is absorbed here rather than needing a config rewrite.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";

const LISTEN_PORT = Number(process.argv[2] ?? 45080);
const PID_FILE = process.argv[3] ?? "/srv/traycer/tenants/elliot/.traycer/host/pid.json";

function hostOrigin() {
  // Per-connection, not cached: the host binds a fresh ephemeral port on every
  // start, and a cached value is correct only until the next restart.
  const raw = JSON.parse(readFileSync(PID_FILE, "utf8"));
  const u = new URL(raw.websocketUrl);
  return `ws://127.0.0.1:${u.port}`;
}

const server = createServer((_req, res) => {
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("upgrade required\n");
});

const wss = new WebSocketServer({
  server,
  // The whole point. Tuned to favour throughput over ratio: these payloads are
  // large and already-structured JSON, so level 6 is well past the knee.
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6, memLevel: 8 },
    threshold: 1024,
    concurrencyLimit: 10,
  },
});

wss.on("connection", (client, req) => {
  let upstream;
  try {
    upstream = new WebSocket(`${hostOrigin()}${req.url}`, {
      // Loopback leg: compression here would cost CPU and save nothing.
      perMessageDeflate: false,
      headers: { origin: hostOrigin() },
    });
  } catch (err) {
    console.error(`[ws-deflate] cannot resolve host: ${String(err)}`);
    client.close(1011, "host unavailable");
    return;
  }

  const pending = [];
  let open = false;

  upstream.on("open", () => {
    open = true;
    for (const m of pending.splice(0)) upstream.send(m);
  });
  // Buffer rather than drop: a frame sent before the upstream finishes
  // connecting is a real user action, and silently dropping it is the
  // stuck-forever bug this project has already fixed once client-side.
  client.on("message", (data, isBinary) => {
    if (open) upstream.send(data, { binary: isBinary });
    else pending.push(data);
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  // Byte accounting, logged once per connection.
  //
  // A synthetic subscribe measured nothing useful: it errored before any
  // payload arrived, then divided two handshake-sized numbers and produced a
  // plausible ratio close enough to the expected figure to be believed. That
  // is the hollow-green pattern this epic keeps finding, appearing in its own
  // verification. Counting the REAL session is the honest instrument:
  // `bytesWritten` to the browser is post-compression, `bytesRead` from the
  // host is pre-compression, so the ratio is measured rather than assumed.
  const report = () => {
    const toClient = client._socket ? client._socket.bytesWritten : 0;
    const fromHost = upstream._socket ? upstream._socket.bytesRead : 0;
    // Below 64 KB the ratio is dominated by framing overhead and means
    // nothing - which is precisely how the bogus measurement arose.
    if (fromHost < 65536) return;
    const ratio = toClient > 0 ? (fromHost / toClient).toFixed(2) : "n/a";
    console.error(
      `[ws-deflate] ${req.url} host->relay ${(fromHost / 1048576).toFixed(2)} MB, ` +
        `relay->browser ${(toClient / 1048576).toFixed(2)} MB, ratio ${ratio}x`,
    );
  };

  const bye = (code, reason) => {
    try { client.close(code, reason); } catch {}
    try { upstream.close(); } catch {}
  };
  client.on("close", () => { report(); try { upstream.close(); } catch {} });
  upstream.on("close", (code, reason) => bye(code >= 1000 && code <= 4999 ? code : 1011, reason));
  upstream.on("error", (err) => { console.error(`[ws-deflate] upstream: ${String(err)}`); bye(1011, "upstream error"); });
  client.on("error", () => { try { upstream.close(); } catch {} });
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.error(`[ws-deflate] listening on 127.0.0.1:${LISTEN_PORT}, upstream from ${PID_FILE}`);
});
