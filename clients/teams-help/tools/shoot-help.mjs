/**
 * Screenshots the help page in every theme and at every breakpoint.
 *
 * This exists because the page CANNOT be reviewed where it will run. Teams
 * enforces an origin allowlist on its own handshake, so a local iframe can
 * never complete one — the tab's real environment is unreachable from a
 * workstation. What can be checked locally is everything that does not
 * depend on Teams: the four themes, the layout at phone and desktop widths,
 * the reduced-motion path, and whether the page survives with JS disabled.
 *
 * It also runs assertions, not just captures. A screenshot pile proves
 * nothing on its own — someone has to look at every frame, and they will
 * not. The checks below fail loudly instead.
 *
 * Usage:  node clients/teams-help/tools/shoot-help.mjs
 * Output: clients/teams-help/tools/shots/
 */
import { chromium } from "playwright-core";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, "..", "site", "index.html");
const SHOTS = join(HERE, "shots");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

// playwright-core ships no browser binaries, so a system Chrome/Edge is
// used. Both are Chromium, which is also what Teams desktop embeds — so
// this is a closer match to the real renderer than a bundled build.
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome or Edge found. Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(1);
}

const THEMES = ["default", "dark", "glass", "contrast"];
const SIZES = [
  { name: "desktop", width: 1180, height: 900 },
  { name: "narrow", width: 380, height: 820 },
];

/**
 * Scrolls the whole page, then returns to the top.
 *
 * Required before both the assertions and the capture. The reveal
 * animations are driven by an IntersectionObserver, so anything below the
 * fold is legitimately at `opacity: 0` until it has been scrolled past —
 * asserting without this reports a correct page as broken, and capturing
 * without it produces a full-page screenshot whose lower two thirds are
 * blank, which is the review artifact being useless in the exact place the
 * reviewer needs it.
 */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    /*
     * Bring each revealed element into view individually, rather than
     * stepping the scroll position by a fixed stride.
     *
     * MEASURED: the stride version deterministically missed one section
     * head sitting just below the fold. IntersectionObserver does not
     * observe every intermediate scroll position — it samples at frame
     * boundaries, so an element that is only on screen between two samples
     * is never reported. Which element that is depends on viewport height
     * and on how fast the first context warms up, which is why it looked
     * like a flake and was not one.
     *
     * Addressing each target directly removes the sampling question: the
     * element is put in the middle of the viewport and left there for
     * several frames, so an observer that is working cannot miss it. One
     * that still misses it is the real defect this check exists to find.
     */
    const targets = document.querySelectorAll(".reveal, .reveal-group");
    for (const el of targets) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));
    }
    window.scrollTo(0, 0);
  });

  /*
   * Wait for the CONDITION, not for a duration.
   *
   * A fixed settle made this flaky: the first browser context is slower to
   * warm up than the seven after it, so one run reported a section still
   * hidden and the next did not. A check that fails on the first invocation
   * and passes on a re-run teaches everyone to re-run it, which is the same
   * as deleting it.
   *
   * `waitForFunction` polls, so it costs nothing when the page is already
   * settled and still gives a slow start time to catch up. If something is
   * genuinely stuck it times out and the assertion below reports which
   * element — the real failure this is meant to surface.
   */
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll(".reveal, .reveal-group")].some(
          (el) => getComputedStyle(el).opacity === "0"
        ),
      undefined,
      { timeout: 5000 }
    )
    .catch(() => {});
}

/** Every element whose right edge escapes the viewport, ignoring anything
 *  inside a container that scrolls horizontally on purpose. */
function overflowingElements() {
  const bad = [];
  const limit = document.documentElement.clientWidth + 1;
  for (const el of document.querySelectorAll("body *")) {
    /*
     * Opt IN to the two deliberate scrollers by name, rather than inferring
     * them from computed `overflow-x`.
     *
     * The inferring version treated `hidden` as a scroller and so exempted
     * everything inside `.mock` and `.cmd-list` — six card replicas and both
     * reference tables, which is most of the page's content. `hidden` does
     * not scroll, it CLIPS: content overflowing there is silently lost,
     * which is precisely the defect this check exists to catch, at precisely
     * the 380px viewport where it happens.
     *
     * So the check could not fail over the majority of the page. A check
     * that cannot fail is worse than a missing one — it reports green and
     * buys confidence it never earned.
     *
     * "Most of the page" is measured rather than estimated: at 500px, 165 of
     * 448 elements were exempt via `hidden` against 49 via a real scroller.
     * These two selectors are the whole list, verified as the only
     * `overflow-x: auto` rules in styles.css rather than assumed.
     *
     * Matched from the PARENT, which is not incidental: the old walk started
     * at `el.parentElement`, so a scroller's own box was always checked, and
     * `el.closest()` would quietly stop checking it. Only a scroller's
     * CHILDREN may be wider than the viewport — `.nav` itself running off
     * the screen is a bug like any other.
     */
    if (el.parentElement?.closest(".nav, .seq-scroll")) continue;

    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > limit) {
      bad.push(
        `${el.tagName}.${String(el.className).slice(0, 30)} right=${Math.round(r.right)}`
      );
    }
  }
  return bad.slice(0, 4);
}

