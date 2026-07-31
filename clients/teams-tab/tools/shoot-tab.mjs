/**
 * Screenshots the tab against a real browser, across states / widths / themes.
 *
 * Shoots the BUILT bundle over HTTP rather than a dev server, because that is
 * the artifact that ships. A dev-server screenshot has been wrong here twice
 * — most recently a fix that was real in source and absent from what was
 * being served.
 *
 * Usage:
 *   bun x vite build --base=/
 *   CHROMIUM_PATH=... node tools/shoot-tab.mjs <outDir>
 */
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node tools/shoot-tab.mjs <outDir>");
  process.exit(1);
}
const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.error("CHROMIUM_PATH must point at a Chromium/Chrome executable");
  process.exit(1);
}

const DIST = resolve("dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error("no dist/ — run the build first");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/**
 * Every file read ONCE, up front, and served from memory.
 *
 * The previous version did a fresh `readFile` per request and intermittently
 * answered 404 under load — four runs died partway, at 32, 45, 9 and 15
 * images. A per-request open of the same handful of files, dozens of times
 * across concurrent pages, is a transient-failure source on Windows, and the
 * navigation retry I added first only papered over it: it made the symptom
 * rarer without removing the cause, which is why it still failed.
 *
 * There are three files. Reading them once is both the fix and the simpler
 * program.
 */
const FILES = new Map();
function preload(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) preload(full, `${prefix}/${entry.name}`);
    else FILES.set(`${prefix}/${entry.name}`, readFileSync(full));
  }
}
preload(DIST, "");

// SPA fallback, so `/epics?state=empty` serves index.html the way nginx does.
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Tolerate either base. The deployed build uses `--base=/tab/`, so its
  // asset URLs are `/tab/assets/…`; serving that dist from the root would
  // 404 every asset and fall through to index.html, which returns HTML where
  // JavaScript was expected and renders a blank page. A blank screenshot
  // would then be reported as a layout finding rather than a serving mistake.
  const path = url.pathname.replace(/^\/tab\//, "/");
  const key = FILES.has(path) ? path : "/index.html";
  const body = FILES.get(key);
  if (body === undefined) {
    res.writeHead(500);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(key)] ?? "application/octet-stream",
  });
  res.end(body);
});
await new Promise((r) => {
  server.listen(0, r);
});
const port = server.address().port;

/**
 * Widths, named for what they represent rather than by number.
 *
 * 380 is the real constraint: a Teams tab on a phone, where the grid has to
 * become a list. 780 straddles the breakpoint. 1200 is the desktop case.
 */
const WIDTHS = [
  // 320 is the narrowest Teams renders a personal tab at, and the approval
  // row — description, two buttons, an optional field and a status line — is
  // the densest thing in the app. It gets its own width rather than being
  // inferred from 380.
  { name: "tiny", px: 320 },
  { name: "phone", px: 380 },
  { name: "narrow", px: 780 },
  { name: "desktop", px: 1200 },
];

/**
 * Both themes on every shot.
 *
 * `contrast` is included because status is not allowed to be carried by
 * colour alone, and high contrast is where that rule is actually tested — a
 * badge that reads correctly in light and dark can still be meaningless here.
 */
const THEMES = ["default", "dark", "contrast"];

/** Each state, and the query that produces it. */
/**
 * Every surface and every state. RESTORED after a run was trimmed to two
 * views to iterate faster — a trimmed config does not announce itself, and
 * the next person to run it gets a full-looking "shot N images" for a
 * fraction of the coverage. Trim by commenting out, never by deleting.
 */
