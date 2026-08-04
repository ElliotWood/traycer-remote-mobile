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

// ── M6 item 1: the Review-all jump rail ──────────────────────────────────────
//
// Twelve DEEP paths under ONE common root — the shape the rail is worst at and
// the shape a real changeset actually has. `direction: rtl` on the chip keeps
// the TAIL, which is where paths under a common root differ.
//
// Reached through the whole product chain, not by rendering `ReviewAllSheet`
// directly: the changes arrive on a schema-validated snapshot, through the real
// `useChat` reducer, into `LowerDock`'s chip, the panel, and only then the
// sheet. A component-only harness would skip the wire→props hop and the panel's
// own control.
const REVIEW_ROOT = "packages/host-runtime/src/agent/gui/handlers/subscribe";
const REVIEW_PATHS = [
  `${REVIEW_ROOT}/accumulated-changes/collect-file-changes.ts`,
  `${REVIEW_ROOT}/accumulated-changes/compute-line-delta.ts`,
  `${REVIEW_ROOT}/accumulated-changes/prune-ack-index.ts`,
  `${REVIEW_ROOT}/accumulated-changes/revert-single-file.ts`,
  `${REVIEW_ROOT}/accumulated-changes/revert-all-files.ts`,
  `${REVIEW_ROOT}/frames/encode-snapshot-frame.ts`,
  `${REVIEW_ROOT}/frames/encode-block-delta-frame.ts`,
  `${REVIEW_ROOT}/frames/decode-client-action-frame.ts`,
  `${REVIEW_ROOT}/sessions/open-chat-session.ts`,
  `${REVIEW_ROOT}/sessions/close-chat-session.ts`,
  `${REVIEW_ROOT}/sessions/reconcile-session-state.ts`,
  `${REVIEW_ROOT}/sessions/track-pending-approvals.ts`,
];

// A real 414px-wide device (iPhone XR/11/Plus class), which is the width the
// item was specified at.
const REVIEW_VIEWPORT = { name: "iphone414", width: 414, height: 896 };

/** Waits for a smooth scroll to stop moving, and returns where it stopped. */
async function settleScroll(page) {
  let last = null;
  for (let i = 0; i < 60; i += 1) {
    const now = await page.evaluate(() => {
      const first = document.querySelector("[data-review-path]");
      return first === null ? null : first.parentElement.scrollTop;
    });
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(50);
  }
  return last;
}

