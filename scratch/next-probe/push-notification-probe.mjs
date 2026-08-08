/**
 * Drives the notification layer in a REAL browser, against a real service
 * worker, with a real push message.
 *
 * WHAT IT MEASURES, and why this particular shape. The unit tests drive the
 * generated `sw.js` with hand-written globals; they cannot tell you the browser
 * installs it, runs its `push` handler, or that a `Notification` really ends up
 * holding the payload. This delivers a push through CDP
 * (`ServiceWorker.deliverPushMessage` - the same path a real push service takes
 * once the subscription exists) and then reads the notification back out of the
 * page with `registration.getNotifications()`.
 *
 * `notification.data` is what the `notificationclick` handler reads, so a
 * payload that survives into it is the click's input measured rather than
 * assumed. The one hop this cannot cover is the click itself: no protocol
 * command clicks a notification, and neither does a headless browser.
 *
 * THE CONTROL IS A REAL BUNDLE, not a flag: run it a second time against the
 * currently-deployed docroot, which has a service worker but no `push` handler.
 * Both mount identically, so the only thing that differs is the handler - and a
 * probe whose control cannot fail is measuring the harness.
 *
 * Usage: node scratch/next-probe/push-notification-probe.mjs <docroot> <label>
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `playwright-core` is not a dependency of this worktree - it lives in the
 * repo's own `node_modules`. Imported by `file://` URL because a bare Windows
 * path is an unsupported ESM scheme (`c:`), which fails with an error about
 * URL schemes rather than about the path.
 */
const { chromium } = await import(
  pathToFileURL(
    "C:/repo/traycer-remote-mobile/node_modules/playwright-core/index.mjs",
  ).href
);

const [docrootArg, label = "unlabelled", grantArg = "grant"] = process.argv.slice(2);
if (docrootArg === undefined) {
  throw new Error("usage: push-notification-probe.mjs <docroot> <label>");
}
const DOCROOT = resolve(docrootArg);
const BASE = "/next/";
const CHROME =
  process.env.TRAYCER_PROBE_CHROME ??
  "C:/Users/gigaf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/**
 * 404s honestly. Production's nginx has an SPA fallback under `/next/`, so a
 * missing file there returns `index.html` with a 200 - which would let a
 * broken precache list "succeed". The harness being stricter than production is
 * the right direction for this one.
 */
function serve() {
  return new Promise((resolvePort) => {
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
            // The worker must be allowed to control `/next/`, which is its own
            // directory, so no `Service-Worker-Allowed` header is needed.
            "cache-control": "no-store",
          });
          createReadStream(file).pipe(res);
        })
        .catch(() => {
          res.writeHead(404).end("not found");
        });
    });
    server.listen(0, "127.0.0.1", () => {
      resolvePort({ server, port: server.address().port });
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

const PUSH = JSON.stringify({
  title: "Agent blocked",
  body: "Needs approval",
  payload: ENVELOPE,
  replaceKey: "epic-probe",
});

async function main() {
  const { server, port } = await serve();
  const origin = `http://127.0.0.1:${port}`;
  const result = { label, docroot: DOCROOT, origin };

  // 127.0.0.1 is a secure context, so service workers and the Notification API
  // are both available without a certificate.
  // The FULL chromium, not playwright's bundled `chrome-headless-shell`. The
  // shell is a stripped build and this repo's playwright-core also expects a
  // revision that is not installed - so the executable is named explicitly.
  // `--headless=new` because notifications and service workers are the things
  // old headless dropped.
  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: ["--headless=new", "--no-sandbox"],
  });
  const context = await browser.newContext();
  // The third argument exists so the ungranted arm is the SAME probe with one
  // variable changed, rather than a second script that could differ anywhere.
  if (grantArg === "grant") {
    await context.grantPermissions(["notifications"], { origin });
  }
  result.granted = grantArg === "grant";
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(`${origin}${BASE}`, { waitUntil: "load" });

  // The worker registers after `load`, so wait for the attribute the shell
  // stamps rather than a fixed sleep.
  await page
    .waitForFunction(
      () => document.documentElement.dataset.pwa !== undefined,
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);

  result.root = await page.evaluate(
    () => document.getElementById("root")?.innerHTML.length ?? -1,
  );
  result.pwa = await page.evaluate(
    () => document.documentElement.dataset.pwa ?? null,
  );
  result.notificationsAttr = await page.evaluate(
    () => document.documentElement.dataset.notifications ?? null,
  );
  result.permission = await page.evaluate(() =>
    typeof Notification === "undefined" ? "absent" : Notification.permission,
  );

  // The registration must be ACTIVE before a push can be delivered to it.
  result.swActive = await page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active !== null;
    })
    .catch((error) => `THREW: ${String(error)}`);

  const cdp = await context.newCDPSession(page);
  const registrations = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => {
    registrations.push(...event.registrations);
  });
  await cdp.send("ServiceWorker.enable");
  await new Promise((r) => setTimeout(r, 1_000));

  const registration = registrations.find(
    (entry) => entry.scopeURL.startsWith(origin) && !entry.isDeleted,
  );
  result.registrationScope = registration?.scopeURL ?? null;

  if (registration !== undefined) {
    try {
      await cdp.send("ServiceWorker.deliverPushMessage", {
        origin,
        registrationId: registration.registrationId,
        data: PUSH,
      });
      result.pushDelivered = true;
    } catch (error) {
      result.pushDelivered = `THREW: ${String(error)}`;
    }
  } else {
    result.pushDelivered = false;
  }

  // Poll: the push handler is asynchronous and the notification appears when
  // its `waitUntil` settles.
  result.notifications = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result.notifications = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const shown = await registration.getNotifications();
      return shown.map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        data: n.data,
      }));
    });
    if (result.notifications.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // The assertion that matters: the payload the click handler will read is the
  // one upstream sent, whole. Compared as a serialized object rather than field
  // by field - a field sweep only covers the fields somebody thought of.
  result.payloadRoundTripped =
    JSON.stringify(result.notifications[0]?.data ?? null) ===
    JSON.stringify(ENVELOPE);

  result.permissionBanner = await page.evaluate(
    () =>
      document.querySelector('[data-testid="notification-permission-offer"]')
        ?.textContent ?? null,
  );
  result.pageErrors = pageErrors;

  await browser.close();
  server.close();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
