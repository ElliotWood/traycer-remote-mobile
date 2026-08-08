/**
 * THE SEAM: this client's `ensurePushSubscription` against the REAL
 * `mobile-push-service` HTTP API, over a real socket.
 *
 * WHY THIS EXISTS AS A PROBE RATHER THAN A UNIT TEST. The two halves live on
 * DIFFERENT BRANCHES — the shell is on `demo/upstream-mobile-web-build`, the
 * service is on `main` — so no single package can import both, and no test
 * runner in either tree can put one's output into the other's input. That is
 * precisely the arrangement that produced the payload-shape bug this epic
 * already paid for: `push-payload.test.ts` asserted the producer, `sw.test.ts`
 * asserted the consumer, both were green, and the two disagreed about the key
 * AND the shape. A wire format nobody crosses is a wire format nobody checked.
 *
 * WHAT IS REAL HERE, stated so nobody over-reads a green line:
 *   - the service's `createHttpApiServer`, `SubscriptionStore` and
 *     `loadOrCreateVapidKeys` — the shipped modules, not reimplementations
 *   - a real VAPID keypair from `web-push`'s `generateVAPIDKeys()`, minted this
 *     run into a temp directory
 *   - a real TCP socket and the real global `fetch`
 *   - the client's real `ensurePushSubscription`, imported from the shell
 *
 * WHAT IS FAKED, and it is two things:
 *   - `validateBearer`, at the module's own documented injectable seam. The real
 *     one calls production AuthnV3, which an unattended probe has no business
 *     doing and no valid token for.
 *   - the browser's `PushManager`. That half is a real-browser question, and
 *     `push-notification-probe.mjs` is where it belongs; this probe is about
 *     whether the two sides of OUR wire agree.
 *
 * Usage:  bun scratch/next-probe/push-subscribe-seam-probe.mjs <path-to-repo-with-mobile-push-service>
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const serviceRepo = process.argv[2];
if (serviceRepo === undefined) {
  console.error(
    "usage: bun push-subscribe-seam-probe.mjs <path-to-repo-with-clients/mobile-push-service>",
  );
  process.exit(2);
}

const serviceSrc = path.join(serviceRepo, "clients", "mobile-push-service", "src");
const mod = (file) => pathToFileURL(path.join(serviceSrc, file)).href;

const { createHttpApiServer } = await import(mod("http-api.ts"));
const { SubscriptionStore } = await import(mod("subscription-store.ts"));
const { loadOrCreateVapidKeys } = await import(mod("vapid-keys.ts"));
const { ensurePushSubscription, base64UrlToBytes } = await import(
  pathToFileURL(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "clients",
      "mobile",
      "src",
      "web",
      "push-subscription.ts",
    ),
  ).href
);

const BEARER = "probe-bearer-token";
const state = await mkdtemp(path.join(tmpdir(), "push-seam-"));
const results = [];
let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  results.push({ name, ok, actual, expected });
}

/**
 * The persisted store, or `[]` when the service never wrote it.
 *
 * NOT a bare `readFile`. Under a client that posts the wrong shape the service
 * 400s and the file is never created, and a probe that throws ENOENT there
 * reports a CRASH where it should report a failed check — which is the
 * difference between "the mutation was caught" and "the probe fell over".
 * Found by mutating the client and watching this happen.
 */
async function persistedSubscriptions() {
  try {
    return JSON.parse(await readFile(path.join(state, "subscriptions.json"), "utf8"));
  } catch {
    return [];
  }
}

/** A `PushSubscription` shaped exactly as the DOM produces one, over whatever key the service actually handed out. */
function fakeSubscription(endpoint, keyBytes) {
  return {
    endpoint,
    options: {
      applicationServerKey: keyBytes.buffer.slice(
        keyBytes.byteOffset,
        keyBytes.byteOffset + keyBytes.byteLength,
      ),
    },
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: "BPr0b3P256dhValue", auth: "PrObEAuthValue" },
    }),
    unsubscribe: () => Promise.resolve(true),
  };
}

const vapid = await loadOrCreateVapidKeys(path.join(state, "vapid.json"));
const store = new SubscriptionStore(path.join(state, "subscriptions.json"));
await store.load();

