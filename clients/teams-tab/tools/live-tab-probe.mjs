/**
 * Tier 1 of the harness: drive the REAL tab against the REAL host, so the
 * questions we have been asking a human no longer need one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT MEASURES, AND THE ONE THING IT DELIBERATELY DOES NOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The question is *"does the frame appear before the epic content?"* — the
 * acceptance test for the whole shell, and the one no local test can reach,
 * because a fixture cannot produce a 50 MB snapshot with a ~40s host-side
 * serialisation in front of it.
 *
 *   ORDERING     header present before body has content   ✅ measured
 *   PROMPTNESS   how long the header stood alone          ❌ NOT measured
 *
 * Why promptness is out of reach here: `useTeamsTheme` races Teams'
 * `initialize()` against a 4-second timeout, and this harness runs OUTSIDE
 * Teams, so the boot it measures is not the boot a user gets.
 *
 * I first wrote that the race "always ends in the timeout" and MEASURED
 * OTHERWISE — the observed header appears at ~330ms, because outside Teams
 * `initialize()` REJECTS promptly rather than hanging. The 4s is a ceiling
 * for the hang case, not a tax on every run. Corrected here rather than
 * quietly deleted: the wrong version predicts every local number is 4s too
 * large, which would have had me "correcting" real measurements.
 *
 * The limit stands for a different reason. In Teams the handshake SUCCEEDS
 * and the ~40s snapshot dominates; outside it, the handshake fails fast and
 * there is no snapshot. The two intervals are not comparable in either
 * direction, so an absolute gap measured here says nothing about the one a
 * user waits through.
 *
 * The alternative — faking the Teams SDK so `initialize()` resolves fast —
 * measures a boot path no user takes. Ordering is the question Elliot
 * actually asked; promptness is stated as unreachable rather than
 * approximated.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MUTATION THAT MUST REDDEN IT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `app.tsx` does `if (!ready) return shell(null)` — the frame renders with no
 * content while the app boots. Delete that early return, or gate the frame on
 * epic data, and header and content appear together: `headerFirst` must go
 * false. Proven with `--self-test`, which runs the same assertion against a
 * locally served bundle so the mutation can be applied without touching
 * production.
 *
 * An ordering check that cannot fail would be the finest instance of this
 * project's dominant defect — a check that cannot fail, inside the harness
 * built to stop us shipping checks that cannot fail.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CREDENTIALS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `--state` points at a Playwright storage-state file holding a real device
 * token and refresh token for a real user. IT IS A CREDENTIAL: keep it
 * outside the repo, mode 600, never in a log, never in an `az vm run-command`
 * payload (those are written to disk under /var/lib/waagent/). This script
 * prints neither the path's contents nor any token.
 *
 * Seeding it is the one human step, once:
 *
 *   node tools/live-tab-probe.mjs --seed --url https://<host>/tab/ \
 *     --state ~/.traycer-tab-state.json
 *
 * which opens a real browser, waits for a human to complete the device flow,
 * and writes the state file.
 *
 * Usage:
 *   CHROMIUM_PATH=... node tools/live-tab-probe.mjs \
 *     --url https://<host>/tab/ --state <path> --epic <scratch epic id>
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

/**
 * A local static server, used ONLY by `--self-test`.
 *
 * The mutation proof has to run somewhere the source can be broken on
 * purpose, and that is never production. Same shape as `shoot-tab.mjs`: read
 * `dist/` once, serve from memory, SPA-fallback so `/epics/<id>` resolves.
 */
async function serveDist() {
  const DIST = resolve("dist");
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("no dist/ — run the build first (vite build --base=/)");
    process.exit(1);
  }
  const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
  };
  const FILES = new Map();
  const preload = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) preload(full, `${prefix}/${entry.name}`);
      else FILES.set(`${prefix}/${entry.name}`, readFileSync(full));
    }
  };
  preload(DIST, "");
  const server = createServer((req, res) => {
    const url = new global.URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/tab\//, "/");
    const key = FILES.has(path) ? path : "/index.html";
    res.writeHead(200, {
      "content-type": TYPES[extname(key)] ?? "application/octet-stream",
    });
    res.end(FILES.get(key));
  });
  await new Promise((r) => {
    server.listen(0, r);
  });
  return { server, port: server.address().port };
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const URL_ARG = arg("url");
const STATE = arg("state");
const EPIC = arg("epic");
const SELF_TEST = flag("self-test");
const CREATE_EPIC = flag("create-epic");

const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.error("CHROMIUM_PATH must point at a Chromium/Chrome executable");
  process.exit(1);
}

/**
 * What this run did NOT cover, printed every time.
 *
 * Not a caveats section — an output, the way `oss-hygiene` prints its
 * boundary. A harness whose whole purpose is to replace the one honest
 * instrument we had must be explicit about where it stops, or its green
 * becomes the same unfalsifiable adjective as "gates green".
 */
function printLimits() {
  console.log("");
  console.log("NOT COVERED BY THIS RUN:");
  console.log(
    "  · Teams rendering — Web Chat has already validated a card real Teams rejected.",
  );
  console.log("    Nothing here reaches the actual Teams client.");
  console.log("  · Teams mobile — untested and unreachable from here.");
  console.log(
    "  · Promptness — this boot is not the boot a user gets: outside Teams the SDK",
  );
  console.log(
    "    handshake fails fast and there is no 40s snapshot. ORDERING only; the",
  );
  console.log("    header-alone INTERVAL here is not comparable to the real one.");
  console.log(
    "  · Real attachment payloads — a Teams upload produces a shape only Teams",
  );
  console.log(
    "    produces. Still needs one human send with the capture flag armed.",
  );
  console.log(
    "  · Whether any of it is GOOD — the original complaint was UX. No harness",
  );
  console.log("    answers that.");
}

