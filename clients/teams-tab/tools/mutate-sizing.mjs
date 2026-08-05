#!/usr/bin/env node
/**
 * Mutation probe for the canvas sizing rule.
 *
 * A PROBE, NOT A GATE. It writes to source and restores, so it is deliberately
 * unwired from CI — a gate that edits the tree is a gate that can lose work.
 * Run it by hand after touching `split-affordance.ts`, `use-pane-extent.ts`,
 * or the split controls.
 *
 * ─── The contract, which is the whole value ───
 *
 * Every mutation ABORTS unless its pattern matches EXACTLY ONCE. This is not
 * defensive tidiness: on this branch, three separate mutation attempts have
 * reported green from code that was never mutated — a `sed` that died on
 * `Unmatched \{` and printed five passes, a `node` replacement whose pattern
 * lost a backslash in transit and matched zero times, and a pattern that
 * matched twice and mutated only the first. **A probe that did not run is
 * indistinguishable from a probe that passed**, so the match count is checked
 * before anything is written and a miss is a hard abort, not a warning.
 *
 * Matching is LF-normalised because this tree checks out CRLF.
 *
 * ─── Why THIS rule needs a probe more than most ───
 *
 * `MIN_PANE_PX` shipped in eleven bundles with a consumer and no behaviour.
 * The failure mode being guarded against is not "the rule is wrong" but "the
 * rule is inert and everything still looks green" — which is exactly what a
 * mutation that always allows the split reproduces. If MUT-1 below ever
 * survives, the constant has gone back to having no enforcement.
 *
 *   node tools/mutate-sizing.mjs
 *
 * Exit 0 = every mutation was caught. Exit 1 = a survivor, named.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = resolve(TAB, "..", "..", "node_modules", "vitest", "vitest.mjs");
const SUITE = "src/canvas/__tests__";

const AFFORDANCE = "src/canvas/split-affordance.ts";

/**
 * Each mutation names the specific claim it falsifies. A mutation whose
 * expected catcher is "some test somewhere" is not evidence about coverage.
 */
const MUTATIONS = [
  {
    id: "MUT-1",
    what: "the rule is inert — affordsSplit always allows, as it effectively did before this commit",
    file: AFFORDANCE,
    from: "  if ((along - SPLIT_HANDLE_PX) / 2 >= MIN_PANE_PX) return SPLIT_ALLOWED;",
    to: "  if (true) return SPLIT_ALLOWED;",
    catcher: "refuses one pixel below the threshold; the width-reason wiring test",
  },
  {
    id: "MUT-2",
    what: "the handle thickness is forgotten, so 480..487 wrongly splits",
    file: AFFORDANCE,
    from: "  if ((along - SPLIT_HANDLE_PX) / 2 >= MIN_PANE_PX) return SPLIT_ALLOWED;",
    to: "  if (along / 2 >= MIN_PANE_PX) return SPLIT_ALLOWED;",
    catcher: "the (487, 488) boundary pair",
  },
  {
    id: "MUT-3",
    what: "the split axis is ignored — width is read for every direction",
    file: AFFORDANCE,
    from:
      "  const along =\n" +
      '    position === "left" || position === "right" ? extent.width : extent.height;',
    to: "  const along = extent.width;",
    catcher: "the wide-and-short pane (1000x300) splitting right but not down",
  },
  {
    id: "MUT-4",
    what: "unmeasured is treated as too small, which would disable the canvas on first paint",
    file: AFFORDANCE,
    from: "  if (along === null) return SPLIT_ALLOWED;",
    to: '  if (along === null) return { allowed: false, reason: "Not enough width to split" };',
    catcher: "the unmeasured/jsdom-default tests",
  },
  {
    id: "MUT-5",
    what: "the size answer is discarded at the join, so the wiring never consults it",
    file: AFFORDANCE,
    from: "  return affordsSplit(extent, position);",
    to: "  return SPLIT_ALLOWED;",
    catcher: "resolveSplitAffordance defers-to-size; the width-reason wiring test",
  },
  {
    id: "MUT-6",
    what: "the depth reason no longer wins, so a nested pane blames its width",
    file: AFFORDANCE,
    from: '    return { allowed: false, reason: "Nesting limit reached" };',
    to: "    return affordsSplit(extent, position);",
    catcher: "the depth-precedence test; pane-controls' 'says WHY' assertion",
  },
];

function readLf(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function suiteIsGreen() {
  try {
    execFileSync(process.execPath, [VITEST, "run", SUITE], {
      cwd: TAB,
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

console.log("baseline: running the canvas suite unmutated");
if (!suiteIsGreen()) {
  console.error(
    "ABORT: the suite is RED before any mutation. A probe run from a red\n" +
      "       baseline reports every mutation as caught and means nothing.",
  );
  process.exit(1);
}
console.log("baseline green\n");

const survivors = [];
for (const mutation of MUTATIONS) {
  const path = resolve(TAB, mutation.file);
  const original = readFileSync(path, "utf8");
  const normalised = readLf(path);

  const hits = normalised.split(mutation.from).length - 1;
  if (hits !== 1) {
    console.error(
      `ABORT ${mutation.id}: pattern matched ${hits} time(s), expected exactly 1.`,
    );
    console.error(
      "       Nothing was written. A pattern that misses would otherwise\n" +
        "       print a pass about unmutated code.",
    );
    writeFileSync(path, original);
    process.exit(1);
  }

  writeFileSync(path, normalised.replace(mutation.from, mutation.to));
  const caught = !suiteIsGreen();
  writeFileSync(path, original);

  if (readFileSync(path, "utf8") !== original) {
    console.error(`ABORT ${mutation.id}: restore failed — check the tree`);
    process.exit(1);
  }

  console.log(`${caught ? "caught  " : "SURVIVED"} ${mutation.id}  ${mutation.what}`);
  if (!caught) survivors.push(mutation);
}

console.log("");
if (survivors.length === 0) {
  console.log(`${MUTATIONS.length} mutation(s), 0 survivors.`);
  console.log(
    "NOT COVERED: that the rule fires against a REAL layout. jsdom measures\n" +
      "nothing, so the component tests inject a rect. Only a browser at a real\n" +
      "width shows the control disabled for a reason the user can see.",
  );
} else {
  console.error(`${survivors.length} SURVIVOR(S):`);
  for (const s of survivors) {
    console.error(`  ${s.id}  ${s.what}`);
    console.error(`        expected catcher: ${s.catcher}`);
  }
}
process.exit(survivors.length === 0 ? 0 : 1);
