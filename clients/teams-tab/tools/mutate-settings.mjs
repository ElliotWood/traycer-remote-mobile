/**
 * Mutation probe for the settings + account surface. A PROBE, not a gate —
 * it writes to source and restores, and is deliberately unwired.
 *
 * WHY IT LOOKS PARANOID. Three separate probes in this epic reported green
 * off files they never touched: a `sed` that died on `Unmatched \{`, a node
 * replacement that matched zero times because a quoted heredoc ate a
 * backslash level, and a Python harness that died decoding vitest's box
 * drawing as cp1252 and left mutation 1 applied on disk. So:
 *
 *   - **Every target is asserted to appear EXACTLY ONCE before the edit and
 *     ZERO times after.** A probe that did not run is indistinguishable from
 *     a probe that passed, and the occurrence count is the only thing that
 *     tells them apart.
 *   - **Every target is a single line with no newline in it**, so CRLF-vs-LF
 *     cannot silently make it match nothing. This tree is CRLF and files
 *     written by tooling are LF; the two coexist inside one package.
 *   - **The baseline must be GREEN before anything is mutated.** A probe run
 *     against a red suite reports every mutation as caught.
 *   - **`restore()` runs in a `finally`**, and the run ends by re-asserting
 *     the file is byte-identical to where it started.
 *
 * Each mutation names the test that must redden. "The suite went red" is a
 * much weaker claim than "this named assertion went red" — a mutation that
 * reddens an unrelated test tells you nothing about the assertion you were
 * checking, and that has happened here too.
 *
 *   node tools/mutate-settings.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const VITEST = join(import.meta.dirname, "..", "..", "..", "node_modules", "vitest", "vitest.mjs");

const MUTATIONS = [
  {
    id: "MUT-1",
    file: "settings/use-settings.ts",
    why: "the email credential is no longer left alone by a renderer toggle",
    expect: "ECHOES the email channel back with password leaveUnchanged",
    from: `              password: { kind: "leaveUnchanged" },`,
    to: `              password: { kind: "clear" },`,
  },
  {
    id: "MUT-2",
    file: "settings/use-settings.ts",
    why: "the severity's entry is rebuilt from defaults, dropping its email flag",
    expect: "ECHOES the email channel back with password leaveUnchanged",
    from: `        [severity]: { ...config.matrix[severity], renderer: enabled },`,
    to: `        [severity]: { renderer: enabled, email: false },`,
  },
  {
    id: "MUT-3",
    file: "settings/use-settings.ts",
    why: "a failed write reports no error, so the switch lies in silence",
    expect: "a failed write reports the failure and does NOT advance the config",
    from: `              ? { ...prev, saving: null, saveError: describe(error) }`,
    to: `              ? { ...prev, saving: null, saveError: null }`,
  },
  {
    id: "MUT-4",
    file: "account/account-menu.tsx",
    why: "the App settings row renders with no way to navigate — a dead affordance",
    expect: "HIDES App settings when no screen is mounted to navigate with",
    from: `          {onOpenSettings === null ? null : (`,
    to: `          {false ? null : (`,
  },
  {
    id: "MUT-5",
    file: "settings/settings-screen.tsx",
    why: "a severity row disappears from the notifications matrix",
    expect: "reflects the matrix and reports the severity that was toggled",
    from: `  { severity: "failure", label: "Failures" },`,
    to: ``,
  },
  {
    id: "MUT-6",
    file: "shell/shell-settings.tsx",
    why: "the settings slot is never cleared, so a thrown screen keeps a dead row",
    expect: "sign-out does not depend on a mounted screen, settings does",
    from: `      setOpenSettings(null);`,
    to: `      /* cleared */;`,
  },
];

function run() {
  const result = spawnSync(process.execPath, [VITEST, "run"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function occurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

console.log("baseline...");
const baseline = run();
if (!/Test Files\s+\d+ passed/.test(baseline) || /failed/.test(baseline)) {
  console.error("ABORT: baseline is not green. A probe run against a red");
  console.error("suite reports every mutation as caught.");
  process.exit(1);
}
const baselineTests = /Tests\s+(\d+) passed/.exec(baseline)?.[1] ?? "?";
console.log(`baseline green: ${baselineTests} tests\n`);

let survivors = 0;
for (const mutation of MUTATIONS) {
  const path = join(SRC, mutation.file);
  const original = readFileSync(path, "utf8");
  const before = occurrences(original, mutation.from);
  if (before !== 1) {
    console.error(
      `ABORT ${mutation.id}: target appears ${before} times in ${mutation.file}, expected exactly 1.`,
    );
    console.error("  This is the guard, not a nuisance: a target that matches");
    console.error("  zero times produces a SURVIVED verdict about an unedited file.");
    process.exit(1);
  }

  try {
    const mutated = original.replace(mutation.from, mutation.to);
    if (occurrences(mutated, mutation.from) !== 0) {
      console.error(`ABORT ${mutation.id}: the edit did not land.`);
      process.exit(1);
    }
    writeFileSync(path, mutated);
    const output = run();
    const failed = /failed/.test(output);
    const named = output.includes(mutation.expect);
    if (failed && named) {
      console.log(`${mutation.id} CAUGHT  by "${mutation.expect}"`);
    } else if (failed) {
      console.log(
        `${mutation.id} caught, but NOT by the named test — ${mutation.expect}`,
      );
      console.log("        a mutation reddening an unrelated test proves nothing here");
      survivors += 1;
    } else {
      console.log(`${mutation.id} SURVIVED — ${mutation.why}`);
      survivors += 1;
    }
  } finally {
    writeFileSync(path, original);
    if (readFileSync(path, "utf8") !== original) {
      console.error(`RESTORE FAILED for ${mutation.file} — fix by hand.`);
      process.exit(1);
    }
  }
}

console.log(`\n${MUTATIONS.length} mutations, ${survivors} survivor(s).`);
process.exit(survivors === 0 ? 0 : 1);
