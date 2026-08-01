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
  { name: "approvals", q: "preview=approvals", path: "/epics", expects: ["Approval states", "The host declined this", "Reconnecting to your host"] },
  { name: "artifact", q: "preview=artifact", path: "/epics", expects: ["Decision", "Couldn’t render this diagram", "and a link"] },
  { name: "comments", q: "preview=comments", path: "/epics", expects: ["These words are inside an unknown node. They must still appear."] },
  { name: "authoring", q: "preview=authoring", path: "/epics", expects: ["New epic", "Create epic", "can’t read your repository"] },
  { name: "authoring-nohost", q: "preview=authoring&state=nohost", path: "/epics", expects: ["can’t create anything that has to run on one"] },
  // The EPIC form's own refusal — `createdBy` not yet resolved. Added here as
  // well as to the app, because a preview state absent from this list is one
  // no full run ever photographs: the URL exists and the gallery silently
  // skips it, which is how a state gets called "previewable" without ever
  // having been looked at.
  { name: "authoring-noidentity", q: "preview=authoring&state=noidentity", path: "/epics", expects: ["Still confirming who you’re signed in as"] },
  // Both creates failed. The only view where the retry-safety difference is
  // visible: same failure, opposite instruction.
  { name: "authoring-unconfirmed", q: "preview=authoring&state=unconfirmed", path: "/epics", expects: ["it can’t make a second agent", "creating another artifact", "creating another epic"] },
  { name: "chat", q: "preview=chat", path: "/epics", expects: ["Tool call: traycer send message", "File change: clients/teams-tab/src/config.ts", "Result"] },
  { name: "chat-pending", q: "preview=chat&state=pending", path: "/epics", expects: ["Tool call: traycer send message"] },
  { name: "chat-unconfirmed", q: "preview=chat&state=unconfirmed", path: "/epics", expects: ["Couldn’t confirm"] },
  { name: "waiting-empty", q: "preview=waiting&state=empty", path: "/waiting", expects: ["Nothing is waiting on you"] },
  { name: "waiting", q: "preview=waiting", path: "/waiting", expects: ["Streaming Transport Reconnect"] },
  { name: "waiting-loading", q: "preview=waiting&state=loading", path: "/waiting", expects: [], exempt: "a spinner and no copy of its own" },
  { name: "waiting-error", q: "preview=waiting&state=error", path: "/waiting", expects: ["Couldn’t check what’s waiting"] },
  { name: "epics", q: "preview=epics", path: "/epics", expects: ["Streaming Transport Reconnect", "Dependency Licence Audit"] },
  { name: "epics-loading", q: "preview=epics&state=loading", path: "/epics", expects: [], exempt: "skeleton rows, no copy" },
  { name: "epics-empty", q: "preview=epics&state=empty", path: "/epics", expects: ["No epics yet", "Create one from this tab"] },
  { name: "epics-error", q: "preview=epics&state=error", path: "/epics", expects: ["Couldn’t load"] },
  { name: "epics-stale", q: "preview=epics&state=disconnected", path: "/epics", expects: ["Disconnected.", "Showing what we last read 4m ago"] },
  { name: "agents", q: "preview=agents", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["Migrate config loader to zod", "Artifacts"] },
  { name: "agents-loading", q: "preview=agents&state=loading", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["Connecting to your host"] },
  { name: "agents-empty", q: "preview=agents&state=empty", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["No agents in this epic yet.", "No artifacts in this epic yet."] },
  { name: "agents-error", q: "preview=agents&state=error", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["Couldn’t load your agents", "stream closed — host unreachable"] },
  { name: "agents-deep", q: "preview=agents&state=deep", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["Untitled agent (d1000000)", "Host not known yet"] },
  { name: "agents-retrying", q: "preview=agents&state=retrying", path: "/epics/e1000000-0000-4000-8000-000000000001", expects: ["Reconnecting"] },
];

/**
 * `SHOOT_ONLY=authoring,chat` shoots a subset — the alternative to editing
 * VIEWS by hand, which is how a trimmed config once shipped and made a
 * fraction of the coverage look complete.
 *
 * It ANNOUNCES what it dropped, on both stdout and in the final line. A
 * filtered run that prints the same summary as a full one is the same defect
 * in a different place.
 */
