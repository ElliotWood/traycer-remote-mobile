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
      "Caret survival across the composer's snapshot-arrival re-render — named by H12 as real but secondary to the caret-after-pick mechanism measured here, and not yet attempted by anyone. IME composition sequencing (H12's other runner-up) is now measured separately below.",
    );
    notCovered.push(
      "CDP-synthesized keystrokes, not a real on-screen mobile keyboard/IME — this measures the deferred setSelectionRange mechanism, not physical-device input.",
    );
    return { checks, notCovered };
  } finally {
    await page.close();
  }
}

/**
 * IME composition sequencing. Measured against real Chromium's own
 * composition pipeline via CDP `Input.imeSetComposition` / `Input.insertText`
 * — the browser-process-to-renderer route a real platform IME's updates
 * travel through — NOT `element.dispatchEvent(new CompositionEvent(...))`,
 * which is observable to listeners but does not drive the renderer's actual
 * text-insertion path and would prove nothing about real browser behaviour.
 * Confirmed directly (`tmp/probe-ime-composition.mjs`, not committed): a
 * plain `input`-driven `onChange` fires once per composition update, each
 * carrying the intermediate, pre-commit buffer, with `isComposing: true`.
 *
 * Two things are asserted, and they are different claims:
 * 1. The command/mention sheet must not react — open/filter/reopen — to any
 *    intermediate composition state. Read off the RENDERED sheet contents at
 *    every step, not just the final one.
 * 2. `workspace.mentionFiles` must not be asked once per composition step.
 *    The sheet staying visually frozen is necessary but not sufficient — a
 *    guard that froze only the rendered list while still letting the query
 *    effect's dependency change underneath would still hammer the host. This
 *    is why the RPC count (`window.__layoutRepro.mentionFilesCallCount()`) is
 *    asserted directly rather than inferred from the DOM.
 *
 * `useMentionFiles`'s query effect is debounced 250ms; composition steps here
 * are spaced 300ms apart specifically so an UNFROZEN implementation would
 * fire one real request per step rather than having the debounce coincidentally
 * collapse them — the check must fail for the right reason if the guard is
 * removed, not pass by accident of timing.
 */