async function measureReviewAll(browser, url) {
  const page = await browser.newPage({
    viewport: { width: REVIEW_VIEWPORT.width, height: REVIEW_VIEWPORT.height },
  });
  const checks = [];
  const notCovered = [];
  const record = (ok, name, detail) => checks.push({ ok, name, detail });

  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__layoutRepro?.ready === true, { timeout: 10_000 });
    await page.evaluate((paths) => window.__layoutRepro.setScenario({ fileChanges: paths }), REVIEW_PATHS);
    await page.waitForTimeout(120);

    // Open the lower dock, then the sheet. Both are real taps on the real
    // controls — "the panel never reaches the sheet" is a failure this must be
    // able to see, so neither is bypassed.
    await page.locator("button").filter({ hasText: `${REVIEW_PATHS.length} files ±` }).first().click();
    await page.getByRole("button", { name: "Review all" }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Review all changes"]', { timeout: 5_000 });

    // ── 1. The rail OVERFLOWS at twelve chips ────────────────────────────────
    const rail = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Jump to file"]');
      if (nav === null) return null;
      const chips = Array.from(nav.querySelectorAll("[data-jump-path]"));
      const navRect = nav.getBoundingClientRect();
      const last = chips[chips.length - 1];
      const lastRect = last === undefined ? null : last.getBoundingClientRect();
      return {
        chipCount: chips.length,
        scrollWidth: nav.scrollWidth,
        clientWidth: nav.clientWidth,
        scrollLeft: nav.scrollLeft,
        lastChipFullyVisible:
          lastRect !== null && lastRect.left >= navRect.left - 0.5 && lastRect.right <= navRect.right + 0.5,
      };
    });
    if (rail === null) {
      record(false, "the jump rail exists", "nav[aria-label='Jump to file'] not found");
      return { checks, notCovered };
    }
    record(rail.chipCount === REVIEW_PATHS.length, "one jump chip per changed file", `${rail.chipCount} chip(s)`);
    record(
      rail.scrollWidth > rail.clientWidth,
      "the rail OVERFLOWS at twelve deep paths (scrollWidth > clientWidth)",
      `scrollWidth ${rail.scrollWidth} vs clientWidth ${rail.clientWidth} at ${REVIEW_VIEWPORT.width}px`,
    );
    // The pre-state that makes the next check mean something: if the twelfth
    // chip were already on screen, "reachable by scrolling" would be satisfied
    // without any scrolling happening.
    record(
      rail.lastChipFullyVisible === false,
      "the twelfth chip is NOT already on screen (so reaching it requires scrolling)",
      `lastChipFullyVisible=${String(rail.lastChipFullyVisible)}`,
    );

    // ── 2. The twelfth chip is reachable BY A REAL GESTURE ───────────────────
    //
    // `nav.scrollLeft = …` would be a check that cannot fail for the mutation
    // this exists to catch: a box with `overflowX: hidden` is still
    // PROGRAMMATICALLY scrollable, so setting scrollLeft passes against exactly
    // the regression in question. A wheel gesture does not.
    const navBox = await page.locator('nav[aria-label="Jump to file"]').boundingBox();
    await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2);
    await page.mouse.wheel(3000, 0);
    await page.waitForTimeout(250);

    const afterScroll = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Jump to file"]');
      const chips = Array.from(nav.querySelectorAll("[data-jump-path]"));
      const navRect = nav.getBoundingClientRect();
      const last = chips[chips.length - 1];
      const r = last.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const at = document.elementFromPoint(cx, cy);
      return {
        scrollLeft: nav.scrollLeft,
        fullyVisible: r.left >= navRect.left - 0.5 && r.right <= navRect.right + 0.5,
        hitTestable: at !== null && (at === last || last.contains(at)),
        label: last.getAttribute("data-jump-path"),
      };
    });
    record(afterScroll.scrollLeft > 0, "a wheel gesture actually scrolls the rail", `scrollLeft ${afterScroll.scrollLeft}`);
    record(
      afterScroll.fullyVisible && afterScroll.hitTestable,
      "the twelfth chip is reachable by scrolling, and tappable once there",
      `fullyVisible=${String(afterScroll.fullyVisible)} hitTestable=${String(afterScroll.hitTestable)}`,
    );

    // ── 3. Tapping chip N lands section N in the scroll viewport ─────────────
    let landed = 0;
    let neededTheJump = 0;
    const jumpFailures = [];
    for (let n = 0; n < REVIEW_PATHS.length; n += 1) {
      // Reset to the top so each chip is measured from the same place.
      await page.evaluate(() => {
        document.querySelector("[data-review-path]").parentElement.scrollTop = 0;
      });
      await page.waitForTimeout(60);
      const pre = await page.evaluate((i) => {
        const sections = Array.from(document.querySelectorAll("[data-review-path]"));
        const el = sections[i];
        const box = el.parentElement;
        const br = box.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { anyPartInView: r.bottom > br.top && r.top < br.bottom };
      }, n);

      await page.locator("[data-jump-path]").nth(n).click();
      await settleScroll(page);

      const post = await page.evaluate((i) => {
        const sections = Array.from(document.querySelectorAll("[data-review-path]"));
        const el = sections[i];
        const box = el.parentElement;
        const br = box.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return {
          // The section's own START is on screen — "you landed on it", which is
          // stronger than merely intersecting the viewport.
          topInView: r.top >= br.top - 2 && r.top <= br.bottom - 1,
          sectionPath: el.getAttribute("data-review-path"),
        };
      }, n);
      const chipPath = await page.locator("[data-jump-path]").nth(n).getAttribute("data-jump-path");

      if (pre.anyPartInView === false) neededTheJump += 1;
      // Identity as well as position: a rail keyed by the DISPLAYED label would
      // scroll to the wrong section and look entirely correct doing it.
      if (post.topInView && post.sectionPath === chipPath) landed += 1;
      else jumpFailures.push({ n, chipPath, ...post });
    }
    record(
      landed === REVIEW_PATHS.length,
      "tapping chip N brings section N's start into the scroll viewport",
      `${landed}/${REVIEW_PATHS.length} landed${jumpFailures.length > 0 ? ` — ${JSON.stringify(jumpFailures)}` : ""}`,
    );
    // Stated separately rather than folded into the check above: the ones that
    // were ALREADY in view cannot distinguish a working jump-list from a
    // no-op, so the discriminating count is reported on its own.
    record(
      neededTheJump > 0,
      "the measurement discriminates: some sections were off-screen before the tap",
      `${neededTheJump}/${REVIEW_PATHS.length} required the jump; the other ${REVIEW_PATHS.length - neededTheJump} were already in view and prove nothing`,
    );

    notCovered.push(
      "left-truncation of a chip's label: `direction: rtl` + `bdi` is unit-tested, and at 414px these paths do overflow the 180px chip — but WHICH end is elided is not asserted here.",
    );
    notCovered.push(
      "one viewport only (414x896). Narrower phones are not measured by this pass.",
    );
    return { checks, notCovered };
  } finally {
    await page.close();
  }
}

