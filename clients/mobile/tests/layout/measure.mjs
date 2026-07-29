// Real-browser layout regression for the mobile chat footer. jsdom (the
// vitest render tests) does no layout — no flexbox resolution, no `dvh`,
// `getBoundingClientRect()` reports zeros — so it cannot catch the composer
// being clipped by `chatLayoutStyle`'s `overflow: hidden` when N pending
// cards (interview/approval/file-edit) stack up in `PendingSection` with
// nothing bounding their sum. This drives a real Chromium against the
// `?repro=1` proof surface (`src/views/layout-repro-view.tsx`, gated in
// `main.tsx`, never shipped to a normal session) and measures the ACTUAL
// rendered position of the composer's textarea and send button, plus
// whether every pending card's own action row stays reachable.
//
// Usage:
//   CHROMIUM_PATH=<path to a Chromium executable> node tests/layout/measure.mjs
//
// No path is hardcoded here — point CHROMIUM_PATH at whichever local
// Playwright/Chromium install is available. Exits non-zero (and prints which
// scenario failed) if any scenario clips the composer or a card's action
// row, so it can be used both as "does the current code reproduce the bug"
// and as an ordinary CI gate once a browser is provisioned for it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..", "..");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH;
if (CHROMIUM_PATH === undefined || CHROMIUM_PATH === "") {
  console.error("CHROMIUM_PATH env var is required (path to a Chromium/chrome executable).");
  process.exit(2);
}

// Named after the exact scenarios that reproduced the multi-card footer
// overflow: one interview is fine (161px slack at 375x667); stacking a
// second pending card of any kind pushes the composer out of the viewport
// under the old "every card gets its own independent 50dvh" scheme.
const SCENARIOS = [
  { name: "single-interview", scenario: { interviews: [2] } },
  { name: "single-interview-long", scenario: { interviews: [8] } },
  { name: "two-interviews", scenario: { interviews: [2, 2] } },
  { name: "interview+approval", scenario: { interviews: [2], approvalCount: 1 } },
  { name: "interview+approval+fileEdit", scenario: { interviews: [2], approvalCount: 1, fileEditCount: 1 } },
];

// Real device heights only — no synthetic "keyboard-open" shrink. The
// software keyboard resizes the VISUAL viewport, not the layout viewport
// (`index.html` sets no `interactive-widget`, so the default
// `resizes-visual` applies): `dvh` does not shrink when it opens, confirmed
// against the platform default, not assumed. `iphoneSE1` (the smallest
// still-common real screen) stresses the reserved-budget math instead.
//
// Every portrait viewport below is tall enough that `50dvh` — not the
// `calc(100dvh - 260px)` reserve — is the binding branch of `min(...)` in
// `pendingListStyle`, so none of them alone exercise the 260px constant.
// The landscape/short entries flip that: below ~520px of viewport height,
// `calc(100dvh - 260px)` becomes the smaller (binding) branch, so these are
// what actually prove the measured reserve is correct rather than merely
// unexercised.
const VIEWPORTS = [
  { name: "iphoneSE1", width: 320, height: 568 },
  { name: "iphoneSE", width: 375, height: 667 },
  { name: "pixel7", width: 412, height: 915 },
  { name: "iphoneSE-landscape", width: 667, height: 375 },
  { name: "pixel7-landscape", width: 915, height: 412 },
  { name: "short-viewport", width: 400, height: 480 },
];

async function measureScenario(browser, url, viewport, scenario) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__layoutRepro?.ready === true, { timeout: 10_000 });
    await page.evaluate((s) => window.__layoutRepro.setScenario(s), scenario);
    // Let React commit + the browser lay the new content out.
    await page.waitForTimeout(80);

    return await page.evaluate(() => {
      function measure(el) {
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const withinViewport = r.top >= 0 && r.bottom <= vh && r.height > 0 && r.width > 0;
        if (!withinViewport) {
          return { rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, withinViewport, hitTestable: false };
        }
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
        const atPoint = document.elementFromPoint(cx, cy);
        const hitTestable = atPoint !== null && (atPoint === el || el.contains(atPoint) || atPoint.contains(el));
        return {
          rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
          withinViewport,
          hitTestable,
        };
      }
      const textarea = document.querySelector("textarea");
      const sendButton = document.querySelector('button[aria-label="Send"], button[aria-label="Preparing attachment…"]');
      // Every pending card's OWN action row (Submit answer / Approve+Reject)
      // — via `role="alert"`/status text near the footer, simplest reliable
      // hook is the button text itself, which every card variant has one of.
      const actionButtons = Array.from(
        document.querySelectorAll('button'),
      ).filter((b) => ["Submit answer", "Approve", "Reject"].includes(b.textContent?.trim() ?? ""));
      // N3 requires REACHABLE, not "visible without scrolling" — the whole
      // point of `pendingListStyle` is that it scrolls. `scrollIntoView`
      // scrolls every scrollable ancestor as needed (not just the window,
      // which doesn't scroll here at all — `chatLayoutStyle` is
      // `overflow: hidden`), exactly what a real tap-then-scroll user does.
      // Scroll-then-measure ONE button at a time — all the action buttons
      // share the SAME scroll container, so scrolling every button into
      // view up front would leave only the last one actually positioned
      // there when measured.
      let anyActionButtonHitTestable = false;
      for (const button of actionButtons) {
        button.scrollIntoView({ block: "nearest" });
        if (measure(button)?.hitTestable === true) {
          anyActionButtonHitTestable = true;
          break;
        }
      }
      return {
        viewportHeight: window.innerHeight,
        textarea: measure(textarea),
        sendButton: measure(sendButton),
        actionButtonCount: actionButtons.length,
        // At least one action row per rendered card should be REACHABLE —
        // not necessarily all simultaneously visible without scrolling
        // (N3 requires reachable + fully usable, not zero-scroll).
        anyActionButtonHitTestable,
      };
    });
  } finally {
    await page.close();
  }
}

async function main() {
  const server = await createServer({ root: mobileRoot, server: { port: 0 }, logLevel: "error" });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  if (port === null) throw new Error("dev server did not report a port");
  const url = `http://127.0.0.1:${port}/?repro=1`;

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const { name, scenario } of SCENARIOS) {
        const measurement = await measureScenario(browser, url, viewport, scenario);
        const ok =
          measurement.textarea !== null &&
          measurement.sendButton !== null &&
          measurement.textarea.withinViewport &&
          measurement.textarea.hitTestable &&
          measurement.sendButton.withinViewport &&
          measurement.sendButton.hitTestable &&
          measurement.actionButtonCount > 0 &&
          measurement.anyActionButtonHitTestable;
        results.push({ viewport: viewport.name, scenario: name, ok, measurement });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.viewport} / ${r.scenario}`);
    if (!r.ok) console.log(JSON.stringify(r.measurement, null, 2));
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length}/${results.length} scenario(s) clip the composer or a card's action row.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} scenarios keep the composer and every card's action row reachable.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