/**
 * The measurement.
 *
 * `headerAt` — the frame exists. `contentAt` — the scrolling body has an
 * element child. Both are timestamps relative to navigation, taken by polling
 * in the page rather than by `waitForSelector`, because two separate
 * `waitForSelector` calls serialise: the second cannot report a time earlier
 * than the first returned, which would manufacture the ordering it is meant
 * to measure.
 */
async function measureOrdering(page, url) {
  await page.addInitScript(() => {
    window.__probe = {
      headerAt: null,
      contentAt: null,
      // THE ACTUAL PROPERTY: was a frame ever on screen with nothing in it?
      framesWithHeaderOnly: 0,
      t0: Date.now(),
    };
    const tick = () => {
      const p = window.__probe;
      const header = document.querySelector("header");
      const body = document.querySelector('[data-shell-region="body"]');
      const hasContent = body !== null && body.childElementCount > 0;
      if (p.headerAt === null && header !== null) {
        p.headerAt = Date.now() - p.t0;
      }
      if (p.contentAt === null && hasContent) {
        p.contentAt = Date.now() - p.t0;
      }
      if (header !== null && !hasContent) {
        p.framesWithHeaderOnly += 1;
      }
      if (p.headerAt === null || p.contentAt === null) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url, { waitUntil: "commit" });
  // Long enough for the 4s handshake timeout plus a large snapshot.
  await page.waitForFunction(
    () => window.__probe?.contentAt !== null,
    undefined,
    { timeout: 120_000 },
  );
  return page.evaluate(() => ({
    headerAt: window.__probe.headerAt,
    contentAt: window.__probe.contentAt,
    framesWithHeaderOnly: window.__probe.framesWithHeaderOnly,
  }));
}

async function seed() {
  if (STATE === null || URL_ARG === null) {
    console.error("--seed needs --url and --state");
    process.exit(1);
  }
  const browser = await chromium.launch({ executablePath, headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL_ARG);
  console.log("Complete the device flow in the browser window.");
  console.log("Waiting for a signed-in session (10 minutes)…");
  // The signed-in tab has a sign-out control in the frame; its presence is
  // the app's own statement that a session exists, rather than our guess.
  await page.waitForSelector("header button", { timeout: 600_000 });
  mkdirSync(dirname(resolve(STATE)), { recursive: true });
  await context.storageState({ path: STATE });
  console.log(`Wrote ${STATE} — treat it as a credential: chmod 600, never commit.`);
  await browser.close();
}

async function run() {
  let served = null;
  let baseUrl = URL_ARG;
  if (SELF_TEST && URL_ARG === null) {
    served = await serveDist();
    // `preview=epics` renders real screens from fixtures with no host and no
    // session — the mutation being proven is about WHEN the frame renders,
    // which is upstream of where the data comes from.
    baseUrl = `http://localhost:${String(served.port)}/epics?preview=epics`;
  }
  if (baseUrl === null) {
    console.error("--url is required");
    process.exit(1);
  }
  if (!SELF_TEST && (STATE === null || !existsSync(STATE))) {
    console.error(
      "--state must point at a seeded storage-state file (run with --seed first)",
    );
    process.exit(1);
  }
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext(
    SELF_TEST ? {} : { storageState: STATE },
  );
  let failed = false;
  try {
    const page = await context.newPage();
    const target =
      EPIC === null
        ? baseUrl
        : `${baseUrl.replace(/\/$/, "")}/epics/${EPIC}`;
    const t = await measureOrdering(page, target);
    console.log(
      `ordering: headerAt=${String(t.headerAt)}ms contentAt=${String(t.contentAt)}ms ` +
        `framesWithHeaderOnly=${String(t.framesWithHeaderOnly)}`,
    );
    /*
     * `framesWithHeaderOnly > 0`, NOT `headerAt <= contentAt`.
     *
     * The first version asserted the timestamps and COULD NOT FAIL. Removing
     * `if (!ready) return shell(null)` — the early frame, the shell's entire
     * reason for existing — makes header and content appear in the SAME
     * frame: 348ms and 348ms, and `<=` accepts that happily.
     *
     * The property was never "the header is not later". It is "a frame was on
     * screen with nothing in it" — which is what a user waiting on a 40-second
     * snapshot actually sees, and it is zero when the frame waits for data.
     */
    const headerRenderedAlone = t.framesWithHeaderOnly > 0;
    console.log(`headerRenderedAlone=${String(headerRenderedAlone)}`);
    if (!headerRenderedAlone) {
      console.error(
        "FAIL: no frame was ever on screen without content — the shell rendered WITH the",
      );
      console.error(
        "      epic data, which is the failure mode the shell exists to prevent.",
      );
      failed = true;
    }
    await page.close();
  } finally {
    await browser.close();
    served?.server.close();
  }
  printLimits();
  if (CREATE_EPIC) {
    console.log("");
    console.log(
      "NOTE: --create-epic leaves an epic behind PERMANENTLY. The host exposes",
    );
    console.log(
      "      epic.deleteChat and no epic.delete, so nothing here can remove it.",
    );
  }
  process.exit(failed ? 1 : 0);
}

if (flag("seed")) {
  await seed();
} else {
  await run();
}
