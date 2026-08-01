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
 * The scrolling region is found by `data-shell-region="body"`.
 *
 * It was "the header's next sibling", which was true until the shell grew a
 * second persistent region — the epic status row — between them. A probe that
 * navigates by STRUCTURE breaks precisely when the structure is what is being
 * changed, and it breaks silently: the next sibling still exists, so it would
 * have measured the 40px status strip and reported a body that never
 * overflows.
 *
 * The class name is not an option either — Griffel hashes it.
 *
 * The distinction against the `data-` attribute that lied once before: this
 * attribute LOCATES an element. What is measured on it is scroll geometry,
 * which the browser owns. The discredited probe used an attribute to ASSERT
 * that an element had persisted, which is a claim an attribute cannot make.
 */
async function measure(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const body = document.querySelector('[data-shell-region="body"]');
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
      /*
       * The SECOND persistent region. Its whole purpose is to still be there
       * once the epic's rows arrive, so measuring it before the scroll would
       * be measuring the easy case: it was never missing at scrollTop 0, it
       * was missing at the bottom of a long list.
       *
       * Expected directly under the header — compared against the header's
       * measured BOTTOM, not against 40. Writing 40 was wrong by exactly the
       * header's 1px bottom border, which is the kind of number that gets
       * "fixed" by loosening the assertion to `> 0` — and `> 0` would pass
       * for a row that had drifted halfway down the screen. The property is
       * adjacency; measure both edges and compare them.
       */
      headerBottom:
        header === null
          ? null
          : Math.round(header.getBoundingClientRect().bottom),
      statusTop: (() => {
        const status = header?.nextElementSibling ?? null;
        if (status === null || status.hasAttribute("data-shell-region")) {
          return null; // no status published on this screen
        }
        return Math.round(status.getBoundingClientRect().top);
      })(),
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
  // The status row is the point of this commit: it must survive the scroll
  // that used to take it away. `null` means the screen published nothing,
  // which is a finding here because the epic screen always publishes.
  if (after.statusTop === null) {
    console.error("FAIL: no status row published on the epic screen");
    failed = true;
  } else if (after.statusTop !== after.headerBottom) {
    console.error(
      `FAIL: status row at ${String(after.statusTop)}px after scrolling, header ends at ${String(after.headerBottom)} — not adjacent`,
    );
    failed = true;
  }
  /*
   * A PICTURE OF THE SCROLLED STATE, when an out path is given.
   *
   * The numbers above are the proof; this is the thing a person can look at.
   * It is taken AFTER the scroll deliberately — a shot at scrollTop 0 shows
   * the two regions in the easy case, which is the case that was never
   * broken. The interesting frame is the one where the list has scrolled
   * underneath a header and a status row that did not move.
   */
  if (process.argv[2]) {
    await page.screenshot({ path: process.argv[2] });
    console.log(`LIVE   shot  : ${process.argv[2]}`);
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
