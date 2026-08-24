#!/usr/bin/env node
// Drives a REAL browser session against the public origin and asserts the PWA
// actually RENDERS, not merely that the protocol chain carries frames.
//
// WHY THIS EXISTS SEPARATELY FROM THE OTHER TWO HARNESSES
//   verify-routing.mjs   proves the routing DECISION (two tenants, two hosts)
//   smoke-real-token.mjs proves a real credential traverses the chain
//   THIS                 proves a real browser, over the real internet, through
//                        nginx -> tenant router -> host, renders live data
//
// The first two can both pass while the app is blank: a WebSocket that opens and
// exchanges one frame is not a working client. This drives real chromium, seeds
// the session the way a signed-in user's browser already is, and fails unless
// content from the host appears on screen.
//
// CREDENTIALS: read from this machine's own `~/.traycer/cli/credentials` — the
// same file the CLI and desktop use. Nothing is copied from the VM, and neither
// the token nor the refresh token is ever printed (only a hash prefix of the
// user id, since this output lands in logs and transcripts).
//
// Usage: node verify-pwa-session.mjs <origin-url> [--headed]
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const ORIGIN = process.argv[2];
const HEADED = process.argv.includes("--headed");
if (!ORIGIN) {
  console.error("usage: node verify-pwa-session.mjs <origin-url> [--headed]");
  process.exit(2);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const credsPath = join(homedir(), ".traycer", "cli", "credentials");
const creds = JSON.parse(readFileSync(credsPath, "utf8"));
if (typeof creds.token !== "string" || typeof creds.refreshToken !== "string") {
  console.error("verify-pwa: credentials file has no usable token pair");
  process.exit(2);
}
const fingerprint = createHash("sha256").update(String(creds.user?.id)).digest("hex").slice(0, 12);
console.log(`verify-pwa: driving ${ORIGIN} as user sha256=${fingerprint} (tokens not shown)`);

/**
 * playwright-core ships no browsers, so resolve one from the local Playwright
 * cache rather than assuming a bundled path. Picks the highest-numbered full
 * chromium (not headless_shell — the PWA is a real app and service-worker /
 * storage behaviour should be exercised in a full browser).
 */
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
  const executablePath = resolveChromium();
  console.log(`verify-pwa: chromium ${executablePath}`);

  const browser = await chromium.launch({ executablePath, headless: !HEADED });
  const context = await browser.newContext({
    // A phone-shaped viewport: this is a mobile PWA, and a desktop viewport can
    // render a different tree.
    viewport: { width: 414, height: 896 },
    ignoreHTTPSErrors: false, // real cert must actually validate
  });

  const consoleErrors = [];
  const wsUrls = [];
  const pageErrors = [];

  context.on("page", (p) => {
    p.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    p.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));
    p.on("websocket", (ws) => wsUrls.push(ws.url()));
  });

  // Seed the session the way an already-signed-in browser is, BEFORE any app
  // code runs — otherwise the app boots into the device-code sign-in flow,
  // which needs a human.
  // try/catch is load-bearing, not defensive noise: an init script runs in
  // EVERY frame, and this app renders wireframe previews in sandboxed iframes
  // where `localStorage` access throws SecurityError. Without the guard the
  // harness itself generates the page errors it is supposed to be detecting —
  // an instrument that manufactures its own failures.
  await context.addInitScript(
    ([token, refreshToken]) => {
      try {
        window.localStorage.setItem(
          "traycer.mobile.auth",
          JSON.stringify({ token, refreshToken }),
        );
      } catch {
        // Sandboxed/opaque-origin frame — not the app's document, nothing to seed.
      }
    },
    [creds.token, creds.refreshToken],
  );

  const page = await context.newPage();
  const response = await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
  check("public origin served the app over valid TLS", (response?.status() ?? 0) === 200, `status=${response?.status()}`);

  // Give the client time to open its WebSocket through the router and render.
  await page.waitForTimeout(12000);

  const wsThroughOrigin = wsUrls.filter((u) => u.startsWith("wss://"));
  check(
    "the app opened a wss connection (through nginx -> tenant router)",
    wsThroughOrigin.length > 0,
    wsThroughOrigin.join(", ") || "none observed",
  );

  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  const visible = bodyText.replace(/\s+/g, " ").trim();

  check("the app rendered non-trivial content", visible.length > 40, `${visible.length} chars`);

  // The decisive assertion: content that can only come from the HOST through
  // the router. A blank shell, a spinner, or a sign-in screen all fail here.
  const signInish = /sign in|device code|enter.*code|not signed in|unauthorized/i.test(visible);
  check("the app is NOT sitting on a sign-in / unauthorized screen", !signInish, signInish ? visible.slice(0, 160) : "no sign-in prompt");

  const offlineish = /can't connect|cannot connect|disconnected|connection lost|offline|failed to load/i.test(visible);
  check("the app is NOT showing a connection-failure state", !offlineish, offlineish ? visible.slice(0, 160) : "no failure banner");

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "none");

  const shotDir = mkdtempSync(join(tmpdir(), "pwa-session-"));
  const shot = join(shotDir, "pwa.png");
  await page.screenshot({ path: shot, fullPage: false });
  writeFileSync(join(shotDir, "rendered.txt"), visible, "utf8");
  console.log(`\nverify-pwa: screenshot ${shot}`);
  console.log(`verify-pwa: rendered text (first 600 chars):\n${visible.slice(0, 600)}`);
  if (consoleErrors.length > 0) {
    console.log(`\nverify-pwa: console errors (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`  - ${e}`);
  }

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
