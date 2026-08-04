/**
 * Mutation probe for the usage surface — A PROBE, NOT A GATE.
 *
 * It writes to source and restores it. Every mutation ABORTS unless its pattern
 * matches exactly once, so a refactor that moves the code makes this fail loudly
 * rather than silently mutating nothing and reporting green — which is the
 * failure mode that makes a mutation probe worse than none.
 *
 * Each entry names the test that MUST redden. "The suite went red" is a much
 * weaker claim than "this named assertion went red": a mutation that reddens
 * some unrelated test proves the code is reachable, not that anything is
 * checking the property.
 *
 * Run from `clients/teams-tab`:
 *   node tools/mutate-usage.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SHARED = "../shared/rate-limits/usage-windows.ts";
const USE_SETTINGS = "src/settings/use-settings.ts";
const PROVIDER_USAGE = "src/settings/provider-usage.tsx";
const SETTINGS_SCREEN = "src/settings/settings-screen.tsx";

const MUTATIONS = [
  {
    name: "openrouter/kilocode return [] instead of null (collapses the two empty states)",
    file: SHARED,
    from: `    case "openrouter":
    case "kilocode":
      return null;`,
    to: `    case "openrouter":
    case "kilocode":
      return [];`,
    expect: "NO window concept",
    suite: "../shared",
  },
  {
    name: "windowLabel stops naming the weekly window",
    file: SHARED,
    from: `  if (durationMinutes === 10080) return "Weekly";`,
    to: `  if (durationMinutes === -1) return "Weekly";`,
    expect: "names the two windows desktop names in words",
    suite: "../shared",
  },
  {
    name: "formatResetLine's 3-hour boundary moves (minutes never coarsen to hours)",
    file: SHARED,
    from: `  if (diffMinutes < 180) return \`Resets in \${diffMinutes}m\`;`,
    to: `  if (diffMinutes < 1800) return \`Resets in \${diffMinutes}m\`;`,
    expect: "reports minutes below the 3-hour threshold",
    suite: "../shared",
  },
  {
    name: "an elapsed window reports a negative duration instead of 'soon'",
    file: SHARED,
    from: `  if (diffMs <= 0) return "Resets soon";`,
    to: `  if (diffMs < 0) return "Resets soon";`,
    expect: "says 'soon' rather than a negative duration",
    suite: "../shared",
  },
  {
    name: "codex drops an extra window's own name",
    file: SHARED,
    from: `            label: extra.limitName ?? windowLabel(extra.primary.durationMinutes),`,
    to: `            label: windowLabel(extra.primary.durationMinutes),`,
    expect: "prefers an extra window's own NAME",
    suite: "../shared",
  },
  {
    name: "the ambient profile is requested as the wire sentinel",
    file: USE_SETTINGS,
    from: `  return profile.kind === "ambient" ? null : profile.profileId;`,
    to: `  return profile.profileId;`,
    expect: "requests the AMBIENT profile as null",
    suite: ".",
  },
  {
    name: "a null snapshot is reported as a failed request",
    file: USE_SETTINGS,
    from: `            detail: "This host reported no usage data for this account.",`,
    to: `            detail: "Couldn't reach the provider.",`,
    expect: "distinguishes a null snapshot from a rejected request",
    suite: ".",
  },
  {
    name: "the severe threshold stops firing",
    file: PROVIDER_USAGE,
    from: `        color={percent >= SEVERE_USED_PERCENT ? "error" : "brand"}`,
    to: `        color={"brand"}`,
    expect: "marks a window at or past the severe threshold",
    suite: ".",
  },
  {
    name: "the meter's accessible name drops the window it belongs to",
    file: PROVIDER_USAGE,
    from: `        aria-label={\`\${row.label}: \${percent}% used\`}`,
    to: `        aria-label={\`\${percent}% used\`}`,
    expect: "renders one labelled meter per window",
    suite: ".",
  },
  {
    name: "a lone profile is labelled anyway",
    file: PROVIDER_USAGE,
    from: `            provider.profiles.length > 1`,
    to: `            provider.profiles.length > 0`,
    expect: "does not label a lone profile",
    suite: ".",
  },
  {
    name: "usage is read for disabled providers too",
    file: SETTINGS_SCREEN,
    from: `      {provider.enabled ? (`,
    to: `      {true ? (`,
    expect: "reads usage for the ENABLED provider only",
    suite: ".",
  },
];

let survivors = 0;
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, "utf8");
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.error(
      `ABORT: pattern for "${mutation.name}" matched ${occurrences} times, expected exactly 1.`,
    );
    process.exit(2);
  }
  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
  let outcome;
  try {
    const stdout = execFileSync(
      process.execPath,
      ["../../node_modules/vitest/vitest.mjs", "run", "-t", mutation.expect],
      { cwd: mutation.suite, encoding: "utf8", stdio: "pipe" },
    );
    outcome = { passed: true, output: stdout };
  } catch (error) {
    outcome = {
      passed: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  } finally {
    writeFileSync(mutation.file, original);
  }

  /*
   * ⚠️ ZERO TESTS RUN IS NOT A PASS, AND VITEST EXITS 0 FOR IT.
   *
   * `-t` is CASE-SENSITIVE. This probe's first run reported the
   * openrouter/kilocode mutation as SURVIVED, and it had not survived — the
   * pattern was written lower-case against a test named "...NO window
   * concept...", so vitest skipped all 664 tests, ran none, and exited 0. The
   * probe then read that exit code as "the named test still passed".
   *
   * That is the exact hollow-green shape this epic keeps cataloguing, produced
   * by the instrument built to detect it. The pattern fix alone would have made
   * this run green and left the trap armed for the next pattern anyone adds, so
   * the guard is what actually matters here: a mutation whose test did not RUN
   * is an aborted probe, never a result.
   */
  // "ran" means passed OR failed — a caught mutation reports `1 failed (1)` and
  // must not trip this guard. Only an all-`skipped` summary does.
  if (!/Tests\s+.*\b\d+ (passed|failed)/.test(outcome.output)) {
    console.error(
      `ABORT: "${mutation.expect}" ran no tests (\`-t\` is case-sensitive). ` +
        `Source restored; no result recorded.`,
    );
    process.exit(2);
  }

  if (outcome.passed) {
    console.log(`SURVIVED  ${mutation.name}`);
    survivors += 1;
  } else {
    console.log(`caught    ${mutation.name}`);
  }
}

console.log(
  `\n${MUTATIONS.length - survivors}/${MUTATIONS.length} caught, ${survivors} survived.`,
);
process.exit(survivors === 0 ? 0 : 1);
