/**
 * Does the REAL built service worker carry THIS service's REAL output into
 * `notification.data`?
 *
 * ## Why this exists when two unit suites already pass
 *
 * `push-payload.test.ts` proves the producer emits an envelope.
 * `push-service-envelope-contract.test.ts` proves gui-app's parser accepts it.
 * Neither touches the thing in between: `clients/mobile/src/web/sw.ts`, built,
 * installed by a browser, running its own `push` handler. That worker reads
 * `record.payload` off the pushed JSON — and the shape this replaced put the
 * target under `record.data`, which is a mistake no amount of testing either
 * END of the chain can see. The middle is where the bug lived, so the middle
 * is what this measures.
 *
 * ## The control is the old payload, not a flag
 *
 * Arm `legacy` pushes exactly what `main` sent before this change, through the
 * SAME worker, in the SAME browser, in the same run. It must show a
 * notification (title and body were always fine) and must arrive with
 * `data: null` — an unroutable click. Arm `envelope` pushes this service's
 * real `buildPushPayload` output and must arrive with the envelope whole.
 *
 * A probe whose control cannot fail is measuring the harness. This one's
 * control is the defect itself, so a run where both arms agree means the
 * harness is broken, not that the fix worked.
 *
 * ## Usage
 *
 *   node tools/push-envelope-probe.mjs <docroot|https://origin> [label]
 *
 * `<docroot>` is a built `/next/` bundle — e.g. the dist worktree at
 * `C:/Users/gigaf/.traycer/scratch/next-dist`. A value starting with `http` is
 * fetched from the live deployment instead, which is a different claim and
 * worth making separately: a green local build and a green deployment have
 * already disagreed once in this epic.
 *
 * Run with NODE, not bun — Chromium's `--remote-debugging-pipe` gets a pid and
 * never connects under bun.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/repo/traycer-remote-mobile";
const { chromium } = await import(
  pathToFileURL(`${REPO}/node_modules/playwright-core/index.mjs`).href
);

const [docrootArg, label = "unlabelled"] = process.argv.slice(2);
if (docrootArg === undefined) {
  throw new Error("usage: push-envelope-probe.mjs <docroot|origin> [label]");
}
const live = docrootArg.startsWith("http");
const DOCROOT = live ? docrootArg : resolve(docrootArg);
const BASE = "/next/";
const CHROME =
  process.env.TRAYCER_PROBE_CHROME ??
  "C:/Users/gigaf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";

/**
 * The two arms. `envelope` is READ FROM THE GOLDEN FIXTURE rather than
 * hand-written here, and the fixture is the producer's own checked-in output —
 * so this probe cannot drift into testing a payload the service does not
 * actually send, which is the failure mode of every hand-written probe
 * constant.
 */
const WIRE = (
  await import(
    pathToFileURL(
      new URL(
        "../src/__tests__/__fixtures__/push-activation-envelopes.json",
        import.meta.url,
      ).pathname.replace(/^\//, ""),
    ).href,
    { with: { type: "json" } }
  )
).default;

const ARMS = [
  {
    name: "envelope",
    what: "what this service sends now",
    push: WIRE.approval,
    expectData: WIRE.approval.payload,
  },
  {
    name: "legacy",
    what: "what it sent before — THE CONTROL",
    push: {
      title: WIRE.approval.title,
      body: WIRE.approval.body,
      data: { epicId: "epic-1", chatId: "chat-1" },
    },
    expectData: null,
  },
];

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
 * missing file there returns `index.html` with a 200. The harness being
 * stricter than production is the right direction for this one.
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
      const file = normalize(join(DOCROOT, rel));
      if (!file.startsWith(normalize(DOCROOT))) {
        res.writeHead(403).end("traversal");
        return;
      }
      stat(file)
        .then((info) => {
          if (!info.isFile()) throw new Error("not a file");
          res.writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
            // The worker must be re-fetched, not served from the HTTP cache,
            // or a second arm in the same context can run the previous build.
            "cache-control": "no-store",
          });
          createReadStream(file).pipe(res);
        })
        .catch(() => res.writeHead(404).end("missing"));
    });
    server.listen(0, "127.0.0.1", () =>
      resolvePort({ server, port: server.address().port }),
    );
  });
}

async function runArm(context, origin, arm) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(live ? docrootArg : `${origin}${BASE}`, {
    waitUntil: "load",
  });

  await page
    .waitForFunction(
      () => document.documentElement.dataset.pwa !== undefined,
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  // Waits for a MOUNTED app before reading `#root`: the same bundle has read
  // 1136 and 4482 depending only on network latency, so an unwaited read is
  // not a number two arms can be compared on.
  await page
    .waitForFunction(
      () => (document.getElementById("root")?.innerHTML.length ?? 0) > 2_000,
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);

  const swActive = await page
    .evaluate(async () => (await navigator.serviceWorker.ready).active !== null)
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

  let delivered = false;
  if (registration !== undefined) {
    // The same path a real push service takes once a subscription exists.
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId: registration.registrationId,
      data: JSON.stringify(arm.push),
    });
    delivered = true;
  }

  let notifications = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    notifications = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (await reg.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        data: n.data,
      }));
    });
    if (notifications.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const shown = notifications[0] ?? null;
  const result = {
    arm: arm.name,
    what: arm.what,
    root: await page.evaluate(
      () => document.getElementById("root")?.innerHTML.length ?? -1,
    ),
    swActive,
    delivered,
    notificationCount: notifications.length,
    title: shown?.title ?? null,
    body: shown?.body ?? null,
    tag: shown?.tag ?? null,
    data: shown?.data ?? null,
    // Serialized whole rather than compared field by field: a field sweep only
    // covers the fields somebody thought of, and a dropped one is exactly what
    // this is looking for.
    dataMatchesExpectation:
      JSON.stringify(shown?.data ?? null) === JSON.stringify(arm.expectData),
    pageErrors,
  };
  await page.close();
  return result;
}

async function main() {
  const { server, port } = live ? { server: null, port: 0 } : await serve();
  const origin = live ? new URL(docrootArg).origin : `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: ["--headless=new", "--no-sandbox"],
  });

  const arms = [];
  for (const arm of ARMS) {
    // A FRESH context per arm. Notifications and service-worker registrations
    // are per-origin state, so a shared context would let arm 1's notification
    // still be showing when arm 2 reads — and arm 2 would then pass on arm 1's
    // evidence.
    const context = await browser.newContext();
    await context.grantPermissions(["notifications"], { origin });
    arms.push(await runArm(context, origin, arm));
    await context.close();
  }

  const byName = Object.fromEntries(arms.map((a) => [a.arm, a]));
  const result = {
    label,
    docroot: DOCROOT,
    origin,
    arms,
    // The whole point, stated as one boolean per claim rather than left for a
    // reader to infer from the table.
    verdict: {
      envelopeReachesTheClick: byName.envelope?.dataMatchesExpectation === true,
      legacyArrivesUnroutable:
        byName.legacy?.notificationCount === 1 && byName.legacy?.data === null,
      // If this is false the run proves nothing: both arms did the same thing.
      controlDiscriminates:
        JSON.stringify(byName.envelope?.data ?? null) !==
        JSON.stringify(byName.legacy?.data ?? null),
    },
  };

  await browser.close();
  server?.close();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