const only = (process.env.SHOOT_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const selected =
  only.length === 0
    ? VIEWS
    : VIEWS.filter((v) => only.some((prefix) => v.name.startsWith(prefix)));
if (only.length > 0) {
  console.log(
    `SHOOT_ONLY=${only.join(",")} — ${String(selected.length)} of ${String(VIEWS.length)} views, ${String(VIEWS.length - selected.length)} SKIPPED`,
  );
  if (selected.length === 0) {
    console.error("SHOOT_ONLY matched no views — nothing would be shot");
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath });
const written = new Set();
let shots = 0;
let expectationFailures = 0;
try {
  for (const view of selected) {
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
        /**
         * GROW THE VIEWPORT TO THE CONTENT, because `fullPage` stopped
         * meaning full page the moment the shell landed.
         *
         * `frame` is `height: 100vh; overflow: hidden` and the body scrolls
         * inside it. Playwright's `fullPage` extends to the DOCUMENT's
         * scroll height, which under that layout is exactly the viewport —
         * so every shot was silently cropped at 900px and nothing said so.
         * Caught by reading one: the epic form's unconfirmed error line was
         * absent from `authoring-unconfirmed`, the single sentence that shot
         * exists to show.
         *
         * Resizing the viewport is the fix rather than scroll-and-stitch:
         * the layout is responsive to WIDTH, not height, so a taller window
         * renders the same thing with more of it visible.
         */
        const needed = await page.evaluate(() => {
          const header = document.querySelector("header");
          const body = header?.nextElementSibling ?? null;
          if (body === null) return null;
          return (
            Math.ceil(header.getBoundingClientRect().height) +
            body.scrollHeight
          );
        });
        /**
         * THE RETROACTIVE AUDIT, printed by every run from now on.
         *
         * `needed > 900` is exactly the condition under which the OLD harness
         * silently cropped this shot — 900 was the fixed viewport height and
         * `fullPage` could not exceed it. So every line here names an image
         * that, before this fix, was a plausible photograph of a screen that
         * does not exist. Anything concluded by looking at one of these
         * between the shell landing and this fix needs re-checking.
         */
        if (needed !== null && needed > 900) {
          console.log(
            `  WAS-CROPPED ${view.name}--${theme}--${width.name}: content ${String(needed)}px, old harness showed 900px`,
          );
        }
        // 4000 is a guard against a runaway list, not a target. If it ever
        // binds, the shot is truncated and SAYS so rather than looking whole.
        if (needed !== null && needed > 900) {
          const height = Math.min(needed + 8, 4000);
          if (needed + 8 > 4000) {
            console.log(`  ${view.name}/${theme}/${width.name}: content ${String(needed)}px CROPPED to 4000`);
          }
          await page.setViewportSize({ width: width.px, height });
          await page.waitForTimeout(120);
        }
        /**
         * THE DECLARED EXPECTATION, asserted against the rendered DOM before
         * the image is written.
         *
         * Presence in the DOM is NOT the check. The text must land inside the
         * region about to be captured — `bottom <= viewport height` — because
         * the defect this exists to catch was text that was present, correct,
         * and below the fold. `innerText.includes(...)` would have passed
         * happily through the entire cropped window.
         *
         * What it closes, all of it demonstrated on this project:
         *   silent truncation  expected text outside the captured region
         *   polite fixture     a view claiming to test markdown with no fence
         *                      cannot state an expectation it meets
         *   stale fixture      `chat` expecting "Tool call: traycer send
         *                      message" reddens the moment the client stops
         *                      emitting that label
         *
         * A view with no expectation is NOT silently fine — it is counted and
         * named at the end. "Look at the screen" is not a test, and this
         * audit is what that cost.
         */
        for (const phrase of view.expects) {
          const where = await page.evaluate((needle) => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            let node = walker.nextNode();
            while (node !== null) {
              if ((node.textContent ?? "").includes(needle)) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                return { found: true, bottom: Math.ceil(rect.bottom) };
              }
              node = walker.nextNode();
            }
            return { found: false, bottom: null };
          }, phrase);
          const label = `${view.name}--${theme}--${width.name}`;
          if (!where.found) {
            console.error(`  EXPECTATION MISSING ${label}: ${JSON.stringify(phrase)} is not on the page`);
            expectationFailures += 1;
          } else {
            const viewportHeight = page.viewportSize().height;
            if (where.bottom > viewportHeight) {
              console.error(
                `  EXPECTATION CROPPED ${label}: ${JSON.stringify(phrase)} ends at ${String(where.bottom)}px, capture is ${String(viewportHeight)}px`,
              );
              expectationFailures += 1;
            }
          }
        }
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
console.log(
  `shot ${String(shots)} images, ${String(onDisk)} files on disk` +
    (only.length === 0
      ? " (all views)"
      : ` — FILTERED to ${only.join(",")}, ${String(VIEWS.length - selected.length)} views not shot`),
);
/**
 * Views with NOTHING to assert, named rather than tolerated.
 *
 * These are the ones to be suspicious of: a view that cannot state what it
 * would show is a view that cannot fail, and the whole gallery was that until
 * an hour ago.
 */
const undeclared = selected.filter(
  (v) => v.expects.length === 0 && v.exempt === undefined,
);
const exempt = selected.filter((v) => v.exempt !== undefined);
for (const v of exempt) {
  console.log(`EXEMPT BY NATURE ${v.name}: ${v.exempt}`);
}
if (undeclared.length > 0) {
  console.log(
    `NO DECLARED EXPECTATION (${String(undeclared.length)} views, not a test): ${undeclared.map((v) => v.name).join(", ")}`,
  );
}
if (expectationFailures > 0) {
  console.error(`FAILED: ${String(expectationFailures)} expectation(s) missing or outside the captured region`);
  process.exit(1);
}
if (onDisk !== shots) {
  console.error("MISMATCH: images written != images shot");
  process.exit(1);
}
console.log(outDir);
