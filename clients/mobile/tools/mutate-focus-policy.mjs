/**
 * Mutation probe for the framed focus reading.
 *
 * Every mutation is a defect a reader could plausibly introduce, and four of
 * them are the two failure DIRECTIONS this module had to choose between - a
 * reading that suppresses too much (a missed blocked-agent chime) and one that
 * suppresses too little (the defect being fixed). A suite that cannot tell
 * those apart has not tested the decision, only the plumbing.
 *
 * SCOPED to `focus-policy.test.ts` rather than the whole suite, and the scope is
 * defensible rather than convenient: `focus-policy.ts` has exactly one importer
 * (`main.tsx`), which has no test that reads `document.hasFocus`. Running one
 * file by PATH is not the `-t` hazard the sibling probes warn about - a path
 * that matches nothing makes vitest exit non-zero, so a typo here scores every
 * mutant as caught by a run that failed for the wrong reason and the
 * NOT-APPLIED guard below is what separates the two.
 *
 * Usage: node tools/mutate-focus-policy.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VITEST = resolve(ROOT, "../../node_modules/.bin/vitest.exe");
const TEST_FILE = "src/web/focus-policy.test.ts";
const SOURCE = "src/web/focus-policy.ts";

const MUTATIONS = [
  {
    name: "MUT-1 the native reading no longer short-circuits",
    why: "a document that HOLDS focus would be reported unfocused whenever the geometry disagreed - the one input that is never in doubt, overruled by the two that are",
    from: `  if (input.nativeHasFocus) return true;
  return input.visible && input.onScreen;`,
    to: `  return input.visible && input.onScreen;`,
  },
  {
    name: "MUT-2 the on-screen term is dropped",
    why: "the DANGEROUS direction: a frame Teams has switched away from still reads focused, so the one chat left open suppresses its own notifications forever",
    from: `  return input.visible && input.onScreen;`,
    to: `  return input.visible;`,
  },
  {
    name: "MUT-3 the visibility term is dropped",
    why: "the same direction one step milder - a backgrounded window keeps suppressing. This is the term the probe could NOT measure, so a surviving mutant here would mean the suite never checked the part that rests on the spec rather than on a reading",
    from: `  return input.visible && input.onScreen;`,
    to: `  return input.onScreen;`,
  },
  {
    name: "MUT-4 the reading collapses to the native one",
    why: "the module installs, reports `framed`, and changes nothing - the shape where both ends are green and the seam does nothing",
    from: `          nativeHasFocus: native(),
          visible: doc.visibilityState === "visible",
          onScreen,`,
    to: `          nativeHasFocus: native(),
          visible: false,
          onScreen: false,`,
  },
  {
    name: "MUT-5 on-screen is assumed true before the observer answers",
    why: "suppresses on an assumption during the window between install and the first callback, which is exactly the boot path a notification can arrive on",
    from: `  let onScreen = false;`,
    to: `  let onScreen = true;`,
  },
  {
    name: "MUT-6 the frame test is dropped and every surface is adapted",
    why: "the PWA and the desktop renderer would take a reading built for a frame - the widest possible blast radius for a fix whose whole justification is that framing created the defect",
    from: `  if (!isFramed()) {
    report("native");
    return "native";
  }`,
    to: `  if (false) {
    report("native");
    return "native";
  }`,
  },
  {
    name: "MUT-7 a missing observer installs the reading anyway",
    why: "without its on-screen term the reading is `visibilityState === visible`, true almost always - so jsdom and older browsers would suppress far more than the defect ever cost",
    from: `  if (!observing) {
    report("unmeasured");
    return "unmeasured";
  }`,
    to: `  if (false) {
    report("unmeasured");
    return "unmeasured";
  }`,
  },
  {
    name: "MUT-8 the native reading is cached at install",
    why: "the gate is consulted at DISPLAY time, arbitrarily long after boot. A cached `false` is the exact staleness `notification-display.ts`'s own docblock says it re-reads live focus to avoid",
    from: `          nativeHasFocus: native(),`,
    to: `          nativeHasFocus: false,`,
  },
  {
    name: "MUT-9 on-screen changes are reported but never applied",
    why: "the attribute a probe reads would toggle correctly on a deployed tab while the reading behind it never moved - a reporter that certifies a mechanism it is no longer connected to",
    from: `    onScreen = next;
    reportOnScreen(next);`,
    to: `    reportOnScreen(next);`,
  },
];

function runSuite() {
  try {
    execFileSync(VITEST, ["run", TEST_FILE], { cwd: ROOT, stdio: "pipe" });
    return "PASSED";
  } catch {
    return "FAILED";
  }
}

const path = resolve(ROOT, SOURCE);
let survivors = 0;

// The baseline. A suite that is already red scores every mutant as caught, and
// this epic has read a red gate as a finding about a change twice.
if (runSuite() !== "PASSED") {
  process.stdout.write(
    "BASELINE IS RED - no mutation result would mean anything\n",
  );
  process.exit(1);
}

for (const mutation of MUTATIONS) {
  const original = readFileSync(path, "utf8");
  if (!original.includes(mutation.from)) {
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