const server = createHttpApiServer({
  vapidPublicKey: vapid.publicKey,
  subscriptionStore: store,
  validateBearer: (token) => Promise.resolve(token === BEARER),
  now: () => 1_700_000_000_000,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

/** What the client passed to `subscribe()` — the bytes the browser would sign against. */
let offeredKey = null;
let createdEndpoint = null;

const manager = {
  getSubscription: () => Promise.resolve(null),
  subscribe: (options) => {
    offeredKey = options.applicationServerKey;
    createdEndpoint = "https://fcm.googleapis.com/fcm/send/probe-endpoint-1";
    return Promise.resolve(fakeSubscription(createdEndpoint, offeredKey));
  },
};

// ── ARM 1: the real client against the real service ───────────────────────────
const outcome = await ensurePushSubscription({
  serviceWorker: { ready: Promise.resolve({ pushManager: manager }) },
  getPermission: () => "granted",
  getBearer: () => Promise.resolve(BEARER),
  baseUrl: base,
  report: () => {},
});
check("arm1 outcome", outcome, "subscribed");

/**
 * THE CROSS-CHECK THAT ONLY THIS PROBE CAN MAKE. The client decodes the
 * service's base64url public key with its own decoder; a unit test can only
 * compare that against a fixture someone typed. Here it is compared against the
 * bytes `web-push` itself produced, this run, from a key the client never saw
 * in any other form.
 */
check(
  "arm1 decoded VAPID key === web-push's own bytes",
  offeredKey === null ? null : [...offeredKey],
  [...Buffer.from(vapid.publicKey, "base64url")],
);
check("arm1 key length", offeredKey === null ? -1 : offeredKey.length, 65);

// Read from DISK, not from the store object: the file is what survives a
// restart and what the sender reads on its next batch.
const persisted = await persistedSubscriptions();
check("arm1 persisted subscription", persisted, [
  {
    endpoint: createdEndpoint,
    keys: { p256dh: "BPr0b3P256dhValue", auth: "PrObEAuthValue" },
    subscribedAt: 1_700_000_000_000,
  },
]);

// ── ARM 2: THE CONTROL — the shape the client does NOT send ──────────────────
// Without this, arm 1 passing could mean the service accepts anything. This is
// the flattened body a reasonable person would write by hand, and the service
// must refuse it.
const controlResponse = await fetch(`${base}/subscribe`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${BEARER}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    endpoint: "https://fcm.googleapis.com/fcm/send/control",
    p256dh: "BPr0b3P256dhValue",
    auth: "PrObEAuthValue",
  }),
});
check("arm2 control (flat body) status", controlResponse.status, 400);

const afterControl = await persistedSubscriptions();
check("arm2 control left the store alone", afterControl.length, 1);

// ── ARM 3: the bearer gate is real on both routes ────────────────────────────
const noBearer = await ensurePushSubscription({
  serviceWorker: { ready: Promise.resolve({ pushManager: manager }) },
  getPermission: () => "granted",
  getBearer: () => Promise.resolve("not-the-token"),
  baseUrl: base,
  report: () => {},
});
check("arm3 wrong bearer", noBearer, "unavailable");

// ── ARM 4: the unrouted deployment, which is TODAY's state ───────────────────
// `/push` does not exist on the live origin yet. The client must degrade to a
// reported outcome rather than leaving an undeliverable subscription behind.
const unrouted = await ensurePushSubscription({
  serviceWorker: { ready: Promise.resolve({ pushManager: manager }) },
  getPermission: () => "granted",
  getBearer: () => Promise.resolve(BEARER),
  baseUrl: `${base}/nope`,
  report: () => {},
});
check("arm4 unrouted service", unrouted, "unavailable");

// ── ARM 5: re-running upserts rather than duplicating ────────────────────────
await ensurePushSubscription({
  serviceWorker: {
    ready: Promise.resolve({
      pushManager: {
        getSubscription: () =>
          Promise.resolve(fakeSubscription(createdEndpoint, offeredKey)),
        subscribe: () => Promise.reject(new Error("must not re-subscribe")),
      },
    }),
  },
  getPermission: () => "granted",
  getBearer: () => Promise.resolve(BEARER),
  baseUrl: base,
  report: () => {},
});
const afterRepeat = await persistedSubscriptions();
check("arm5 repeat run does not duplicate", afterRepeat.length, 1);

server.close();
await rm(state, { recursive: true, force: true });

for (const r of results) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}` +
      (r.ok ? "" : `\n        actual:   ${JSON.stringify(r.actual)}\n        expected: ${JSON.stringify(r.expected)}`),
  );
}
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
