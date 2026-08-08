/**
 * Mutation probe for the notification layer.
 *
 * Every mutation below is a defect a reader could plausibly introduce - and
 * several are the exact shape of a bug this epic has already shipped once. A
 * mutation that SURVIVES means the test suite agrees with an app that is broken,
 * which is the only thing a green suite cannot tell you about itself.
 *
 * Runs the WHOLE suite per mutation rather than a `-t` filter: a filter is
 * case-sensitive and exits 0 on zero matches, so a typo scores every mutant as
 * caught by a test that never ran.
 *
 * Usage: node tools/mutate-notifications.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VITEST = resolve(ROOT, "../../node_modules/.bin/vitest.exe");

const MUTATIONS = [
  {
    name: "show() RESOLVES instead of rejecting when permission is missing",
    why: "upstream would record a display receipt for a notification nobody saw, and a later grant would surface none of the backlog",
    file: "src/web/web-notification-host.ts",
    from: `        throw new Error(\`notifications: permission is "\${permission}"\`);`,
    to: `        return;`,
  },
  {
    name: "show() WRAPS the payload instead of passing it through",
    why: "upstream's parser would see an unknown shape and open the notification center instead of routing",
    file: "src/web/web-notification-host.ts",
    from: `        data: payload,`,
    to: `        data: { payload },`,
  },
  {
    name: "show() drops replaceKey",
    why: "a re-notified epic would stack duplicate notifications instead of replacing one",
    file: "src/web/web-notification-host.ts",
    from: `        tag: replaceKey ?? undefined,`,
    to: `        tag: undefined,`,
  },
  {
    name: "the page never announces itself to the worker",
    why: "a tap taken while the app was CLOSED is delivered to a window with no listener and silently lost",
    file: "src/web/web-notification-host.ts",
    from: `      container.controller?.postMessage({
        type: NOTIFICATION_CLIENT_READY_MESSAGE,
      });`,
    to: `      void NOTIFICATION_CLIENT_READY_MESSAGE;`,
  },
  {
    name: "the page routes every redelivery",
    why: "the worker resends until acknowledged, so the user is navigated to the same chat repeatedly",
    file: "src/web/web-notification-host.ts",
    from: `        if (message.id !== null) {
          if (routed.has(message.id)) return;
          routed.add(message.id);
        }`,
    to: `        void routed;`,
  },
  {
    name: "the worker clears the queue on SEND rather than on ack",
    why: "exactly the cold-open defect: a postMessage to a just-opened window is dropped, and the tap is gone",
    file: "src/web/sw.ts",
    from: `  for (const entry of pendingClicks) {`,
    to: `  for (const entry of pendingClicks.splice(0, pendingClicks.length)) {`,
  },
  {
    name: "the worker messages an ARBITRARY window instead of the focused one",
    why: "focuses and routes a lingering background tab while the visible one sits there",
    file: "src/web/sw.ts",
    from: `      const existing = windows.find((client) => client.focused) ?? windows[0];`,
    to: `      const existing = windows[0];`,
  },
  {
    name: "the worker BROADCASTS a click to every open window",
    why: "a second tab routes the same click and jumps to a chat the user opened elsewhere - and this is the shape that survived the first run of this probe, because the assertion only checked that the RIGHT window got it",
    file: "src/web/sw.ts",
    from: `      if (target === null) return;
      await waitForAck(id, target);`,
    to: `      if (target === null) return;
      for (const client of windows) flushPendingClicksTo(client);
      await waitForAck(id, target);`,
  },
  {
    name: "the worker's click message type drifts from the page's",
    why: "the notification shows, the tap does nothing, and there is no error anywhere to read",
    file: "src/web/sw.ts",
    from: `const NOTIFICATION_CLICK = "traycer:notification-click";`,
    to: `const NOTIFICATION_CLICK = "traycer:notification-clicked";`,
  },
  {
    name: "push reads its target from somewhere other than `data`",
    why: "background taps land on the landing view while foreground notifications keep working - the hardest version to notice",
    file: "src/web/sw.ts",
    from: `      data: parsed.payload,
      tag: parsed.replaceKey ?? undefined,`,
    to: `      data: null,
      tag: parsed.replaceKey ?? undefined,`,
  },
  {
    name: "a malformed push throws instead of showing nothing",
    why: "an unhandled rejection in the worker on every bad send",
    file: "src/web/sw.ts",
    from: `  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }`,
    to: `  void record;`,
  },
  {
    name: "a rejected permission request is reported as DENIED",
    why: "sends someone to reset a permission they were never asked for - the Teams-tab case, where the surface refused, not the user",
    file: "src/web/notification-permission.ts",
    from: `          report("unsupported");
        });`,
    to: `          report("denied");
        });`,
  },
  {
    name: "permission is requested on load rather than on the tap",
    why: "no user activation, so Chrome hard-denies and the origin can never ask again",
    file: "src/web/notification-permission.ts",
    from: `  report("default");
  return renderBanner(options.container, {
    onEnable: () => {`,
    to: `  report("default");
  const eager = options.requestPermission ?? defaultRequestPermission;
  void eager().catch(() => undefined);
  return renderBanner(options.container, {
    onEnable: () => {`,
  },
];

function runSuite() {
  try {
    execFileSync(VITEST, ["run", "--config", "vitest.config.ts"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    return "PASSED";
  } catch {
    return "FAILED";
  }
}

let survivors = 0;
for (const mutation of MUTATIONS) {
  const path = resolve(ROOT, mutation.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(mutation.from)) {
    // A mutation that cannot be applied scores nothing, and silently scoring it
    // as "caught" is how a probe reports a perfect result against code it never
    // touched.
    process.stdout.write(`NOT-APPLIED  ${mutation.name}\n`);
    survivors += 1;
    continue;
  }
  writeFileSync(path, original.replace(mutation.from, mutation.to), "utf8");
  const result = runSuite();
  writeFileSync(path, original, "utf8");
  if (result === "PASSED") survivors += 1;
  process.stdout.write(
    `${result === "FAILED" ? "caught   " : "SURVIVED "}    ${mutation.name}\n`,
  );
}

process.stdout.write(
  `\n${MUTATIONS.length - survivors}/${MUTATIONS.length} caught, ${survivors} survivors\n`,
);
process.exitCode = survivors === 0 ? 0 : 1;
