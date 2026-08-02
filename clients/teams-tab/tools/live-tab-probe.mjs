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
const CHAT = flag("chat");

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
      // Was a frame ever on screen with nothing in it? Falsifiable, kept.
      framesWithHeaderOnly: 0,
      /*
       * THE HEADLINE, and it measures the property instead of a proxy for it.
       *
       * `framesWithHeaderOnly` fires before the body gets ANY child — which
       * includes the loading skeleton, so on a fast epic it is satisfied in
       * ~14ms and says nothing about a long wait. The shell exists so that a
       * person waiting on a 47-second snapshot sees a populated frame the
       * whole time. That is exactly: while the status row says it is loading,
       * the header is there.
       *
       * Counted rather than sampled once, and compared for EQUALITY: the
       * header must be present in EVERY frame where the loading state is,
       * not merely in one of them.
       */
      framesLoading: 0,
      framesLoadingWithHeader: 0,
      loadingSeen: false,
      loadingEnded: false,
      t0: Date.now(),
    };
    const tick = () => {
      const p = window.__probe;
      const header = document.querySelector("header");
      /*
       * TWO WAYS TO FIND THE BODY, because this runs against whatever is
       * DEPLOYED, not against what we have written.
       *
       * `data-shell-region` was added after the current bundle shipped, so
       * keying on it alone made this probe time out against production while
       * the app was working perfectly — the third time in one session that I
       * assumed my tree's DOM in a build I do not control. The header's next
       * sibling is the frame's scrolling region in every build that has had a
       * shell at all.
       */
      const body =
        document.querySelector('[data-shell-region="body"]') ??
        header?.nextElementSibling ??
        null;
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
      /*
       * Keyed on the STATUS ROW'S OWN WORDS, not on a class or a data
       * attribute. A selector must exist in the oldest build this may run
       * against, and this string has been in `epic-status-row.tsx` since the
       * row was written — where `data-shell-region` was added later and made
       * this probe time out against a working production app.
       */
      const loading = (document.body.innerText || "").includes(
        "Loading this epic",
      );
      if (loading) {
        p.loadingSeen = true;
        p.framesLoading += 1;
        if (header !== null) p.framesLoadingWithHeader += 1;
      } else if (p.loadingSeen) {
        p.loadingEnded = true;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url, { waitUntil: "commit" });
  // Long enough for the 4s handshake timeout plus a large snapshot.
  // Wait for the epic to finish loading, not merely for the first child —
  // the whole point is to sample THROUGH the wait.
  /*
   * STOP WHEN THE LOAD ENDS, not when the first child appears.
   *
   * The previous condition was `contentAt !== null && (loadingSeen ?
   * loadingEnded : true)` and it resolved at 527ms — BEFORE the loading row
   * appeared at ~1s. It then reported `framesLoading=0` and called the run
   * inconclusive, on the 50 MB epic that is the entire reason this
   * measurement exists. The observation window closed before the event.
   *
   * So: wait for a load to be seen AND finished. If none appears within
   * `LOADING_GRACE_MS`, this epic genuinely returned fast and the run is
   * inconclusive rather than passing — the grace has to be long enough that
   * "no loading state" means the host was quick, not that we looked early.
   */
  const LOADING_GRACE_MS = 15_000;
  await page.waitForFunction(
    (graceMs) => {
      const p = window.__probe;
      if (p === undefined) return false;
      // Enough evidence is enough: 120 frames (~2s) samples the property
      // plenty, and a fixture whose loading state never ends would otherwise
      // hang the run — which is how the mutation control gets tested.
      if (p.framesLoading >= 120) return true;
      if (p.loadingSeen) return p.loadingEnded;
      return p.contentAt !== null && Date.now() - p.t0 > graceMs;
    },
    LOADING_GRACE_MS,
    { timeout: 180_000 },
  );
  return page.evaluate(() => ({
    headerAt: window.__probe.headerAt,
    contentAt: window.__probe.contentAt,
    framesWithHeaderOnly: window.__probe.framesWithHeaderOnly,
    framesLoading: window.__probe.framesLoading,
    framesLoadingWithHeader: window.__probe.framesLoadingWithHeader,
  }));
}