async function measureImeComposition(browser, url) {
  const checks = [];
  const notCovered = [];
  const record = (ok, name, detail) => checks.push({ ok, name, detail });

  // Two independent pages, one per trigger kind — NOT one page reused across
  // both. `dismissedAt` (composer.tsx) is keyed by TRIGGER START POSITION
  // alone, not by kind or session: dismissing case 1's sheet with `Escape`
  // sets `dismissedAt = 0` (the `/` sat at index 0), and case 2's `@` — also
  // typed into an emptied draft, also landing at index 0 — collided with
  // that stale value and stayed permanently suppressed. Found by running
  // this, not reasoned in advance; separate pages remove the collision
  // structurally instead of working around it with careful positioning.
  const slashPage = await browser.newPage({ viewport: { width: 414, height: 896 } });
  const mentionPage = await browser.newPage({ viewport: { width: 414, height: 896 } });

  const readState = (page) =>
    page.evaluate(() => {
      const el = document.querySelector("textarea");
      const buttons = Array.from(document.querySelectorAll("button")).map((b) => b.textContent ?? "");
      return { value: el.value, buttons };
    });

  const mentionFilesCallCount = (page) => page.evaluate(() => window.__layoutRepro.mentionFilesCallCount());

  try {
    // ── Case 1: `/` — composing a query that WOULD filter the catalogue if it leaked ──
    const page = slashPage;
    await page.goto(url);
    await page.waitForFunction(() => window.__layoutRepro?.ready === true, { timeout: 10_000 });
    const client = await page.context().newCDPSession(page);

    // Three commands (ponytail-help, ponytail-review, ponytail-gain) share
    // the "ponytail" prefix but diverge after it, so "h"/"he"/"hel" already
    // discriminates: an unfrozen trigger narrows to ponytail-help alone at
    // the FIRST composition step, which is exactly the failure this catches.
    await page.evaluate(() => window.__layoutRepro.setScenario({}));
    await page.waitForTimeout(80);

    const textarea = page.locator("textarea");
    await textarea.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type("/"); // literal keystroke, real keydown — the trigger char itself is never composed
    await page.waitForTimeout(80);

    const preCompose = await readState(page);
    const hasAllThree = (buttons) =>
      buttons.some((t) => t.includes("ponytail-help")) &&
      buttons.some((t) => t.includes("ponytail-review")) &&
      buttons.some((t) => t.includes("ponytail-gain"));
    record(
      hasAllThree(preCompose.buttons),
      "slash: the sheet opens on the literal `/` showing the unfiltered catalogue",
      `buttons=${JSON.stringify(preCompose.buttons.filter((t) => t.startsWith("/ponytail")))} — precondition for the freeze checks below`,
    );

    for (const step of ["h", "he", "hel"]) {
      await client.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
      await page.waitForTimeout(300); // > the 250ms query debounce, deliberately
      const mid = await readState(page);
      record(
        hasAllThree(mid.buttons),
        `slash: the sheet still shows the unfiltered catalogue during composition ("${step}")`,
        `value=${JSON.stringify(mid.value)} buttons=${JSON.stringify(mid.buttons.filter((t) => t.startsWith("/ponytail")))}`,
      );
    }

    await client.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    await client.send("Input.insertText", { text: "help" });
    await page.waitForTimeout(150);

    const postCommit = await readState(page);
    const onlyHelp =
      postCommit.buttons.some((t) => t.includes("ponytail-help")) &&
      !postCommit.buttons.some((t) => t.includes("ponytail-review")) &&
      !postCommit.buttons.some((t) => t.includes("ponytail-gain"));
    record(
      onlyHelp,
      "slash: AFTER commit, the sheet filters to the final composed query and only the final one",
      `value=${JSON.stringify(postCommit.value)} buttons=${JSON.stringify(postCommit.buttons.filter((t) => t.startsWith("/ponytail")))} — proves the freeze isn't just permanent (a check that never unfroze would pass the checks above for the wrong reason)`,
    );

    // ── Case 2: `@` — the RPC count is the real harm, not just the sheet's look ──
    // Fresh page/mount (see the comment above) — no leftover `dismissedAt`,
    // no leftover draft.
    const mp = mentionPage;
    await mp.goto(url);
    await mp.waitForFunction(() => window.__layoutRepro?.ready === true, { timeout: 10_000 });
    const mentionClient = await mp.context().newCDPSession(mp);
    await mp.evaluate((root) => window.__layoutRepro.setScenario({ boundRoot: root }), CARET_ROOT);
    await mp.waitForTimeout(80);

    const mentionTextarea = mp.locator("textarea");
    await mentionTextarea.click();
    await mp.keyboard.type("@");
    // Typing "@" starts TWO async things on two different clocks (per
    // `use-mention-files.ts`): an immediate per-root canary, and a
    // 250ms-debounced query for query="" — both real, both legitimate, both
    // must be SETTLED before baselining, or the empty-query request landing
    // mid-composition-wait reads as a false "reacted to composition".
    await mp.waitForTimeout(500);

    const baselineCalls = await mentionFilesCallCount(mp);

    for (const step of ["a", "ap", "app"]) {
      await mentionClient.send("Input.imeSetComposition", { text: step, selectionStart: step.length, selectionEnd: step.length });
      await mp.waitForTimeout(300); // > the 250ms debounce — an unfrozen query would fire here
    }

    const duringComposeCalls = await mentionFilesCallCount(mp);
    record(
      duringComposeCalls === baselineCalls,
      "mention: workspace.mentionFiles is NOT re-asked for any intermediate composition state",
      `baseline=${baselineCalls} afterComposing=${duringComposeCalls} — canary + empty-query already settled before baselining; this asserts nothing ELSE fired while composing`,
    );

    await mentionClient.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    await mentionClient.send("Input.insertText", { text: "app" });
    await mp.waitForTimeout(400); // > debounce, so the post-commit query has actually resolved

    const afterCommitCalls = await mentionFilesCallCount(mp);
    const afterCommit = await readState(mp);
    record(
      afterCommitCalls === baselineCalls + 1,
      "mention: exactly ONE new request fires, for the committed query, after compositionend",
      `baseline=${baselineCalls} afterCommit=${afterCommitCalls} — proves the freeze releases rather than permanently suppressing the RPC`,
    );
    record(
      afterCommit.buttons.some((t) => t.includes("app.ts")) && !afterCommit.buttons.some((t) => t.includes("util.ts")),
      "mention: the committed query's results are the right, filtered ones",
      `buttons=${JSON.stringify(afterCommit.buttons.filter((t) => t.includes(".ts")))}`,
    );

    notCovered.push(
      "CDP-synthesized composition, not a real on-screen mobile keyboard/IME — this measures Chromium's own composition-event pipeline (compositionstart/update/end, isComposing), which is what the fix reads; it does not speak to a physical device's IME quirks.",
    );
    return { checks, notCovered };
  } finally {
    await slashPage.close();
    await mentionPage.close();
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
  let ime = null;
  try {
    review = await measureReviewAll(browser, url);
    caret = await measureCaretAfterPick(browser, url);
    ime = await measureImeComposition(browser, url);
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

  console.log(`\n── IME composition sequencing ──`);
  for (const c of ime.checks) {
    console.log(`[${c.ok ? "PASS" : "FAIL"}] ${c.name}\n         ${c.detail}`);
  }
  for (const n of ime.notCovered) console.log(`[NOT COVERED] ${n}`);

  const failures = results.filter((r) => !r.ok);
  const reviewFailures = review.checks.filter((c) => !c.ok);
  const caretFailures = caret.checks.filter((c) => !c.ok);
  const imeFailures = ime.checks.filter((c) => !c.ok);
  if (failures.length > 0 || reviewFailures.length > 0 || caretFailures.length > 0 || imeFailures.length > 0) {
    if (failures.length > 0) {
      console.error(`\n${failures.length}/${results.length} scenario(s) clip the composer or a card's action row.`);
    }
    if (reviewFailures.length > 0) {
      console.error(`${reviewFailures.length}/${review.checks.length} Review-all rail check(s) failed.`);
    }
    if (caretFailures.length > 0) {
      console.error(`${caretFailures.length}/${caret.checks.length} caret-restoration check(s) failed.`);
    }
    if (imeFailures.length > 0) {
      console.error(`${imeFailures.length}/${ime.checks.length} IME-composition check(s) failed.`);
    }
    process.exit(1);
  }
  console.log(
    `\nAll ${results.length} scenarios keep the composer and every card's action row reachable, all ${review.checks.length} Review-all rail checks pass, all ${caret.checks.length} caret-restoration checks pass, and all ${ime.checks.length} IME-composition checks pass.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
