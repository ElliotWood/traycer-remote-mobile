#!/usr/bin/env node
/**
 * A PROBE, NOT A GATE. Writes to source, runs a suite, restores.
 *
 * The question it answers is the one a passing suite cannot: if the Teams
 * entity deep link were built wrong, would anything go red — and would the
 * red name the defect?
 *
 * The two mutations worth having are 4 and 5. They mutate the FIXTURE rather
 * than the builder, so only the consumer half in `clients/gui-app` can catch
 * them. Mutations of the builder alone prove the producer test reads the
 * producer; they would pass identically if the consumer half were decoration,
 * which is exactly how this link shipped dead for six days with a green
 * whole-string test on the producer side.
 *
 * Aborts non-zero unless every pattern matches EXACTLY ONCE. A pattern that
 * matches zero times leaves the source untouched and the suite green, which
 * reads in a scroll-back exactly like a caught mutation.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..", "..");
const GUI_APP = join(ROOT, "clients", "gui-app");

const BUILDER = join(PKG, "src", "intake", "deep-link.ts");
const FIXTURE = join(
  PKG,
  "src",
  "intake",
  "__tests__",
  "__fixtures__",
  "watch-progress-links.json",
);

const PRODUCER = {
  cwd: PKG,
  spec: "src/intake/__tests__/deep-link.test.ts src/read-surface/__tests__/manifest-static-tabs.test.ts",
};
const CONSUMER = {
  cwd: GUI_APP,
  spec: "src/lib/__tests__/teams-card-link-contract.test.ts",
};

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "the feature removed outright — always emit the web link",
    file: BUILDER,
    find: "return appId === null ? webUrl : entityDeepLink(appId, route, webUrl);",
    replace: "return webUrl;",
    suite: PRODUCER,
    names: ["CONTRACT: emits the golden entity link"],
  },
  {
    id: "MUT-2",
    why: "addresses the help tab instead of the app tab",
    file: BUILDER,
    find: 'export const APP_TAB_ENTITY_ID = "traycer.app";',
    replace: 'export const APP_TAB_ENTITY_ID = "traycer.help";',
    suite: PRODUCER,
    names: ["CONTRACT: emits the golden entity link"],
  },
  {
    id: "MUT-3",
    why: "the placeholder guard removed — a manifest's nil id becomes a link",
    file: BUILDER,
    find: 'if (id === "" || id === UNSUBSTITUTED_APP_ID) return null;',
    replace: 'if (id === "") return null;',
    suite: PRODUCER,
    names: ["CONTROL: falls back to the web link for the manifest's nil app id"],
  },
  {
    id: "MUT-4",
    why: "the route carried to the tab regresses to the retired three-segment shape — CONSUMER SIDE",
    file: FIXTURE,
    // Inside the `context` parameter, which is the only copy the consumer
    // reads. The first version of this mutation edited the fixture's separate
    // `subEntityId` FIELD and survived — correctly: no consumer assertion
    // reads that field. A mutation aimed one field away from the bytes under
    // test reports a weak suite about a suite that was fine.
    find: "%22subEntityId%22%3A%22%2Fepics%2Fepic-1%2Fepic-1%3FfocusArtifactId%3Dchat-1%22",
    replace: "%22subEntityId%22%3A%22%2Fepics%2Fepic-1%2Fchats%2Fchat-1%22",
    suite: CONSUMER,
    names: ["hands the tab a route these parsers resolve to the epic and the chat"],
  },
  {
    id: "MUT-7",
    why: "the fixture's declared subEntityId drifts from the link it documents",
    file: FIXTURE,
    find: '"subEntityId": "/epics/epic-1/epic-1?focusArtifactId=chat-1"',
    replace: '"subEntityId": "/epics/epic-1/epic-1?focusArtifactId=chat-9"',
    suite: PRODUCER,
    names: ["carries the route as `subEntityId`, the tab's only inbound channel"],
  },
  {
    id: "MUT-5",
    why: "the tab and the browser are sent to different chats — CONSUMER SIDE",
    file: FIXTURE,
    find: "%22subEntityId%22%3A%22%2Fepics%2Fepic-1%2Fepic-1%3FfocusArtifactId%3Dchat-1%22",
    replace: "%22subEntityId%22%3A%22%2Fepics%2Fepic-1%2Fepic-1%3FfocusArtifactId%3Dchat-9%22",
    suite: CONSUMER,
    names: ["agrees with its own `webUrl` fallback, route for route"],
  },
  {
    id: "MUT-6",
    why: "the route rides under a key Teams does not deliver",
    file: BUILDER,
    find: 'JSON.stringify({ subEntityId: route })',
    replace: 'JSON.stringify({ subPageId: route })',
    suite: PRODUCER,
    names: [
      "CONTRACT: emits the golden entity link",
      "carries the route as `subEntityId`, the tab's only inbound channel",
    ],
  },
];

function runSuite(suite) {
  try {
    const out = execFileSync(
      process.execPath,
      [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", ...suite.spec.split(" ")],
      { cwd: suite.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { failed: false, output: out };
  } catch (error) {
    return {
      failed: true,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

let exitCode = 0;

// CONTROL FIRST. A suite that is already red makes every mutation look caught.
for (const suite of [PRODUCER, CONSUMER]) {
  const control = runSuite(suite);
  if (control.failed) {
    console.error(`CONTROL FAILED in ${suite.cwd} — nothing below means anything`);
    console.error(control.output.slice(-2000));
    process.exit(2);
  }
}
console.log("control: both suites green\n");

for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, "utf8");
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1) {
    console.error(
      `${mutation.id}: pattern matched ${occurrences} times, expected exactly 1 — ABORTING`,
    );
    process.exit(2);
  }

  writeFileSync(mutation.file, original.replace(mutation.find, mutation.replace));
  let result;
  try {
    result = runSuite(mutation.suite);
  } finally {
    writeFileSync(mutation.file, original);
  }

  const missing = mutation.names.filter((name) => !result.output.includes(name));
  if (!result.failed) {
    console.log(`${mutation.id} SURVIVED  — ${mutation.why}`);
    exitCode = 1;
  } else if (missing.length > 0) {
    // Red is not enough. A mutation caught by some unrelated test tells you
    // the suite noticed something, not that the property is defended.
    console.log(
      `${mutation.id} caught, but NOT by ${missing.join(", ")} — ${mutation.why}`,
    );
    exitCode = 1;
  } else {
    console.log(`${mutation.id} caught by its named test — ${mutation.why}`);
  }
}

process.exit(exitCode);
