/**
 * THE WHOLE LOOP, with nothing of ours faked: a REAL browser subscribes with the
 * REAL service's VAPID key, registers over a REAL socket with the REAL
 * `mobile-push-service` HTTP API in a REAL separate process, the REAL `web-push`
 * sender signs and delivers to the browser's OWN push service, and the
 * notification is read back out of the page.
 *
 * WHY THIS IS A SEPARATE PROBE FROM `push-subscribe-seam-probe.mjs`. That one
 * crosses OUR wire — the client's request body against the service's schema —
 * with a faked `PushManager`, and it is deterministic and offline. This one
 * crosses the two hops neither side owns: whether a browser will mint a
 * subscription at all, and whether a push signed with our VAPID identity
 * arrives. It needs the network and a push service that may refuse, so it is
 * allowed to report a NEGATIVE result as information rather than as breakage.
 *
 * THE FIRST ARM IS A GATE, not a formality. If Chromium will not subscribe
 * here, every later arm is unmeasurable and the probe says UNKNOWN rather than
 * reporting green on a loop it never ran.
 *
 * RUN WITH NODE, NOT BUN. Chromium gets a pid and never connects under bun
 * (`--remote-debugging-pipe`, 180s timeout) — a known property of this box,
 * recorded in `fluent-tab-plan`. The service half therefore runs in a bun child
 * process; see `push-service-harness.mjs`.
 *
 * Usage:
 *   node scratch/next-probe/push-endtoend-probe.mjs <docroot> <path-to-repo-with-mobile-push-service>
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [docrootArg, serviceRepo] = process.argv.slice(2);
if (docrootArg === undefined || serviceRepo === undefined) {
  console.error(
    "usage: node push-endtoend-probe.mjs <docroot> <path-to-repo-with-clients/mobile-push-service>",
  );
  process.exit(2);
}

const DOCROOT = resolve(docrootArg);
const BASE = "/next/";
const CHROME =
  process.env.TRAYCER_PROBE_CHROME ??
  "C:/Users/gigaf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const BUN = process.env.TRAYCER_PROBE_BUN ?? `${process.env.USERPROFILE}/.bun/bin/bun.exe`;

const { chromium } = await import(
  pathToFileURL(
    "C:/repo/traycer-remote-mobile/node_modules/playwright-core/index.mjs",
  ).href
);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serveDocroot() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.startsWith(BASE)) {
        res.writeHead(404).end("outside base");
        return;
      }
      let rel = url.pathname.slice(BASE.length);
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      const file = join(DOCROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      stat(file)
        .then((info) => {
          if (!info.isFile()) throw new Error("not a file");
          res.writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
            "cache-control": "no-store",
          });
          createReadStream(file).pipe(res);
        })
        .catch(() => res.writeHead(404).end("not found"));
    });
    server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port }));
  });
}

/** Starts the bun-side service harness and waits for its one line of JSON. */
function startServiceHarness() {
  return new Promise((done, fail) => {
    const child = spawn(
      BUN,
      [join(import.meta.dirname, "push-service-harness.mjs"), serviceRepo],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => fail(new Error(`harness did not announce in 60s. stderr:\n${stderr}`)),
      60_000,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
      if (line !== undefined) {
        clearTimeout(timer);
        done({ child, info: JSON.parse(line) });
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`harness exited ${code}. stderr:\n${stderr}`));
    });
  });
}

/** A V1 activation envelope, exactly as `notification-display.ts` builds one. */
const ENVELOPE = {
  kind: "notificationActivation",
  version: 1,
  route: { kind: "chat", epicId: "epic-probe", chatId: "chat-probe" },
  feed: { source: "host", id: "feed-probe" },
  originHostId: "host-probe",
};

