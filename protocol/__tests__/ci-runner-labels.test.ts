import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guards every `runs-on:` in `.github/workflows/` against naming a runner
 * label that only exists inside one organization.
 *
 * This is a different failure from a job that goes red, and a worse one,
 * because it is silent in the CI UI. `.github/workflows/test.yml` sent the
 * four gui-app shards to `ubuntu-latest-8-cores`, a private larger-runner
 * label. Anywhere that label has no runner behind it the jobs are not
 * rejected and not failed — they are simply never scheduled. They sit in the
 * queue until GitHub's 24-hour limit and are then killed with "The job has
 * exceeded the maximum execution time while awaiting a runner". Measured on
 * this fork: run 31350441087 has every `ubuntu-latest` job finishing in
 * 24s-1m25s and all four gui-app jobs at exactly 24h0m0s, so the label is the
 * only variable. Not one Tests run on the fork has ever succeeded.
 *
 * What makes it hide is the surrounding machinery. `concurrency:
 * cancel-in-progress` cancels the stalled run as soon as anything else is
 * pushed, so the history reads `cancelled` — an operator's word — rather than
 * `never scheduled`. And the sibling gate,
 * `ci-test-matrix-coverage.test.ts`, checks that gui-app HAS a job; it
 * cannot see that the job never runs. A package with a job that is never
 * scheduled is indistinguishable, from every green leg around it, from a
 * package that is covered.
 *
 * The rule enforced here is that a runner label written as a literal must be
 * one GitHub hosts for everyone. A private runner is still allowed, but it
 * has to arrive through `vars.` with a literal fallback, so a repository
 * without the variable degrades to a runner that exists instead of to a
 * 24-hour queue.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

/**
 * Runner labels GitHub hosts for every account. Deliberately an exact list
 * rather than a prefix match: `ubuntu-latest-8-cores` starts with
 * `ubuntu-latest` and is exactly the thing being caught. A new hosted label
 * has to be added here on purpose, which is the intended friction.
 */
const HOSTED_LABELS = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "macos-latest",
  "macos-15",
  "macos-14",
  "windows-latest",
  "windows-2025",
  "windows-2022",
]);

interface RunsOn {
  file: string;
  line: number;
  value: string;
}

/** Every `runs-on:` in every workflow file, with enough context to name it. */
function runsOnDeclarations(): RunsOn[] {
  const found: RunsOn[] = [];
  for (const entry of readdirSync(WORKFLOW_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/.test(entry.name)) continue;
    const lines = readFileSync(
      path.join(WORKFLOW_DIR, entry.name),
      "utf8",
    ).split(/\r?\n/);
    lines.forEach((text, index) => {
      const match = /^\s*runs-on:\s*(.+?)\s*$/.exec(text);
      if (match) {
        found.push({ file: entry.name, line: index + 1, value: match[1] });
      }
    });
  }
  return found;
}

/**
 * The label literals a `runs-on:` value can resolve to.
 *
 * A bare value (`ubuntu-latest`) is itself the label. An `${{ ... }}`
 * expression is scanned for quoted strings instead: those are the only
 * literals it can evaluate to, and anything unquoted is a context lookup
 * (`vars.GUI_APP_RUNNER`) whose value is not knowable from the file. Quoted
 * strings that are expression operands rather than labels — the
 * `'traycer-clients-gui-app'` in a `matrix.project ==` comparison — are
 * dropped by keeping only the operands of `&&` / `||`, which is where a
 * `runs-on` expression can actually yield its result.
 */
function labelLiterals(value: string): string[] {
  if (!value.includes("${{")) return [value.replace(/^["']|["']$/g, "")];

  const literals: string[] = [];
  for (const expression of value.matchAll(/\$\{\{(.+?)\}\}/gs)) {
    const body = expression[1];
    // Split on the logical operators; a quoted string is a candidate label
    // only when it is a whole operand, never when it sits beside a `==`.
    for (const operand of body.split(/\|\||&&/)) {
      const trimmed = operand.replace(/[()]/g, "").trim();
      const quoted = /^["'](.*)["']$/.exec(trimmed);
      if (quoted) literals.push(quoted[1]);
    }
  }
  return literals;
}

describe("CI runner labels", () => {
  it("reads a plausible set of declarations, so agreement cannot be vacuous", () => {
    // A walk that found nothing, or a regex that stopped matching, would make
    // every assertion below pass against an empty list.
    const declarations = runsOnDeclarations();
    const files = new Set(declarations.map((d) => d.file));

    expect(declarations.length).toBeGreaterThanOrEqual(10);
    expect(files.size).toBeGreaterThanOrEqual(5);
    expect(files.has("test.yml")).toBe(true);

    // And the extraction has to actually resolve labels, not just find lines.
    const labels = declarations.flatMap((d) => labelLiterals(d.value));
    expect(labels).toContain("ubuntu-latest");
    expect(labels).toContain("macos-latest");
  });

  it("names only runner labels GitHub hosts for every account", () => {
    const offenders = runsOnDeclarations().flatMap((declaration) =>
      labelLiterals(declaration.value)
        .filter((label) => !HOSTED_LABELS.has(label))
        .map((label) => `${declaration.file}:${declaration.line} → ${label}`),
    );

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These \`runs-on:\` values name a runner label that is not hosted ` +
            `for every account: ${offenders.join(", ")}. A repository with no ` +
            `runner behind such a label does not fail the job — it queues for ` +
            `24 hours and is then killed, so the suite reads as red or ` +
            `cancelled while its tests have never run. Name the runner ` +
            `through a repository variable with a hosted fallback instead, ` +
            `e.g. \${{ vars.SOME_RUNNER || 'ubuntu-latest' }}.`,
    ).toEqual([]);
  });

  it("gives every variable-named runner a literal fallback", () => {
    // `runs-on: ${{ vars.SOME_RUNNER }}` on its own reintroduces the same
    // failure by a different route: unset, it evaluates to the empty string
    // and the job waits for a runner that can never answer.
    const unguarded = runsOnDeclarations()
      .filter((declaration) => /\bvars\./.test(declaration.value))
      .filter((declaration) => labelLiterals(declaration.value).length === 0)
      .map((declaration) => `${declaration.file}:${declaration.line}`);

    expect(
      unguarded,
      unguarded.length === 0
        ? ""
        : `These \`runs-on:\` values read a repository variable with no ` +
            `literal label to fall back to: ${unguarded.join(", ")}. Where ` +
            `the variable is unset the job queues until GitHub kills it. Add ` +
            `\`|| 'ubuntu-latest'\` (or another hosted label).`,
    ).toEqual([]);
  });
});