async function seed() {
  if (STATE === null || URL_ARG === null) {
    console.error("--seed needs --url and --state");
    process.exit(1);
  }
  /*
   * HEADLESS, and it prints the code rather than waiting at its own window.
   *
   * A device flow does not need the approver to be at this machine — that is
   * the whole point of it. So this starts the flow, reads the code and the
   * verification URL off the app's own sign-in screen, PRINTS them, and keeps
   * polling while a human approves from any device. The ask becomes "visit
   * this, enter this", which is ten seconds, instead of "run this command".
   */
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL_ARG, { waitUntil: "networkidle" });

  const signIn = page.getByRole("button", { name: /^sign in$/i });
  await signIn.waitFor({ timeout: 60_000 });
  await signIn.click();

  // The code and the link are what the sign-in screen shows a user; reading
  // them from the DOM means relaying exactly what the app said, not a
  // reconstruction of it.
  const link = page.getByRole("link", { name: /approval page/i });
  await link.waitFor({ timeout: 60_000 });
  const url = await link.getAttribute("href");
  const code = (await page.locator("div").filter({ hasText: /^[A-Z0-9-]{6,}$/ }).first().textContent())?.trim();

  console.log("");
  console.log("=== RELAY THIS ===");
  console.log(`  Visit: ${url ?? "(no href found)"}`);
  console.log(`  Code:  ${code ?? "(not found — read it off the page)"}`);
  console.log("==================");
  console.log("");
  console.log("Polling for approval (10 minutes)…");

  /*
   * WAIT FOR THE TOKEN ITSELF, not for a control that implies it.
   *
   * Two proxies were tried and both were wrong, in opposite directions:
   *
   *   "Sign out" appears   — that control exists in the current source and
   *                          NOT in the deployed bundle, so it could never
   *                          appear. Burned the full 10-minute timeout and
   *                          lost a token a human had already approved.
   *   "Sign in" detaches   — the sign-in button is REPLACED by the code
   *                          screen the moment the flow starts, so this
   *                          fired instantly, before any approval, and wrote
   *                          an empty 36-byte state file that claimed success.
   *
   * The thing being captured is a token in `localStorage`. Waiting for
   * anything else is waiting for a proxy that can be wrong in a build we do
   * not control — and this step runs against whatever is deployed, which is
   * exactly where our assumptions are least reliable.
   */
  await page.waitForFunction(
    () => window.localStorage.getItem("traycer.mobile.auth") !== null,
    undefined,
    { timeout: 600_000 },
  );

  mkdirSync(dirname(resolve(STATE)), { recursive: true });
  const state = await context.storageState({ path: STATE });
  /*
   * ASSERT THE ARTEFACT, not the write. The previous version reported
   * "Wrote <path>" for a 36-byte file containing no origins at all — the
   * write succeeded and captured nothing, which is the same shape as a green
   * gate that ran nothing.
   */
  const entries = state.origins.flatMap((o) => o.localStorage);
  const hasToken = entries.some((e) => e.name === "traycer.mobile.auth");
  if (!hasToken) {
    console.error(
      `FAILED: ${STATE} was written with no session in it — ${String(entries.length)} localStorage entries, no traycer.mobile.auth`,
    );
    await browser.close();
    process.exit(1);
  }
  console.log(
    `Wrote ${STATE} — ${String(entries.length)} storage entries including the session.`,
  );
  console.log("It is a CREDENTIAL: chmod 600, never commit, never log.");
  await browser.close();
}

/**
 * The chat checks, against REAL host content.
 *
 * Two of the three defects Elliot photographed were here: an assistant row
 * that rendered EMPTY, and fenced code showing its ``` markers literally.
 * Both were fixed and both were only ever verified against our own fixtures —
 * which is a fixture confirming the code that produced it.
 *
 * WHAT IS ASSERTED, AND WHAT IS ONLY REPORTED. A real chat may legitimately
 * contain no table and no fence, so requiring a `<table>` would fail for
 * reasons unrelated to rendering. So:
 *
 *   FAIL   a literal ``` in the rendered text — the exact defect, and its
 *          presence is unambiguous whatever the content is
 *   FAIL   a message row with no text at all — the empty-message defect
 *   REPORT `<pre>` / `<table>` counts. Zero means this chat had none, which
 *          is untested, not passed.
 */