const result = { docroot: DOCROOT, arms: {} };
const { child, info } = await startServiceHarness();
const { server, port } = await serveDocroot();
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  headless: false,
  executablePath: CHROME,
  // `TRAYCER_PROBE_HEADFUL=1` drops `--headless=new`, so the "headless refuses
  // push registration" hypothesis can be tested without editing this file.
  args:
    process.env.TRAYCER_PROBE_HEADFUL === "1"
      ? ["--no-sandbox"]
      : ["--headless=new", "--no-sandbox"],
  // `--disable-background-networking` is one of playwright's DEFAULTS, and it
  // turns off the GCM/FCM channel a push subscription is registered over. With
  // it in place `subscribe()` rejects `AbortError: Registration failed -
  // permission denied` while BOTH `Notification.permission` and
  // `pushManager.permissionState()` read `granted` — an error message that
  // names the one cause that has been ruled out.
  ignoreDefaultArgs: ["--disable-background-networking"],
});
const context = await browser.newContext();
// 127.0.0.1 is a secure context, so neither the service worker nor the Push API
// needs a certificate.
await context.grantPermissions(["notifications"], { origin });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));

try {
  await page.goto(`${origin}${BASE}`, { waitUntil: "domcontentloaded" });
  // Waits for the app's OWN worker rather than registering a second one, so
  // this measures the shipped `sw.js` and its `push` handler.
  await page.waitForFunction(
    () => document.documentElement.dataset.pwa === "registered",
    { timeout: 30_000 },
  );

  // Preflight, so a gate failure can be attributed. "permission denied" from
  // `subscribe` means one of two completely different things — the notification
  // grant is absent, or the browser has no push provider — and only these
  // readings tell them apart.
  result.arms.preflight = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      notificationPermission: Notification.permission,
      pushPermission: await registration.pushManager
        .permissionState({ userVisibleOnly: true })
        .catch((err) => String(err)),
      hasPushManager: "pushManager" in registration,
    };
  });

  // ── ARM 1 (GATE): will this browser mint a subscription at all? ─────────────
  const subscribed = await page.evaluate(async (publicKey) => {
    const bytes = Uint8Array.from(
      atob(
        publicKey
          .padEnd(Math.ceil(publicKey.length / 4) * 4, "=")
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
      ),
      (c) => c.charCodeAt(0),
    );
    const registration = await navigator.serviceWorker.ready;
    try {
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      return { ok: true, json: sub.toJSON() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, info.vapidPublicKey);

  result.arms.subscribe = subscribed.ok
    ? { ok: true, endpointHost: new URL(subscribed.json.endpoint).host }
    : { ok: false, error: subscribed.error };

  if (!subscribed.ok) {
    result.verdict =
      "GATE FAILED: this browser would not mint a push subscription, so the " +
      "delivery half is UNMEASURABLE here — unknown, not broken.";
  } else {
    // ── ARM 2: register it with the real service, from the page ───────────────
    const registerStatus = await page.evaluate(
      async ([apiBase, bearer, json]) => {
        const response = await fetch(`${apiBase}/subscribe`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
        return response.status;
      },
      [info.apiBase, info.bearer, subscribed.json],
    );
    const stored = await fetch(`${info.apiBase}/__probe/subscriptions`).then((r) =>
      r.json(),
    );
    result.arms.register = { status: registerStatus, stored: stored.length };

    // ── ARM 3: the real sender, real web-push, real network ──────────────────
    const sendResult = await fetch(`${info.apiBase}/__probe/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Agent blocked",
        body: "Needs approval",
        payload: ENVELOPE,
        replaceKey: "epic-probe",
      }),
    }).then((r) => r.json());
    result.arms.send = sendResult;

    const delivered = await page
      .waitForFunction(
        async () => {
          const registration = await navigator.serviceWorker.ready;
          const notifications = await registration.getNotifications();
          if (notifications.length === 0) return false;
          const n = notifications[0];
          return { count: notifications.length, title: n.title, body: n.body, tag: n.tag, data: n.data };
        },
        { timeout: 45_000, polling: 500 },
      )
      .then((handle) => handle.jsonValue())
      .catch((err) => ({ error: String(err).split("\n")[0] }));

    result.arms.delivered = delivered;
    result.verdict =
      delivered.error === undefined
        ? "END TO END: a real push, signed with the service's own VAPID identity, reached a real browser and carried the envelope."
        : "Subscription and registration succeeded; DELIVERY did not arrive within the window.";
  }
} finally {
  result.pageErrors = pageErrors;
  await browser.close();
  server.close();
  child.kill("SIGTERM");
}

console.log(JSON.stringify(result, null, 2));
