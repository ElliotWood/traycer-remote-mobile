/**
 * A PROBE, NOT A GATE. It writes to source and restores; it is not wired into
 * CI and must not be. Run it by hand:
 *
 *   node tools/mutate-native-notify.mjs
 *
 * Each mutation names the test that MUST redden. A mutation caught by "the
 * suite went red somewhere" is not caught in the sense that matters.
 *
 * MUT-1 IS THE MUTATION WORTH HAVING: it restores the shipped code exactly.
 * MEASURED, rather than asserted - it reddens THREE rows, two unit and one
 * seam:
 *
 *   x RESOLVES rather than rejecting, so the row is not retried forever
 *   x reports surface-blocked, distinctly from a transient refusal
 *   x permanently blocked: displays once and does not re-toast on later arrivals
 *
 * All three were written with the fix, so none of them existed while the defect
 * was shipping - which is most of the answer to how it survived. The seam row
 * is still the one that matters, and the difference is worth stating: the two
 * unit rows assert that this module's NEW API behaves as designed, so they
 * could only have been written once the fix was. The seam row states the
 * consequence in the units a user experiences - how many times one notification
 * re-toasts - and could have been written, and failed, before anything here
 * changed. A test that can only exist after the repair does not tell you the
 * repair was needed.
 *
 * Two test files are run together deliberately: the unit file alone cannot
 * catch MUT-1's user-visible half, and the seam file alone cannot catch the
 * reporting mutations.
 *
 * Every mutation aborts unless its pattern matches EXACTLY ONCE. A probe whose
 * pattern silently matches zero times reports a pass it never measured.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MODULE = join(ROOT, "src", "web", "web-notification-host.ts");

const MUTATIONS = [
  {
    id: "MUT-1",
    why: "THE SHIPPED DEFECT: no surface check at all, so a permanent block rejects and upstream retries the whole backlog on every arrival, forever",
    from:
      "        if (isSurfaceBlocked()) {\n" +
      '          report("surface-blocked");\n' +
      "          return;\n" +
      "        }\n",
    to: "",
    catcher:
      "permanently blocked: displays once and does not re-toast on later arrivals",
  },
  {
    id: "MUT-2",
    why: "the block is detected and reported, then falls through and rejects anyway - the right reading followed by the wrong action",
    from:
      '          report("surface-blocked");\n' +
      "          return;\n",
    to: '          report("surface-blocked");\n',
    catcher: "RESOLVES rather than rejecting, so the row is not retried forever",
  },
  {
    id: "MUT-3",
    why: "the surface is consulted BEFORE the permission gate, withholding notifications from a same-origin frame that is embedded AND granted",
    from:
      "      const permission = getPermission();\n" +
      '      if (permission !== "granted") {',
    to:
      "      const permission = getPermission();\n" +
      '      if (isSurfaceBlocked() || permission !== "granted") {',
    catcher: "still DISPLAYS when the surface is embedded but the grant is held",
  },
  {
    id: "MUT-4",
    why: "the construction stamp is dropped, so `<html data-native-notify>` is absent until a notification arrives - which on a quiet day is never",
    from: '  report("idle");\n',
    to: "",
    catcher: "stamps idle at construction, before anything has been asked of it",
  },
  {
    id: "MUT-5",
    why: "the default treats EVERY surface as permanently blocked, silently disabling retry in an ordinary browser where the grant can still change",
    from:
      "    options.isSurfaceBlocked ??\n" +
      "    ((): boolean => isCrossOriginFramed(currentWindow()));",
    to: "    options.isSurfaceBlocked ?? ((): boolean => true);",
    catcher:
      "treats a cross-origin frame as blocked by default, with no injection",
  },
  {
    id: "MUT-6",
    why: "a transient refusal is reported with the permanent word, sending a reader of the attribute to look for a fix that does not apply",
    from: '        report("permission");',
    to: '        report("surface-blocked");',
    catcher: "keeps rejecting where the denial is merely transient",
  },
  {
    id: "MUT-7",
    why: "a successful display never updates the attribute, so it keeps asserting the boot state while notifications are being drawn",
    from: '      report("shown");',
    to: '      report("idle");',
    catcher: "still DISPLAYS when the surface is embedded but the grant is held",
  },
  {
    id: "MUT-8",
    why: "the surface check is inverted, so exactly the surfaces that CAN display are the ones told they cannot",
    from: "        if (isSurfaceBlocked()) {",
    to: "        if (!isSurfaceBlocked()) {",
    catcher: "keeps rejecting where the denial is merely transient",
  },
];

const original = readFileSync(MODULE, "utf8");
const restore = () => writeFileSync(MODULE, original);

const OUT = join(ROOT, ".mutate-native-notify.json");

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
        "src/web/web-notification-host.test.ts",
        "src/web/native-notify-retry.test.tsx",
        "--reporter=json",
        "--outputFile=.mutate-native-notify.json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      },
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
  console.log(
    `ABORT - control is already red:\n  ${controlFailures.join("\n  ")}`,
  );
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