let failures = 0;
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath });
const base = pathToFileURL(PAGE).href;

for (const theme of THEMES) {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    await page.goto(`${base}?theme=${theme}`);
    await scrollThrough(page);

    const label = `${theme}/${size.name}`;
    console.log(`\n${label}`);

    check(consoleErrors.length === 0, "no console errors", consoleErrors[0]);

    // The theme actually applied — the whole no-teams-js bet rests on this.
    const applied = await page.getAttribute("html", "data-theme");
    check(applied === theme, `data-theme is "${theme}"`, `got "${applied}"`);

    const overflow = await page.evaluate(overflowingElements);
    check(overflow.length === 0, "no horizontal overflow", overflow.join(" | "));

    // Every reveal fired. After a full scroll-through there is no legitimate
    // reason for one to still be hidden, so this now catches a genuinely
    // stuck observer rather than merely reporting the fold.
    const hidden = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".reveal, .reveal-group")) {
        if (getComputedStyle(el).opacity === "0") {
          out.push(
            el.tagName +
              "." +
              String(el.className).slice(0, 34) +
              " @y=" +
              Math.round(el.getBoundingClientRect().top + window.scrollY)
          );
        }
      }
      return out;
    });
    check(hidden.length === 0, "no section left invisible", hidden.join(" | "));

    await page.screenshot({
      path: join(SHOTS, `${theme}-${size.name}.png`),
      fullPage: true,
    });

    /*
     * Element shots as well as the full page.
     *
     * A full-page capture of a document this long is ~5000px tall; anything
     * that opens it scales it to fit and the type becomes unreadable, so it
     * proves the page is not blank and nothing else. These crops are what
     * someone actually judges the design from.
     */
    {
      for (const [name, sel] of [
        ["hero", "#hero-seq"],
        ["gate", ".gate"],
        ["journey-step", "#journey .step"],
        ["commands", "#commands .cmd-list"],
        ["approval-card", "#waiting .mock"],
        ["outcomes", "#journey .grid-2"],
      ]) {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.screenshot({ path: join(SHOTS, `el-${theme}-${size.name}-${name}.png`) });
        }
      }
    }

    await context.close();
  }
}

// --- the two degraded paths ---------------------------------------------

console.log("\nreduced-motion");
{
  const context = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    reducedMotion: "reduce",
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${base}?theme=default`);
  await scrollThrough(page);

  // The reduced-motion block must reveal content, not merely stop it. This
  // is the check that catches the classic `animation: none` regression that
  // leaves everything stuck at opacity 0.
  const hidden = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll(".reveal, .reveal-group")) {
      if (getComputedStyle(el).opacity === "0") n++;
    }
    return n;
  });
  check(hidden === 0, "content visible under reduced motion", `${hidden} hidden`);

  const replayHidden = await page.evaluate(
    () => document.querySelector("[data-replay]")?.hidden === true
  );
  check(replayHidden, "replay button withdrawn under reduced motion");

  await page.screenshot({ path: join(SHOTS, "reduced-motion.png"), fullPage: true });
  await context.close();
}

console.log("\nno-javascript");
{
  const context = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    javaScriptEnabled: false,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`${base}?theme=default`);
  // No scrollThrough here: with scripting off there is no observer to
  // trigger, so there is nothing to scroll for. That is the point — the
  // content must already be visible without any of it.
  //
  // The two checks below DO work despite `javaScriptEnabled: false`, which
  // reads like a contradiction and is not: the flag disables the PAGE's
  // scripts, while `page.evaluate` runs through CDP's `Runtime.evaluate`,
  // which is unaffected. Said explicitly because the obvious reading is
  // "these can't be running" and the obvious next step is to delete them.
  await page.waitForTimeout(400);

  // The whole page must still be readable. Without `[data-js]` scoping,
  // every `.reveal` would sit at opacity 0 forever and this is a blank
  // document — the single worst outcome for a help page.
  const hidden = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll(".reveal, .reveal-group")) {
      if (getComputedStyle(el).opacity === "0") n++;
    }
    return n;
  });
  check(hidden === 0, "page fully readable with JS disabled", `${hidden} hidden`);

  const words = await page.evaluate(() => document.body.innerText.trim().split(/\s+/).length);
  check(words > 700, "substantial text present without JS", `${words} words`);

  await page.screenshot({ path: join(SHOTS, "no-js.png"), fullPage: true });
  await context.close();
}

// An unrecognised theme must fall through to the OS preference rather than
// selecting nothing — this is what a host that failed to substitute the
// `{theme}` placeholder would send.
console.log("\nunsubstituted-placeholder");
{
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}?theme=%7Btheme%7D`);
  const applied = await page.getAttribute("html", "data-theme");
  check(applied === null, "literal {theme} leaves data-theme unset", `got "${applied}"`);
  await context.close();
}

await browser.close();

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
console.log(`shots in ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
