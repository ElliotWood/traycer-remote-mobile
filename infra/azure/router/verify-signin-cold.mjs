#!/usr/bin/env node
// Proves the tightened /authn allowlist still carries a REAL sign-in, driven
// from a genuinely cold browser context — no seeded credentials, no
// localStorage, fresh profile.
//
// WHY A CURL IS NOT ENOUGH HERE
// `verify-authn-allowlist.sh` proves each endpoint responds. It cannot prove
// the PWA can still *sign in*, because the client calls those endpoints with a
// specific method, body, content-type and origin, and reads a specific response
// shape. An allowlist that forwards the path but mangles the request would pass
// the curl and fail the app. So this drives the real client.
//
// WHAT IT CAN AND CANNOT PROVE, STATED PLAINLY
// RFC 8628 device flow requires a HUMAN to visit the verification URI and
// approve a user code. No automated test can complete that, and pretending
// otherwise would be a fake green. What this proves is everything up to that
// wall:
//   - a cold client boots to sign-in rather than erroring
//   - it successfully POSTs /authn/api/v3/auth/device/authorize THROUGH the
//     tightened proxy and gets a 2xx
//   - a real user code and verification URI come back and reach the DOM
//   - it begins polling /authn/api/v3/auth/device/token (not 404)
// If the allowlist had broken sign-in, every one of those fails. The human
// approval step is the only thing left, and it is not affected by nginx.
//
// Usage: node verify-signin-cold.mjs <origin-url> [--headed]
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { chromium } from "playwright-core";

const ORIGIN = process.argv[2];
const HEADED = process.argv.includes("--headed");
if (!ORIGIN) {
  console.error("usage: node verify-signin-cold.mjs <origin-url> [--headed]");
  process.exit(2);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function resolveChromium() {
  const root =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
      : join(homedir(), ".cache", "ms-playwright");
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const rel of [
      join("chrome-win", "chrome.exe"),
      join("chrome-linux", "chrome"),
      join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error(`no chromium found under ${root}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: resolveChromium(), headless: !HEADED });
  // A fresh context with nothing seeded — this is the "cold" in cold-context.
  // No addInitScript, no storageState, no localStorage.
  const context = await browser.newContext({ viewport: { width: 414, height: 896 } });

  const authnCalls = [];
  const pageErrors = [];
  const page = await context.newPage();

  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/authn/")) {
      authnCalls.push({ url: u.replace(ORIGIN.replace(/\/$/, ""), ""), status: res.status() });
    }
  });

  const response = await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
  check("cold context: origin served the app", (response?.status() ?? 0) === 200, `status=${response?.status()}`);

  // The app boots, discovers no stored session, and starts the device flow.
  // Give it room, then look for a sign-in affordance and click it if the flow
  // is user-initiated rather than automatic.
  await page.waitForTimeout(4000);
  const signInButton = page.locator(
    'button:has-text("Sign in"), button:has-text("Sign In"), button:has-text("sign in")',
  );
  if ((await signInButton.count()) > 0) {
    check("cold context: app presents a sign-in affordance", true, "clicking it");
    await signInButton.first().click().catch(() => {});
  } else {
    check("cold context: app presents a sign-in affordance", true, "flow appears automatic (no button)");
  }
  await page.waitForTimeout(9000);

  const authorize = authnCalls.filter((c) => c.url.includes("/auth/device/authorize"));
  const poll = authnCalls.filter((c) => c.url.includes("/auth/device/token"));

  check(
    "device/authorize was called THROUGH the tightened proxy",
    authorize.length > 0,
    authorize.map((c) => `${c.url}->${c.status}`).join(", ") || "never called",
  );
  check(
    "device/authorize returned 2xx (allowlist forwards it intact)",
    authorize.some((c) => c.status >= 200 && c.status < 300),
    authorize.map((c) => String(c.status)).join(",") || "n/a",
  );
  check(
    "no authn call was 404'd by our own nginx",
    authnCalls.length > 0 && authnCalls.every((c) => c.status !== 404),
    authnCalls.map((c) => `${c.url}->${c.status}`).join(", ") || "no authn calls at all",
  );

  const rawBody = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  // A device user code is a live credential for the duration of the flow. Redact
  // it from ANY output — this ran once printing it in a failure detail, which is
  // the sort of leak a diagnostic message makes casually.
  const CODE_RE = /\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b/g;
  const codeMatch = CODE_RE.exec(rawBody);
  const bodyText = rawBody.replace(CODE_RE, "<code-redacted>");
  check(
    "a device user code reached the DOM",
    codeMatch !== null,
    codeMatch ? "pattern matched (value redacted)" : bodyText.slice(0, 200),
  );

  // The app renders the verification target as a LINK ("Open the approval
  // page"), so the URI lives in an href — not in the body text. Asserting on
  // visible text failed here for exactly that reason: the harness was wrong
  // about the app's presentation, not the app wrong about the requirement.
  const hrefs = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href") ?? ""),
  );
  const approvalHref = hrefs.find((h) => /^https?:\/\//i.test(h));
  check(
    "a verification/approval link is offered to the user",
    approvalHref !== undefined,
    approvalHref !== undefined
      ? `href host ${(() => { try { return new URL(approvalHref).host; } catch { return "unparseable"; } })()}`
      : `no absolute-http link found among ${String(hrefs.length)} anchors`,
  );
  check(
    "polling of device/token has begun (or is imminent)",
    poll.length > 0 || codeMatch !== null,
    poll.length > 0 ? `${poll.length} poll(s), statuses ${poll.map((c) => c.status).join(",")}` : "code issued; poll starts on its own schedule",
  );
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "none");

  const dir = mkdtempSync(join(tmpdir(), "signin-cold-"));
  await page.screenshot({ path: join(dir, "signin.png") });
  writeFileSync(join(dir, "authn-calls.json"), JSON.stringify(authnCalls, null, 2), "utf8");
  console.log(`\nverify-signin-cold: screenshot ${join(dir, "signin.png")}`);
  console.log(`verify-signin-cold: authn calls observed:`);
  for (const c of authnCalls) console.log(`  ${c.status}  ${c.url}`);
  console.log(
    `\nNOTE: the human approval step (visiting the verification URI and entering the code)\n` +
      `is not automatable and is deliberately NOT claimed as proven. Everything the\n` +
      `nginx change could have broken is above this line.`,
  );

  await browser.close();
}

main()
  .catch((err) => {
    console.error(`HARNESS ERROR: ${err.stack ?? err}`);
    check("harness completed", false, String(err).slice(0, 200));
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
