/**
 * Does the shell SURVIVE navigation, and does its body stay scrollable under
 * a pinned header?
 *
 * Three numbers, read from the built bundle in a real browser:
 *
 *   mounts          `window.__traycerShellMounts`, incremented by AppShell's
 *                   mount effect. React owns this: if the shell is remounted
 *                   the count rises, and no amount of correct-looking markup
 *                   can hide it. A DOM `data-` probe was tried first and
 *                   reported `sameNode: true` WHILE the shell was remounting
 *                   — it measured a node that had been detached. This counter
 *                   found two nested AppShells within a minute of replacing it.
 *
 *   bodyScrolled    the BODY REGION's scrollTop after scrolling it to the
 *                   bottom. This started life as
 *                   `documentElement.scrollHeight - clientHeight`, asserted
 *                   to be 0 — which passed, and could not have done anything
 *                   else: `frame` is `height: 100vh; overflow: hidden`, so
 *                   the document is structurally incapable of scrolling no
 *                   matter what any child does. The control proved it:
 *                   putting `minHeight: 100vh` back on `styles.screen` — the
 *                   exact defect the shell exists to fix — did not move the
 *                   number by a pixel.
 *
 *                   What actually matters is that the overflow is REACHABLE.
 *                   With `minHeight: 0` off the body, a flex child refuses to
 *                   shrink, the body grows past the frame, `overflow: hidden`
 *                   clips it, and the bottom of the content cannot be
 *                   scrolled to at all. So: the body must overflow AND must
 *                   scroll.
 *
 *   headerTop       the header's bounding top after that scroll. It must be
 *                   0 — the region is pinned, not merely present.
 *
 * THE CONTROL IS NOT IN THIS FILE, and the first draft's was worthless: it
 * reloaded the page and watched the counter read 1 again, which a fresh
 * document does unconditionally. A control has to be able to fail. The real
 * one is run OUTSIDE this script, against the same instrument:
 *
 *   1. patch the source to reintroduce a defect
 *   2. rebuild, run this probe, and require it to EXIT NON-ZERO
 *   3. restore, rebuild, run again
 *
 * Two mutations, because this probe makes two independent claims and one
 * mutation would leave the other assertion unproven. The two that WORK, with
 * the observed failures:
 *
 *   app.tsx    nest `<AppShell>` inside the `shell()` helper
 *              → mounts 2 -> 2
 *   app-shell  body `overflowY: "auto"` -> `"visible"`
 *              → 368px below the fold, scrollTop 0, unreachable
 *
 * And two that SURVIVED, which is why they are written down rather than
 * assumed: `minHeight: 100vh` back on `styles.screen`, and deleting
 * `minHeight: 0` from the body. Neither moves any number here — the first
 * because the frame is `overflow: hidden` so the document cannot scroll at
 * all, the second because `overflowY: auto` already implies the containment.
 * A survivor is a fact about the instrument, not a spare mutation.
 *
 * Usage: CHROMIUM_PATH=... node tools/shell-probe.mjs
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const FILES = new Map();
function preload(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) preload(full, `${prefix}/${entry.name}`);
    else FILES.set(`${prefix}/${entry.name}`, readFileSync(full));
  }
}
preload(DIST, "");
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
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
const port = server.address().port;
const base = `http://localhost:${String(port)}`;

const EPIC = "e1000000-0000-4000-8000-000000000001";
const LIST = `${base}/epics?preview=epics&theme=dark`;
const DETAIL = `${base}/epics/${EPIC}?preview=agents&theme=dark`;

/**
 * The scrolling region is found by BEHAVIOUR — the header's next sibling —
 * rather than by class name, because the class is a generated Griffel hash
 * and a probe that looks for one silently finds nothing when it changes.
 */
async function measure(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const body = header?.nextElementSibling ?? null;
    if (body !== null) body.scrollTop = 99999;
    return {
      mounts: window.__traycerShellMounts ?? null,
      headerFound: header !== null,
      bodyFound: body !== null,
      // How much content sits below the fold. Zero means the view is short
      // enough that this run tests nothing — a fact worth failing on rather
      // than passing quietly.
      bodyOverflow:
        body === null ? null : body.scrollHeight - body.clientHeight,
      bodyScrolled: body === null ? null : Math.round(body.scrollTop),
      headerTop:
        header === null ? null : Math.round(header.getBoundingClientRect().top),
    };
  });
}

const browser = await chromium.launch({ executablePath });
let failed = false;
try {
  // ---- the measurement: navigate WITHIN the SPA, shell must not remount ----
  const page = await browser.newPage({ viewport: { width: 380, height: 720 } });
  await page.goto(LIST, { waitUntil: "networkidle" });
  await page.waitForSelector("header", { timeout: 8000 });
  const before = await measure(page);
  // Click a real epic row rather than pushing history by hand. A synthetic
  // `popstate` was used once and the app ignores it — a control that cannot
  // fail. If no row is clickable that is itself the finding.
  const row = page.locator(`text=Streaming Transport Reconnect`).first();
  await row.click({ timeout: 8000 });
  await page.waitForTimeout(500);
  // `measure` scrolls the body region to the bottom itself, then reads. The
  // previous version scrolled `window`, which this layout ignores entirely.
  await measure(page);
  await page.waitForTimeout(200);
  const after = await measure(page);
  console.log("LIVE   before:", JSON.stringify(before));
  console.log("LIVE   after :", JSON.stringify(after));
  const urlAfter = page.url();
  console.log("LIVE   url   :", urlAfter);
  if (!urlAfter.includes(EPIC)) {
    console.error("FAIL: navigation did not happen — nothing was measured");
    failed = true;
  }
  if (before.mounts !== 1 || after.mounts !== 1) {
    console.error(`FAIL: shell mounts ${String(before.mounts)} -> ${String(after.mounts)}, expected 1 -> 1`);
    failed = true;
  }
  if (!after.bodyFound || after.bodyOverflow <= 0) {
    console.error(
      `FAIL: nothing below the fold (overflow=${String(after.bodyOverflow)}) — this run measured no scrolling at all`,
    );
    failed = true;
  } else if (after.bodyScrolled <= 0) {
    console.error(
      `FAIL: content overflows by ${String(after.bodyOverflow)}px and will not scroll — the bottom is unreachable`,
    );
    failed = true;
  }
  if (after.headerTop !== 0) {
    console.error(`FAIL: header moved to ${String(after.headerTop)} under scroll`);
    failed = true;
  }
  await page.close();

  // NO CONTROL BLOCK HERE. The first draft had one that reloaded the page
  // and watched the counter read 1 again — which a fresh document does
  // unconditionally. See the header: the controls are two source mutations
  // run from outside, each required to turn this probe red.
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
