// THROWAWAY: WS-aware TCP passthrough so the phone can reach the loopback host.
// Binds the Tailscale interface :5274 and forwards to 127.0.0.1:55945, but first
// REWRITES the Host + Origin headers of the WS upgrade request to loopback —
// the host WS rejects non-loopback Host. After the header, pipes raw bytes
// (protocol-agnostic, unlike Vite's ws proxy which ECONNRESETs on WS-RPC).
import net from "node:net";

const LISTEN_HOST = "100.110.27.82";
const LISTEN_PORT = 5274;
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 55945;
const LOOPBACK_HOST = `${TARGET_HOST}:${TARGET_PORT}`;
const LOOPBACK_ORIGIN = "http://127.0.0.1:5273";

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST);
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
  console.log(`ws-aware tcp proxy ${LISTEN_HOST}:${LISTEN_PORT} -> ${LOOPBACK_HOST} (Host/Origin rewritten)`),
);
