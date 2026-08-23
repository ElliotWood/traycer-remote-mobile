/**
 * A PROBE, NOT A GATE. It writes to source and restores; it is not wired into
 * CI and must not be. Run it by hand:
 *
 *   node tools/mutate-wake-lock.mjs
 *
 * Each mutation names the test that MUST redden. A mutation caught by "the
 * suite went red somewhere" is not caught in the sense that matters - it tells
 * you nothing about whether the assertion you believe covers a behaviour is the
 * one doing the work.
 *
 * MUT-1 IS THE MUTATION WORTH HAVING: it restores the shipped code exactly, and
 * the suite must redden on the row that says a forbidden surface is reported
 * differently from a refused one. MUT-3 is its quieter sibling - it keeps the
 * new reading but drops the early return, so the module reports the right thing
 * and then goes on requesting a lock it can never hold, forever.
 *
 * Every mutation aborts unless its pattern matches EXACTLY ONCE. A probe whose
 * pattern silently matches zero times reports a pass it never measured.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MODULE = join(ROOT, "src", "web", "screen-wake-lock.ts");

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "THE SHIPPED DEFECT: no policy check at all, so a permanently forbidden surface reports the transient reading",
    from:
      "  if (isWakeLockPolicyBlocked(doc)) {\n" +
      '    report("policy-blocked");\n' +
      "    return () => {};\n" +
      "  }",
    to: "",
    catcher:
      "is a DIFFERENT reading from a permitted surface whose request is refused",
  },
  {
    id: "MUT-2",
    why: "the block is detected and then reported as the transient outcome - the conflation restored one layer up",
    from: '    report("policy-blocked");',
    to: '    report("unavailable");',
    catcher:
      "reports 'policy-blocked' and never asks for a lock it cannot have",
  },
  {
    id: "MUT-3",
    why: "reports correctly, then falls through: a guaranteed-failing request on every tab switch for the life of the tab",
    from:
      '    report("policy-blocked");\n' +
      "    return () => {};",
    to: '    report("policy-blocked");',
    catcher: "does not retry on visibility, because the policy cannot change",
  },
  {
    id: "MUT-4",
    why: "the silent hidden-at-start path restored - `<html data-wake-lock>` carries no attribute at all",
    from: '      report("deferred");\n      return;',
    to: "      return;",
    catcher:
      "does not request while the page is hidden at startup, and SAYS SO",
  },
  {
    id: "MUT-5",
    why: "hiding the page leaves the attribute asserting `held` at the one moment the lock provably is not held",
    from: "      sentinel = null;\n      // And say so.",
    to: "      // And say so.",
    catcher:
      "reports 'deferred' when the page hides, rather than leaving 'held' standing",
  },
  {
    id: "MUT-6",
    why: "the unknown resolves the wrong way: no policy API is treated as a refusal, silently disabling the lock on Firefox, Safari and jsdom",
    from: "  if (policy === undefined) return false;",
    to: "  if (policy === undefined) return true;",
    catcher: "is not blocked where the document exposes no policy API",
  },
  {
    id: "MUT-7",
    why: "only Chromium's name is read, so a spec rename stops the discrimination - and stops it toward `false`, which looks like health",
    from: "  const policy = doc.featurePolicy ?? doc.permissionsPolicy;",
    to: "  const policy = doc.featurePolicy;",
    catcher: "reads the spec's `permissionsPolicy` name too",
  },
  {
    id: "MUT-8",
    why: "asks the policy about a different feature and reports the answer as this one's",
    from: '    return !policy.allowsFeature("screen-wake-lock");',
    to: '    return !policy.allowsFeature("fullscreen");',
    catcher: "asks about screen-wake-lock and nothing else",
  },
  {
    id: "MUT-9",
    why: "a throwing policy read is taken as a refusal, so an exotic browser loses the feature on an error rather than on an answer",
    from: "  } catch {\n    return false;\n  }",
    to: "  } catch {\n    return true;\n  }",
    catcher: "is not blocked when the policy read throws",
  },
  {
    id: "MUT-10",
    why: "the policy is consulted ahead of the stored preference, so a user who turned it off is told the surface refused instead",
    from:
      "  if (!wakeLockEnabled(read)) {\n" +
      '    report("off");\n' +
      "    return () => {};\n" +
      "  }",
    to: "",
    catcher: "answers 'off' ahead of the policy, because the user's choice outranks it",
  },
];

const original = readFileSync(MODULE, "utf8");
const restore = () => writeFileSync(MODULE, original);

const OUT = join(ROOT, ".mutate-wake-lock.json");

/**
 * Returns the names of the tests that FAILED.
 *
 * `shell: true` is load-bearing on Windows: since the 2024 spawn hardening,
 * Node refuses to `execFileSync` a `.cmd` without it and throws EINVAL - which
 * an earlier probe in this package absorbed into the same `catch` that absorbs
 * a legitimately red suite, so the runner never started and every mutation was
 * "measured" against a report that was never written. The absence of the report
 * is therefore a hard abort: "the suite produced no report" and "the suite
 * passed" must never collapse into one reading.
 */
function runSuite() {
  if (existsSync(OUT)) rmSync(OUT);
  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "src/web/screen-wake-lock.test.ts",
        "--reporter=json",
        "--outputFile=.mutate-wake-lock.json",
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true },
    );
  } catch (error) {
    // A red suite exits non-zero, which is the expected case here - but so does
    // a runner that never started, and those are opposite facts.
    void error;
  }
  if (!existsSync(OUT)) {
    console.log(
      "ABORT - vitest produced no report. The probe measured nothing; do not " +
        "read any result above as a pass.",
    );
    restore();
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(OUT, "utf8"));
  const failed = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === "failed") failed.push(t.title);
    }
  }
  return failed;
}

console.log("control: the suite must be GREEN before any mutation is believed");
const controlFailures = runSuite();
if (controlFailures.length > 0) {
  console.log(`ABORT - control is already red:\n  ${controlFailures.join("\n  ")}`);
  process.exit(1);
}
console.log("control: green\n");

let caught = 0;
let survived = 0;

for (const m of MUTATIONS) {
  const occurrences = original.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log(
      `${m.id} ABORT - pattern matched ${occurrences} times, expected exactly 1. ` +
        "The probe is wrong, not the code.",
    );
    restore();
    process.exit(1);
  }

  writeFileSync(MODULE, original.replace(m.from, m.to));
  const failures = runSuite();
  restore();

  if (failures.includes(m.catcher)) {
    caught += 1;
    console.log(`${m.id} caught by its named test  (${failures.length} red)`);
  } else if (failures.length > 0) {
    caught += 1;
    console.log(
      `${m.id} caught, but NOT by "${m.catcher}" - by:\n    ${failures.slice(0, 4).join("\n    ")}\n` +
        "    ^ the named assertion is not the one doing the work. Investigate.",
    );
  } else {
    survived += 1;
    console.log(`${m.id} SURVIVED - ${m.why}`);
  }
}

restore();
if (existsSync(OUT)) rmSync(OUT);
console.log(`\n${caught}/${MUTATIONS.length} caught, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
