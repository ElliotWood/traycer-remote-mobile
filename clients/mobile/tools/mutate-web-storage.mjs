#!/usr/bin/env node
/**
 * Mutation probe for the browser storage shim. A PROBE, NOT A GATE: it writes
 * to source and restores it, so never run it on a dirty tree.
 *
 * WHY IT EXISTS. `capacitor-web-shim.ts` is the whole of the credential path
 * for the `/next/` bundle, and every one of its failure modes lands in a
 * LEGITIMATE state: an under-reporting `keys()` produces "you are signed out",
 * a leaked SecurityError produces "no credentials yet", a lost prefix produces
 * "no such key". None of them is distinguishable from a correct answer at the
 * wire or in a screenshot. So "the suite is green" says very little on its
 * own; what says something is that each defect, reintroduced, reddens a test
 * that NAMES it.
 *
 * TWO GUARDS, both learned from probes in this repo that reported the wrong
 * thing:
 *
 *  - Each pattern must match EXACTLY ONCE. A pattern that has drifted matches
 *    zero times and would otherwise "pass" by mutating nothing.
 *  - An abort exits NON-ZERO and says ABORT. An aborting probe and a passing
 *    one look identical in a scroll-back otherwise.
 *
 * Usage:  node tools/mutate-web-storage.mjs      (from clients/mobile)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHIM = resolve(packageRoot, "src/web/capacitor-web-shim.ts");
const VITEST = resolve(packageRoot, "../../node_modules/vitest/vitest.mjs");

/**
 * `mustRedden` is the point of the whole file. A mutation that merely turns
 * the suite red proves the suite notices something; a mutation that reddens
 * the test written for it proves the test is about what it claims.
 */
const MUTATIONS = [
  {
    id: "MUT-1",
    what: "keys() tracks its own index instead of enumerating the real store — THE SHIPPED-DEFECT SHAPE, the one that silently signs a returning user out",
    find: `    typeof enumerable.key === "function" &&\n    typeof enumerable.length === "number"\n  ) {`,
    replace: `    typeof enumerable.key === "function" &&\n    typeof enumerable.length === "number" &&\n    false\n  ) {`,
    mustRedden: "lists keys written before this module ever ran",
  },
  {
    id: "MUT-2",
    what: "keys() drops the prefix filter and reports every key in the store",
    find: `if (key !== null && key.startsWith(PREFIX)) {`,
    replace: `if (key !== null) {`,
    mustRedden: "reports only its own prefixed keys",
  },
  {
    id: "MUT-3",
    what: "get() goes back to raw window.localStorage — the pre-port line that throws under a denying browser",
    find: `    const stored = safeStorage().getItem(\`\${PREFIX}\${options.key}\`);`,
    replace: `    const stored = window.localStorage.getItem(\`\${PREFIX}\${options.key}\`);`,
    mustRedden: "a miss still throws the missing-item message",
  },
  {
    id: "MUT-4",
    what: "set() goes back to raw window.localStorage",
    find: `    safeStorage().setItem(\`\${PREFIX}\${options.key}\`, options.value);`,
    replace: `    window.localStorage.setItem(\`\${PREFIX}\${options.key}\`, options.value);`,
    mustRedden: "no method throws a SecurityError out to the host",
  },
  {
    id: "MUT-5",
    what: "the missing-key message is reworded, so the host stops recognising a miss and crashes instead",
    find: `throw new Error("Item with given key does not exist");`,
    replace: `throw new Error("no such item");`,
    mustRedden: "a missing key throws the exact message the host matches on",
  },
  {
    id: "MUT-6",
    what: "set() stops tracking the key, so the in-memory fallback cannot list what it holds",
    find: `    trackedKeys.add(options.key);\n`,
    replace: ``,
    mustRedden: "still works for the CURRENT session, in memory",
  },
  {
    id: "MUT-7",
    what: "keys() returns the stored key with our prefix still attached",
    find: `        found.push(key.slice(PREFIX.length));`,
    replace: `        found.push(key);`,
    mustRedden: "lists keys written before this module ever ran",
  },
];

function runSuite() {
  try {
    const stdout = execFileSync(
      process.execPath,
      [VITEST, "run", "--config", "vitest.config.ts"],
      { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { failed: false, output: stdout };
  } catch (error) {
    return {
      failed: true,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

const pristine = readFileSync(SHIM, "utf8");

function abort(message) {
  writeFileSync(SHIM, pristine);
  console.error(`ABORT: ${message}`);
  console.error("Source restored. This is NOT a pass.");
  process.exit(2);
}

// The control. A probe whose baseline is red measures nothing, and every
// "survivor" it then reports is a lie in the safe direction.
process.stdout.write("control (unmutated) ... ");
const control = runSuite();
if (control.failed) abort("the suite is RED before any mutation");
console.log("green");

const survivors = [];
for (const mutation of MUTATIONS) {
  const occurrences = pristine.split(mutation.find).length - 1;
  if (occurrences !== 1) {
    abort(
      `${mutation.id} pattern matched ${occurrences} times, expected exactly 1. The source has drifted; fix the pattern.`,
    );
  }

  writeFileSync(SHIM, pristine.replace(mutation.find, mutation.replace));
  const result = runSuite();
  writeFileSync(SHIM, pristine);

  const namedTestReddened =
    result.failed && result.output.includes(mutation.mustRedden);

  if (namedTestReddened) {
    console.log(`${mutation.id} caught by "${mutation.mustRedden}"`);
  } else if (result.failed) {
    survivors.push(mutation);
    console.log(
      `${mutation.id} SUITE RED BUT WRONG TEST — "${mutation.mustRedden}" stayed green`,
    );
  } else {
    survivors.push(mutation);
    console.log(`${mutation.id} SURVIVED — ${mutation.what}`);
  }
}

console.log(
  `\n${MUTATIONS.length - survivors.length}/${MUTATIONS.length} caught by their named test, ${survivors.length} survivors`,
);
process.exit(survivors.length === 0 ? 0 : 1);