const VIEWS = [
  // EMPTY FIRST, deliberately: on this surface "nothing is waiting" is the
  // success state and the one most users see most often, so it is reviewed
  // first rather than last.
  { name: "approvals", q: "preview=approvals", path: "/epics" },
  { name: "chat", q: "preview=chat", path: "/epics" },
  { name: "chat-pending", q: "preview=chat&state=pending", path: "/epics" },
  { name: "chat-unconfirmed", q: "preview=chat&state=unconfirmed", path: "/epics" },
  { name: "waiting-empty", q: "preview=waiting&state=empty", path: "/waiting" },
  { name: "waiting", q: "preview=waiting", path: "/waiting" },
  { name: "waiting-loading", q: "preview=waiting&state=loading", path: "/waiting" },
  { name: "waiting-error", q: "preview=waiting&state=error", path: "/waiting" },
  { name: "epics", q: "preview=epics", path: "/epics" },
  { name: "epics-loading", q: "preview=epics&state=loading", path: "/epics" },
  { name: "epics-empty", q: "preview=epics&state=empty", path: "/epics" },
  { name: "epics-error", q: "preview=epics&state=error", path: "/epics" },
  { name: "epics-stale", q: "preview=epics&state=disconnected", path: "/epics" },
  { name: "agents", q: "preview=agents", path: "/epics/e1000000-0000-4000-8000-000000000001" },
  { name: "agents-loading", q: "preview=agents&state=loading", path: "/epics/e1000000-0000-4000-8000-000000000001" },
  { name: "agents-empty", q: "preview=agents&state=empty", path: "/epics/e1000000-0000-4000-8000-000000000001" },
  { name: "agents-error", q: "preview=agents&state=error", path: "/epics/e1000000-0000-4000-8000-000000000001" },
  { name: "agents-deep", q: "preview=agents&state=deep", path: "/epics/e1000000-0000-4000-8000-000000000001" },
  { name: "agents-retrying", q: "preview=agents&state=retrying", path: "/epics/e1000000-0000-4000-8000-000000000001" },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath });
const written = new Set();
let shots = 0;
try {
  for (const view of VIEWS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({
          viewport: { width: width.px, height: 900 },
          deviceScaleFactor: 2,
        });
        const url = `http://localhost:${String(port)}${view.path}?${view.q}&theme=${theme}`;
        // RETRY the navigation, because the local static server intermittently
        // fails a request under this load — three runs died partway, at 32,
        // 45 and 9 images, each on a different URL that worked in other runs.
        // A flaky shoot is worse than a slow one: a partial set looks like a
        // complete one unless someone counts, and the count is the only thing
        // that catches it.
        let navigated = false;
        for (let attempt = 0; attempt < 3 && !navigated; attempt += 1) {
          try {
            await page.goto(url, { waitUntil: "networkidle" });
            navigated = true;
          } catch (error) {
            if (attempt === 2) throw error;
          }
        }
        // The theme handshake races a 4s timeout before anything paints, so
        // waiting for the heading is waiting for `ready`, not for a guess.
        await page.waitForSelector("h1, h2, h3, [role=\"status\"]", { timeout: 8000 }).catch(() => {
          // `loading`/`empty`/`error` all render the heading; if one ever
          // doesn't, a blank shot is the finding, not a reason to bail.
        });
        // EVERY axis in the filename. A previous run wrote "6 images" and
        // produced 3, because the theme was missing from the name and each
        // shot overwrote its predecessor — and the false claim reached the
        // Planner before the file count did.
        const name = `${view.name}--${theme}--${width.name}.png`;
        if (written.has(name)) throw new Error(`filename collision: ${name}`);
        written.add(name);
        await page.screenshot({ path: join(outDir, name), fullPage: true });
        await page.close();
        shots += 1;
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}

// Assert the OUTPUT, not the operation: count files on disk rather than
// trusting the loop counter that just ran.
const onDisk = readdirSync(outDir).filter((f) => f.endsWith(".png")).length;
console.log(`shot ${String(shots)} images, ${String(onDisk)} files on disk`);
if (onDisk !== shots) {
  console.error("MISMATCH: images written != images shot");
  process.exit(1);
}
console.log(outDir);
