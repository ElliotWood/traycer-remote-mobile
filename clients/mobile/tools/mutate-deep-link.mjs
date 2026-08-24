#!/usr/bin/env node
/**
 * A PROBE, NOT A GATE. Writes to source, runs the suite, restores.
 *
 * The property under test is not "does a deep link parse" - it is "would a
 * card that addresses this tab actually land on the chat". Every mutation
 * below is a way that fails while looking fine: the route read and applied to
 * nothing, the hash set without a reload, the loop guard that stops a Teams
 * tab spinning forever.
 *
 * MUT-3 is the one worth reading. It sets the fragment and skips the reload,
 * which is what an author who had not read @tanstack/history would write - the
 * URL changes, the view does not, and no test that only checks `setHash` can
 * tell the difference.
 *
 * Aborts non-zero unless every pattern matches EXACTLY ONCE: a pattern that
 * matches zero times leaves the source untouched and the suite green, which
 * reads in a scroll-back exactly like a caught mutation.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..", "..");

const HOST = join(PKG, "src", "web", "teams-host.ts");
const LINK = join(PKG, "src", "web", "teams-deep-link.ts");

const SPEC = ["src/web/teams-host.test.ts", "src/web/teams-deep-link.test.ts"];

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "the route is read and applied to nothing - the shipped defect, verbatim",
    file: HOST,
    find: "  if (subPageId !== null) options.onDeepLink?.(subPageId);",
    replace: "",
    names: ["hands the route to onDeepLink and reports it in the state"],
  },
  {
    id: "MUT-2",
    why: "an empty subPageId becomes a route",
    file: HOST,
    find: '    subPageId = page === "" ? null : page;',
    replace: "    subPageId = page;",
    names: ["treats an empty subPageId as absent rather than as a route"],
  },
  {
    id: "MUT-3",
    why: "sets the fragment and does NOT reload - the URL moves, the view does not",
    file: LINK,
    find: "  target.setHash(route);\n  target.reload();",
    replace: "  target.setHash(route);",
    names: ["puts the route in the fragment and reloads, on a subpath deploy"],
  },
  {
    id: "MUT-4",
    why: "the loop guard removed - a Teams tab reloads forever",
    file: LINK,
    find: '  if (target.currentHash.replace(/^#/, "") === route) return "already-there";',
    replace: "",
    names: ["does nothing when the fragment is already that route"],
  },
  {
    id: "MUT-5",
    why: "a relative route is accepted and resolves against wherever we happen to be",
    file: LINK,
    find: '  if (!route.startsWith("/")) return null;',
    replace: "",
    names: [
      "rejects a relative route, which would resolve against wherever we are",
    ],
  },
  {
    id: "MUT-6",
    why: "a protocol-relative path is accepted, naming another origin",
    file: LINK,
    find: '  if (route.startsWith("//")) return null;',
    replace: "",
    names: [
      "rejects a protocol-relative path, because that names another origin",
    ],
  },
  {
    id: "MUT-7",
    why: "the deep link is offered AFTER the load protocol is answered",
    file: HOST,
    find: "  if (subPageId !== null) options.onDeepLink?.(subPageId);\n\n  try {\n    // Teams pushes theme changes",
    replace: "  try {\n    // Teams pushes theme changes",
    also: {
      find: "  return { inTeams: true, theme, hostClientType, subPageId };",
      replace:
        "  if (subPageId !== null) options.onDeepLink?.(subPageId);\n  return { inTeams: true, theme, hostClientType, subPageId };",
    },
    names: ["offers the deep link BEFORE answering the load protocol"],
  },
  {
    id: "MUT-8",
    why: "the subpath rule inverted - hash and path history swap",
    file: LINK,
    find: '    isSubpath: baseUrl.replace(/\\/+$/, "") !== "",',
    replace: '    isSubpath: baseUrl.replace(/\\/+$/, "") === "",',
    names: ["reads the vite base the way gui-app's own isSubpathDeploy does"],
  },
];

function runSuite() {
  try {
    const out = execFileSync(
      process.execPath,
      [join(ROOT, "node_modules", "vitest", "vitest.mjs"), "run", ...SPEC],
      { cwd: PKG, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { failed: false, output: out };
  } catch (error) {
    return {
      failed: true,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

/** Applies one edit, asserting it matches exactly once. */
function applyEdit(source, edit, id) {
  const occurrences = source.split(edit.find).length - 1;
  if (occurrences !== 1) {
    console.error(
      `${id}: pattern matched ${occurrences} times, expected exactly 1 - ABORTING`,
    );
    process.exit(2);
  }
  return source.replace(edit.find, edit.replace);
}

const control = runSuite();
if (control.failed) {
  console.error("CONTROL FAILED - nothing below means anything");
  console.error(control.output.slice(-2000));
  process.exit(2);
}
console.log("control: green\n");

let exitCode = 0;

for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, "utf8");
  // Each edit keeps the exactly-once guard INDEPENDENTLY, so a multi-edit
  // mutation cannot half-apply. A half-applied mutation produces a survivor,
  // which reads as a weak test rather than as a broken tool.
  let mutated = applyEdit(original, mutation, mutation.id);
  if (mutation.also !== undefined) {
    mutated = applyEdit(mutated, mutation.also, `${mutation.id} (second edit)`);
  }

  writeFileSync(mutation.file, mutated);
  let result;
  try {
    result = runSuite();
  } finally {
    writeFileSync(mutation.file, original);
  }

  const missing = mutation.names.filter(
    (name) => !result.output.includes(name),
  );
  if (!result.failed) {
    console.log(`${mutation.id} SURVIVED  - ${mutation.why}`);
    exitCode = 1;
  } else if (missing.length > 0) {
    console.log(
      `${mutation.id} caught, but NOT by ${missing.join(", ")} - ${mutation.why}`,
    );
    exitCode = 1;
  } else {
    console.log(`${mutation.id} caught by its named test - ${mutation.why}`);
  }
}

process.exit(exitCode);