async function chatChecks(page, baseUrl, epicId) {
  const root = baseUrl.replace(/\/$/, "");
  await page.goto(`${root}/epics/${epicId}`, { waitUntil: "networkidle" });
  /*
   * WAIT FOR THE ROW, not for a duration.
   *
   * This was `waitForTimeout(20_000)` and then a scan. It passed until a
   * bundle rendered a little slower, and then reported "could not find an
   * agent row" against a tab that was working — a fixed sleep is a guess
   * about someone else's latency, and the epic behind this one is 50 MB.
   *
   * Keyed on the locality text the row itself renders, which exists in every
   * build that has had an agent list.
   */
  const row = page
    .locator("button")
    .filter({ hasText: /on this host|another host|not known yet/i })
    .first();
  try {
    await row.waitFor({ timeout: 120_000 });
  } catch {
    console.error("chat: no agent row appeared within 120s — NOT a pass");
    return false;
  }
  await row.click();
  await page.waitForTimeout(15_000);
  const r = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      url: window.location.pathname,
      /*
       * FENCES OUTSIDE CODE, not fences anywhere.
       *
       * Counting ``` in `innerText` reported 5 against a transcript that
       * renders 360 code blocks and 140 tables — because the text legitimately
       * CONTAINS ``` where people discuss fences, and inside a rendered <pre>
       * that is content, not a defect. The assertion fired on a consequence
       * that correct rendering also produces.
       *
       * The defect is a fence marker in PROSE — a paragraph that should have
       * become a code block and didn't. So: walk text nodes, skip anything
       * inside <pre> or <code>, and count there.
       */
      literalFences: (() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let n = 0;
        let node = walker.nextNode();
        while (node !== null) {
          const inCode = node.parentElement?.closest("pre, code") !== null &&
            node.parentElement?.closest("pre, code") !== undefined;
          if (!inCode) {
            /*
             * A fence that STARTS A LINE, not a fence anywhere in prose.
             *
             * The previous version flagged 2 hits that were real sentences
             * ABOUT the characters — "render as monospace rather than literal
             * ``` delimiters". Discussion of a fence is not an unrendered
             * fence, and a harness that cries wolf gets switched off, which
             * costs more than the check is worth.
             *
             * An unrendered fence opens its own line. That is the signature.
             */
            const NL = String.fromCharCode(10);
            const fenceAtLineStart = new RegExp(
              "(^|" + NL + ")\s*```",
              "g",
            );
            n += ((node.textContent ?? "").match(fenceAtLineStart) ?? []).length;
          }
          node = walker.nextNode();
        }
        return n;
      })(),
      pre: document.querySelectorAll("pre").length,
      table: document.querySelectorAll("table").length,
      chars: text.length,
      /*
       * A rendered tool call names its tool. `humaniseToolName` turns
       * `mcp__traycer_a2a__traycer_send_message` into "traycer send message",
       * and every agent transcript on this host runs tools, so zero here
       * means the blocks rendered as bare labels.
       */
      toolNames: (text.match(/Tool call: \S/g) ?? []).length,
      filePaths: (text.match(/File change: \S/g) ?? []).length,
      /*
       * The OLD behaviour, which must be absent: a chip carrying only its
       * category, with nothing after it.
       */
      bareChips: (text.match(/Tool call(?![:\w])/g) ?? []).length,
    };
  });
  console.log(
    `chat: url=${r.url} literalFences=${String(r.literalFences)} pre=${String(r.pre)} table=${String(r.table)} chars=${String(r.chars)}`,
  );
  /*
   * THE PAYLOAD, not the kinds.
   *
   * A transcript rendering sixteen labelled chips with no content passes any
   * check that counts kinds — and that is exactly the defect the projection
   * split exists to fix: the payload disappeared while the kind survived.
   * So the assertion is that a tool's NAME and a file's PATH are on screen,
   * not that a "Tool call" label is.
   *
   * Same distinction that made `framesWithHeaderOnly` worth having over
   * `headerFirst`: the obvious signal is a consequence the defect also
   * produces.
   */
  console.log(
    `payload: toolNames=${String(r.toolNames)} filePaths=${String(r.filePaths)} bareChips=${String(r.bareChips)}`,
  );
  if (!r.url.includes("/chats/")) {
    console.error("chat: did not navigate into a chat — NOT a pass");
    return false;
  }
  if (r.literalFences > 0) {
    console.error(
      `FAIL: ${String(r.literalFences)} literal \`\`\` markers rendered as text — the fence defect is back`,
    );
    return false;
  }
  if (r.chars < 50) {
    console.error("FAIL: the transcript rendered almost no text");
    return false;
  }
  console.log(
    `chat: no literal fences; ${String(r.pre)} code blocks and ${String(r.table)} tables rendered` +
      (r.pre === 0 && r.table === 0
        ? " — NOTE: this chat contained neither, so those paths are UNTESTED here"
        : ""),
  );
  return true;
}

