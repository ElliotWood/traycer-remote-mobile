/**
 * Runs the REAL `mobile-push-service` pieces in a bun process, so a node-driven
 * browser probe can talk to them over a real socket.
 *
 * WHY IT IS A SEPARATE PROCESS AND NOT AN IMPORT. Two constraints collide.
 * Chromium times out at 180s under bun (`--remote-debugging-pipe` gets a pid
 * and never connects), so the browser half MUST run under node; and the
 * service's sources are TypeScript with extensionless relative imports, which
 * node's ESM resolver will not load even with `--experimental-strip-types`. A
 * process boundary satisfies both, and it makes the probe MORE faithful rather
 * than less: the client's registration now crosses a genuine socket to a
 * genuinely separate process, which is what the deployment does.
 *
 * Prints one line of JSON — `{apiBase, vapidPublicKey, bearer}` — then serves
 * until killed. Adds ONE route the real service does not have,
 * `POST /__probe/send`, which triggers `sendToAll` with the caller's payload.
 * It is fenced behind this file and never reaches the shipped server.
 *
 * Usage:  bun scratch/next-probe/push-service-harness.mjs <path-to-repo-with-mobile-push-service>
 */
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const serviceRepo = process.argv[2];
if (serviceRepo === undefined) {
  console.error("usage: bun push-service-harness.mjs <path-to-repo>");
  process.exit(2);
}

const serviceSrc = join(serviceRepo, "clients", "mobile-push-service", "src");
const mod = (file) => pathToFileURL(join(serviceSrc, file)).href;
const { createHttpApiServer } = await import(mod("http-api.ts"));
const { SubscriptionStore } = await import(mod("subscription-store.ts"));
const { loadOrCreateVapidKeys } = await import(mod("vapid-keys.ts"));
const { createPushSender } = await import(mod("push-sender.ts"));

const BEARER = "probe-bearer-token";
const state = await mkdtemp(join(tmpdir(), "push-e2e-"));

const vapid = await loadOrCreateVapidKeys(join(state, "vapid.json"));
const store = new SubscriptionStore(join(state, "subscriptions.json"));
await store.load();
const sender = createPushSender({ vapidKeys: vapid, subscriptionStore: store });

const real = createHttpApiServer({
  vapidPublicKey: vapid.publicKey,
  subscriptionStore: store,
  validateBearer: (token) => Promise.resolve(token === BEARER),
  now: () => Date.now(),
});

/**
 * Fronts the real server so the probe-only routes never exist inside it.
 * Anything that is not `/__probe/*` is handed to the shipped request handler
 * untouched — same listeners, same code path, same responses.
 */
const front = createServer((req, res) => {
  if (req.url?.startsWith("/__probe/")) {
    handleProbeRoute(req, res);
    return;
  }
  real.emit("request", req, res);
});

function handleProbeRoute(req, res) {
  if (req.url === "/__probe/send" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      sender
        .sendToAll(payload)
        .then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sent: store.list().length }));
        })
        .catch((err) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        });
    });
    return;
  }
  if (req.url === "/__probe/subscriptions") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(store.list()));
    return;
  }
  res.writeHead(404).end();
}

await new Promise((r) => front.listen(0, "127.0.0.1", r));
console.log(
  JSON.stringify({
    apiBase: `http://127.0.0.1:${front.address().port}`,
    vapidPublicKey: vapid.publicKey,
    bearer: BEARER,
  }),
);

const shutdown = () => {
  front.close();
  void rm(state, { recursive: true, force: true }).finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("message", (m) => {
  if (m === "shutdown") shutdown();
});
