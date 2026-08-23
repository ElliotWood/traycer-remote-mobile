import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guards the hand-maintained CI matrix in `.github/workflows/test.yml`
 * against the drift it has already suffered twice.
 *
 * That workflow runs one matrix job per nx project that owns a `test`
 * target. The list is written out by hand — it has to be, because the
 * jobs carry per-project configuration a derived matrix could not
 * supply (gui-app needs a larger runner and four deterministic shards;
 * `@traycer/protocol` needs a tag fetched before its schema oracle can
 * run). So the list cannot be generated, but it CAN be checked, and
 * that is what this file does.
 *
 * The failure it exists to catch is silent by construction: a package
 * that owns tests and has no matrix entry does not fail CI — **it is
 * simply never run**, and every job stays green. The workflow's own
 * comment records this happening once already ("an audit found these
 * projects own a `test` script and were absent from this list — test
 * files that had never run in CI. The first run caught a real failure")
 * and then predicts the recurrence: "This list is hand-maintained and
 * had silently drifted from the command in the comment above. If it
 * drifts again, prefer deriving it over re-syncing by hand."
 *
 * It drifted again. `@traycer-clients/remote` landed on `main` with a
 * `test` script and no job. This test is that comment's instruction
 * carried out in the only place it can be: the derivation runs as an
 * assertion rather than as a generator.
 *
 * The derivation deliberately mirrors nx's own project naming rather
 * than reading the nx graph: spawning nx from a unit test is slow and
 * couples this gate to a tool version. A project is named by its
 * `project.json` `name` when one exists (gui-app is the only such
 * project, and its nx name differs from its package scope), otherwise
 * by its `package.json` `name`. Checked against
 * `nx show projects --with-target test`: same nine, same spellings.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "test.yml");

/**
 * Expands the root `workspaces` globs into candidate package
 * directories. Only the two shapes this repo actually uses are
 * supported — a bare directory and a single trailing `/*` — and an
 * unrecognized shape throws rather than being skipped, so a future
 * workspace pattern cannot quietly shrink what this test looks at.
 */
function workspaceDirs(): string[] {
  const root = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  const globs = root.workspaces ?? [];
  expect(globs.length).toBeGreaterThan(0);

  return globs.flatMap((glob) => {
    if (glob.endsWith("/*")) {
      const parent = path.join(REPO_ROOT, glob.slice(0, -2));
      return readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(parent, entry.name));
    }
    if (!glob.includes("*")) return [path.join(REPO_ROOT, glob)];
    throw new Error(
      `Unsupported workspace pattern ${JSON.stringify(glob)} — teach ` +
        `workspaceDirs() how to expand it rather than letting it be skipped.`,
    );
  });
}

/** Every workspace project that owns a `test` script, by nx project name. */
function projectsOwningTests(): string[] {
  const names: string[] = [];
  for (const dir of workspaceDirs()) {
    const packageJson = path.join(dir, "package.json");
    if (!existsSync(packageJson)) continue;
    const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    if (!pkg.scripts?.test) continue;

    const projectJson = path.join(dir, "project.json");
    const nxName = existsSync(projectJson)
      ? (JSON.parse(readFileSync(projectJson, "utf8")) as { name?: string })
          .name
      : undefined;
    const name = nxName ?? pkg.name;
    if (name) names.push(name);
  }
  return names.sort();
}

/**
 * The distinct projects named by the workflow's matrix.
 *
 * `- project:` is matched across the whole file rather than scoped to
 * the `test` job's `include:` block, because it is the matrix's own
 * key and appears nowhere else — the macOS packaging job names
 * `@traycer-clients/desktop` inline in a `run:` step, not as a matrix
 * entry. Deduplicated, since gui-app contributes four sharded jobs.
 */
function matrixProjects(): string[] {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const named = [...yaml.matchAll(/^\s*-\s*project:\s*(.+?)\s*$/gm)].map(
    (match) => match[1].replace(/^["']|["']$/g, ""),
  );
  return [...new Set(named)].sort();
}

describe("CI test matrix", () => {
  it("derives a plausible project set, so agreement cannot be vacuous", () => {
    // A walk that silently found nothing would make every assertion
    // below pass against an empty set. Pin both ends to real counts.
    const derived = projectsOwningTests();
    const matrix = matrixProjects();

    expect(derived.length).toBeGreaterThanOrEqual(8);
    expect(matrix.length).toBeGreaterThanOrEqual(8);
    expect(derived).toContain("@traycer/protocol");
    expect(derived).toContain("traycer-clients-gui-app");
  });

  it("runs every project that owns a `test` script", () => {
    const matrix = new Set(matrixProjects());
    const missing = projectsOwningTests().filter((name) => !matrix.has(name));

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These projects own a \`test\` script and have no job in ` +
            `.github/workflows/test.yml, so their tests never run in CI: ` +
            `${missing.join(", ")}. Add a matrix entry for each.`,
    ).toEqual([]);
  });

  it("names no project that has stopped owning tests", () => {
    const derived = new Set(projectsOwningTests());
    const stale = matrixProjects().filter((name) => !derived.has(name));

    expect(
      stale,
      stale.length === 0
        ? ""
        : `.github/workflows/test.yml runs these projects, but no ` +
            `workspace package owns a \`test\` script under that nx name: ` +
            `${stale.join(", ")}. A renamed or deleted package leaves a job ` +
            `that tests nothing. Remove or correct each entry.`,
    ).toEqual([]);
  });
});