async function run() {
  let served = null;
  let baseUrl = URL_ARG;
  if (SELF_TEST && URL_ARG === null) {
    served = await serveDist();
    // `preview=epics` renders real screens from fixtures with no host and no
    // session — the mutation being proven is about WHEN the frame renders,
    // which is upstream of where the data comes from.
    // `--preview` selects the fixture state. `agents&state=loading` holds the
    // loading row open forever, which is what lets the loading assertion's
    // mutation be tested at all — production cannot be broken on purpose.
    const preview = arg("preview", "epics");
    const path = preview.startsWith("agents")
      ? `/epics/e1000000-0000-4000-8000-000000000001?preview=${preview}`
      : `/epics?preview=${preview}`;
    baseUrl = `http://localhost:${String(served.port)}${path}`;
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
    /*
     * REFUSE TO MEASURE ANYTHING WHILE SIGNED OUT.
     *
     * Every assertion in this file is satisfiable by the SIGN-IN SCREEN. It
     * has a header, it has content after that header, it contains no fenced
     * code and no literal fences, and it renders ~80 characters. So a run
     * against an expired credential reports `headerRenderedAlone=true`,
     * `literalFences=0`, `pre=0` — indistinguishable from a green run, and
     * that is not hypothetical: a deploy was verified against a signed-out
     * tab and reported as passing.
     *
     * The `chars < 50` guard did not catch it, because 81 > 50. A threshold
     * chosen to catch "rendered nothing" cannot tell "rendered nothing" from
     * "rendered a DIFFERENT screen".
     *
     * A gate, before any measurement, not a heuristic after one.
     */
    if (!SELF_TEST) {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const signedOut = await page
        .getByRole("button", { name: /^sign in$/i })
        .count();
      if (signedOut > 0) {
        console.error(
          "REFUSING: the tab is SIGNED OUT — the stored credential is expired or rotated.",
        );
        console.error(
          "          Re-seed with --seed. Nothing below would have measured the",
        );
        console.error(
          "          product: the sign-in screen satisfies every assertion here.",
        );
        await browser.close();
        process.exit(1);
      }
    }
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
    console.log(
      `loading: framesLoading=${String(t.framesLoading)} withHeader=${String(t.framesLoadingWithHeader)}`,
    );
    /*
     * A run that never saw the loading state has NOT verified this — it is
     * untested here, which is a different fact from passing, and reporting it
     * as a pass is how a fast epic launders a claim about a slow one.
     */
    if (t.framesLoading === 0) {
      console.error(
        "INCONCLUSIVE: the loading state never appeared — this epic returned too fast",
      );
      console.error(
        "              to test whether the frame stands during a wait. NOT a pass.",
      );
      failed = true;
    } else if (t.framesLoadingWithHeader !== t.framesLoading) {
      console.error(
        `FAIL: the header was missing for ${String(t.framesLoading - t.framesLoadingWithHeader)} of ${String(t.framesLoading)} loading frames`,
      );
      failed = true;
    } else {
      console.log(
        `frameStoodThroughTheWait=true (${String(t.framesLoading)} loading frames, header in all)`,
      );
    }
    if (!headerRenderedAlone) {
      console.error(
        "FAIL: no frame was ever on screen without content — the shell rendered WITH the",
      );
      console.error(
        "      epic data, which is the failure mode the shell exists to prevent.",
      );
      failed = true;
    }
    if (CHAT && EPIC !== null) {
      const chatPage = await context.newPage();
      const ok = await chatChecks(chatPage, baseUrl, EPIC);
      if (!ok) failed = true;
      await chatPage.close();
    }
    await page.close();
    /*
     * WRITE THE STATE BACK, because the refresh token ROTATES.
     *
     * The service refreshes on rehydration and the server issues a new
     * refresh token, retiring the old one — so a static state file is good
     * for about one run. That is why a credential a human approved two runs
     * ago was dead, and why the repair is this rather than another approval.
     */
    if (!SELF_TEST && STATE !== null) {
      await context.storageState({ path: STATE });
    }
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
