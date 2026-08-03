/**
 * Drift gate for the verbatim layout-core copies in `src/canvas/`.
 *
 * `src/canvas/README.md` records WHY those three files are copied rather than
 * extracted to `clients/shared` (gui-app has 46 importers and no dependency on
 * shared). This script is the other half of that decision: **a copy without a
 * drift check becomes a fork silently, and nobody notices until the two
 * implementations disagree about something subtle like `MIN_SPLIT_SIZE`.**
 *
 * The check is byte equality, which is why the copies carry no provenance
 * header — provenance lives in the README so `readFileSync` comparison stays
 * exact. A header would have made every future check a fuzzy one.
 *
 * It also refuses to pass when an origin file is MISSING. A checker that
 * reports "nothing to compare, all good" is this project's most-catalogued
 * defect: an instrument that cannot fail.
 *
 *   node tools/check-canvas-core.mjs
 *
 * Exit 0 = identical. Exit 1 = drifted, missing, or unreadable, with the
 * pairs named individually rather than a count.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TAB = resolve(HERE, "..");
const GUI = resolve(TAB, "..", "gui-app");

/** copy → origin. Add a pair when a file is lifted; delete one to declare a fork. */
const PAIRS = [
  ["src/canvas/tile-tree.ts", "src/stores/epics/canvas/tile-tree.ts"],
  [
    "src/canvas/tile-tree-constants.ts",
    "src/stores/epics/canvas/tile-tree-constants.ts",
  ],
  [
    "src/canvas/resize-sizes.ts",
    "src/components/epic-canvas/canvas/resize-handle-sizes.ts",
  ],
];

function read(path) {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (error) {
    return { ok: false, reason: error.code ?? String(error) };
  }
}

let failures = 0;
for (const [copyRel, originRel] of PAIRS) {
  const copy = read(resolve(TAB, copyRel));
  const origin = read(resolve(GUI, originRel));

  if (!copy.ok) {
    console.error(`MISSING COPY   ${copyRel} (${copy.reason})`);
    failures += 1;
    continue;
  }
  if (!origin.ok) {
    // NOT a pass. An unreadable origin means the check did not run for this
    // pair, and "did not run" must never render as green.
    console.error(`MISSING ORIGIN ${originRel} (${origin.reason})`);
    console.error(
      "               cannot verify this copy - treat as drifted until the origin is back",
    );
    failures += 1;
    continue;
  }
  if (copy.text !== origin.text) {
    console.error(`DRIFTED        ${copyRel}`);
    console.error(`               vs clients/gui-app/${originRel}`);
    failures += 1;
    continue;
  }
  console.log(`identical      ${copyRel}`);
}

console.log("");
console.log(`${PAIRS.length} pair(s) checked, ${failures} failing.`);
console.log(
  "NOT COVERED: behaviour. This is byte equality only - two files can be",
);
console.log(
  "identical and both wrong. The lifted suite in src/canvas/__tests__ is",
);
console.log("what argues the code is correct.");
process.exit(failures === 0 ? 0 : 1);