// ── M3: caret restoration after a mention/slash-command PICK ────────────────
//
// `composer.tsx`'s `spliceToken` defers `node.setSelectionRange(...)` to the
// next animation frame, because React controls the textarea's `value` but
// never its `selectionStart` — without the defer, the comment at the call
// site says the caret jumps to the end of the text and the on-screen
// keyboard dismisses. jsdom cannot evaluate this at all (no real
// focus/selection model), so this drives the fixture through a real
// Chromium and reads `selectionStart`/`selectionEnd` off the ACTUAL DOM
// node, never off React state.
//
// The fixture types the trigger with TRAILING content after it ("/pon needs
// review", not "/pon"), then walks the caret back into the token with real
// ArrowLeft presses before picking. That is deliberate: if the trigger sat
// at the end of the draft, "caret lands at the token boundary" and "caret
// jumps to the end" would read the same number, and the check could not
// tell working code from the exact defect it exists to catch.
const CARET_ROOT = "/repro/workspace";

/** Where `applyTrigger` (composer-trigger.ts) puts the caret when the trigger starts at index 0. */
function expectedCaretAfterPick(token) {
  return token.length + 1; // the token plus the trailing space `applyTrigger` always inserts
}

async function measureCaretAfterPick(browser, url) {
  const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
  const checks = [];
  const notCovered = [];
  const record = (ok, name, detail) => checks.push({ ok, name, detail });

  const readCaret = () =>
    page.evaluate(() => {
      const el = document.querySelector("textarea");
      return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    });

  /** Types `typed`, walks the caret back to `caretIndex` with real key presses, and returns the pre-pick DOM state. */
  const typeAndPosition = async (typed, caretIndex) => {
    const textarea = page.locator("textarea");
    await textarea.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await textarea.pressSequentially(typed);
    for (let i = 0; i < typed.length - caretIndex; i += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    return readCaret();
  };

  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__layoutRepro?.ready === true, { timeout: 10_000 });

    // ── Case 1: `/` — picking a slash command ────────────────────────────
    await page.evaluate(() => window.__layoutRepro.setScenario({}));
    await page.waitForTimeout(80);

    const slashTyped = "/pon needs review";
    const slashCaretIndex = 4; // right after "/pon", before the space
    const preSlash = await typeAndPosition(slashTyped, slashCaretIndex);
    record(
      preSlash.start === slashCaretIndex && preSlash.end === slashCaretIndex,
      "slash: the caret actually sits INSIDE the token before picking",
      `selectionStart=${preSlash.start} (expected ${slashCaretIndex}) — the precondition that makes the next two checks mean something`,
    );

    // Three commands share the `ponytail-` prefix (see FAKE_COMMANDS in
    // layout-repro-view.tsx) specifically so this exact-text pick cannot
    // succeed by being the only row on offer.
    await page.getByText("/ponytail-help", { exact: true }).click();
    await page.waitForTimeout(150); // longer than one animation frame

    const postSlash = await readCaret();
    const slashToken = "/ponytail-help";
    const expectedSlashCaret = expectedCaretAfterPick(slashToken);
    const expectedSlashValue = `${slashToken} ${slashTyped.slice(slashCaretIndex)}`;
    record(
      postSlash.value === expectedSlashValue,
      "slash: the token and trailing text are spliced correctly",
      `value=${JSON.stringify(postSlash.value)} expected=${JSON.stringify(expectedSlashValue)}`,
    );
    record(
      postSlash.start === expectedSlashCaret && postSlash.end === expectedSlashCaret,
      "slash: the caret lands at the TOKEN BOUNDARY, not at the string's end",
      `start=${postSlash.start} end=${postSlash.end} expected=${expectedSlashCaret} (value.length=${postSlash.value.length}) — a caret stuck at value.length is exactly the "jumps to the end" defect the deferral exists to prevent`,
    );

    // ── Case 2: `@` — picking a file mention ─────────────────────────────
    // Needs a BOUND chat: `@` hides itself entirely with no roots.
    await page.evaluate((root) => window.__layoutRepro.setScenario({ boundRoot: root }), CARET_ROOT);
    await page.waitForTimeout(80);

    const mentionTyped = "@app needs review";
    const mentionCaretIndex = 4; // right after "@app"
    const preMention = await typeAndPosition(mentionTyped, mentionCaretIndex);
    record(
      preMention.start === mentionCaretIndex && preMention.end === mentionCaretIndex,
      "mention: the caret actually sits INSIDE the token before picking",
      `selectionStart=${preMention.start} (expected ${mentionCaretIndex})`,
    );

    // Two files (`app.ts`, `util.ts`) for the same reason as the three
    // commands above — `app.ts` is not the only row the sheet can offer.
    await page.locator("button").filter({ hasText: "app.ts" }).first().click();
    await page.waitForTimeout(150);

    const postMention = await readCaret();
    const mentionToken = "@src/app.ts"; // primary root → bare relPath, per mention-model.ts
    const expectedMentionCaret = expectedCaretAfterPick(mentionToken);
    const expectedMentionValue = `${mentionToken} ${mentionTyped.slice(mentionCaretIndex)}`;
    record(
      postMention.value === expectedMentionValue,
      "mention: the token and trailing text are spliced correctly",
      `value=${JSON.stringify(postMention.value)} expected=${JSON.stringify(expectedMentionValue)}`,
    );
    record(
      postMention.start === expectedMentionCaret && postMention.end === expectedMentionCaret,
      "mention: the caret lands at the TOKEN BOUNDARY, not at the string's end",
      `start=${postMention.start} end=${postMention.end} expected=${expectedMentionCaret} (value.length=${postMention.value.length})`,
    );

    notCovered.push(
      "IME composition sequencing around the new onSelect handler, and caret survival across the composer's snapshot-arrival re-render — both named by H12 as real but secondary to the caret-after-pick mechanism measured here.",
    );
    notCovered.push(
      "CDP-synthesized keystrokes, not a real on-screen mobile keyboard/IME — this measures the deferred setSelectionRange mechanism, not physical-device input.",
    );
    return { checks, notCovered };
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
  let review = null;
  let caret = null;
  try {
    review = await measureReviewAll(browser, url);
    caret = await measureCaretAfterPick(browser, url);
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

  console.log(`\n── Review-all jump rail (${REVIEW_VIEWPORT.width}x${REVIEW_VIEWPORT.height}, ${REVIEW_PATHS.length} deep paths) ──`);
  for (const c of review.checks) {
    console.log(`[${c.ok ? "PASS" : "FAIL"}] ${c.name}\n         ${c.detail}`);
  }
  // Printed SEPARATELY from the passes: a check whose expected value is the
  // literal `true` is a log line wearing a PASS, and a harness that can leave
  // something unmeasured while printing a clean total is lying by omission.
  for (const n of review.notCovered) console.log(`[NOT COVERED] ${n}`);

  console.log(`\n── Caret restoration after a mention/slash-command pick ──`);
  for (const c of caret.checks) {
    console.log(`[${c.ok ? "PASS" : "FAIL"}] ${c.name}\n         ${c.detail}`);
  }
  for (const n of caret.notCovered) console.log(`[NOT COVERED] ${n}`);

  const failures = results.filter((r) => !r.ok);
  const reviewFailures = review.checks.filter((c) => !c.ok);
  const caretFailures = caret.checks.filter((c) => !c.ok);
  if (failures.length > 0 || reviewFailures.length > 0 || caretFailures.length > 0) {
    if (failures.length > 0) {
      console.error(`\n${failures.length}/${results.length} scenario(s) clip the composer or a card's action row.`);
    }
    if (reviewFailures.length > 0) {
      console.error(`${reviewFailures.length}/${review.checks.length} Review-all rail check(s) failed.`);
    }
    if (caretFailures.length > 0) {
      console.error(`${caretFailures.length}/${caret.checks.length} caret-restoration check(s) failed.`);
    }
    process.exit(1);
  }
  console.log(
    `\nAll ${results.length} scenarios keep the composer and every card's action row reachable, all ${review.checks.length} Review-all rail checks pass, and all ${caret.checks.length} caret-restoration checks pass.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
