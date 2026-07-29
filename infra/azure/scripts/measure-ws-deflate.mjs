// Measure the real benefit of the deflate relay by counting RAW TCP bytes.
//
// Not a synthetic compression ratio: this subscribes to a real epic through
// both paths and reads socket.bytesRead, so the number is what actually
// crosses the wire for the payload this client actually receives.
//
// Usage: node measure-ws-deflate.mjs <epicId>
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";

const EPIC = process.argv[2];
if (!EPIC) { console.error("usage: measure-ws-deflate.mjs <epicId>"); process.exit(2); }

const HOME = process.env.HOME;
const creds = JSON.parse(readFileSync(`${HOME}/.traycer/cli/credentials`, "utf8"));
const token = creds.token ?? creds.accessToken;
const pid = JSON.parse(readFileSync(`${HOME}/.traycer/host/pid.json`, "utf8"));
const hostPort = new URL(pid.websocketUrl).port;

function run(label, url, deflate) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { perMessageDeflate: deflate, headers: { origin: `http://127.0.0.1:${hostPort}` } });
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const bytes = ws._socket ? ws._socket.bytesRead : 0;
      try { ws.close(); } catch {}
      resolve({ label, bytes });
    };
    ws.on("open", () => {
      ws.send(JSON.stringify({
        kind: "open", requestId: "m1", method: "epic.subscribe", version: "1.0",
        authorization: `Bearer ${token}`, payload: { epicId: EPIC },
      }));
    });
    // Fixed window: we are comparing bytes for the same work, not racing.
    setTimeout(done, 20000);
    ws.on("error", (e) => { console.error(`${label}: ${String(e).slice(0, 90)}`); done(); });
  });
}

const plain = await run("host, no deflate ", `ws://127.0.0.1:${hostPort}/stream`, false);
const relay = await run("relay, deflate   ", `ws://127.0.0.1:45080/stream`, true);

for (const r of [plain, relay]) console.log(`${r.label} ${(r.bytes / 1024 / 1024).toFixed(2)} MB`);
if (relay.bytes > 0 && plain.bytes > 0) {
  console.log(`ratio            ${(plain.bytes / relay.bytes).toFixed(2)}x smaller over the wire`);
}
