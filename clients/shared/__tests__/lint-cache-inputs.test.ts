import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Lives here rather than under a feature folder because its subject is the
// workspace lint gate itself, alongside `host-lifecycle-eslint-boundary.test.ts`
// — the other test in this directory whose subject is eslint rather than a
// module.
//
// ## What went wrong, and why a comment would not have been enough
//
// Every package's `eslint.config.mjs` imports its rules from `eslint/*.mjs` at
// the workspace root. `nx.json` declared the `lint` target's inputs as
// `{projectRoot}` globs only, so *no* rule file was an input to *any* lint
// task. Editing a rule therefore invalidated nothing, and every project
// replayed a cached green from before the rule existed.
//
// Measured, not argued: a `TemplateLiteral` ban added to
// `eslint/traycer-type-safety-rules.mjs` left `nx run
// @traycer-clients/teams-bot:lint` **passing from cache**, while the same tree
// under `--skip-nx-cache` reported **161 errors**. Nx itself then labelled the
// task *flaky* — one cache key, two outcomes — which is the tool reporting a
// key that does not cover its inputs.
//
// The fix is one entry in `nx.json`. This test exists because a one-line fix
// to a cache key is invisible: nothing in a normal run tells you it has been
// removed, and the symptom is a gate that passes.
//
// ## Why this asserts coverage rather than the string
//
// Asserting that `inputs` contains `"sharedLintRules"` would be a copy of the
// config, green the moment someone renames the named input while breaking it.
// This walks the real `eslint/` directory and requires every file in it to be
// matched by some `{workspaceRoot}`-anchored glob the `lint` target actually
// resolves to — so a rule file added to a directory nobody thought to cover
// fails here.

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(THIS_DIR, "..", "..", "..");
const SHARED_ESLINT_DIR = join(WORKSPACE_ROOT, "eslint");
const WORKSPACE_ROOT_TOKEN = "{workspaceRoot}/";

type NxInput = string | Record<string, unknown>;

interface NxJson {
  readonly namedInputs?: Record<string, readonly NxInput[]>;
  readonly targetDefaults?: Record<string, { readonly inputs?: readonly NxInput[] }>;
}

function readNxJson(): NxJson {
  return JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, "nx.json"), "utf8"),
  ) as NxJson;
}

// Resolve a target's `inputs` through `namedInputs`, keeping only the
// workspace-root-anchored globs. Named inputs may reference other named
// inputs, so this walks rather than expanding one level; `seen` makes a
// cyclic definition terminate instead of hanging the suite.
function resolveWorkspaceRootGlobs(
  inputs: readonly NxInput[],
  namedInputs: Record<string, readonly NxInput[]>,
  seen: Set<string>,
): readonly string[] {
  const globs: string[] = [];
  for (const input of inputs) {
    if (typeof input !== "string") continue;
    if (input.startsWith(WORKSPACE_ROOT_TOKEN)) {
      globs.push(input.slice(WORKSPACE_ROOT_TOKEN.length));
      continue;
    }
    const named = namedInputs[input];
    if (named === undefined || seen.has(input)) continue;
    seen.add(input);
    globs.push(...resolveWorkspaceRootGlobs(named, namedInputs, seen));
  }
  return globs;
}

function sharedRuleFilesRelativeToRoot(): readonly string[] {
  return readdirSync(SHARED_ESLINT_DIR, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(WORKSPACE_ROOT, join(entry.parentPath, entry.name)).split(sep).join("/"),
    );
}

describe("the lint gate can see the rules it lints with", () => {
  const nxJson = readNxJson();
  const lintInputs = nxJson.targetDefaults?.["lint"]?.inputs ?? [];
  const workspaceGlobs = resolveWorkspaceRootGlobs(
    lintInputs,
    nxJson.namedInputs ?? {},
    new Set<string>(),
  );
  const ruleFiles = sharedRuleFilesRelativeToRoot();

  // Vacuity guards. Both halves of this test are derived — one from a JSON
  // path, one from a directory walk — and either returning nothing would make
  // the `it.each` below a green suite that checked no file at all.
  it("found the shared rule files it is supposed to be checking", () => {
    expect(ruleFiles.length).toBeGreaterThan(0);
    expect(ruleFiles).toContain("eslint/traycer-type-safety-rules.mjs");
  });

  it("found at least one workspace-anchored glob on the lint target", () => {
    expect(lintInputs.length).toBeGreaterThan(0);
    expect(workspaceGlobs.length).toBeGreaterThan(0);
  });

  it.each(ruleFiles)(
    "%s is an input to every lint task, so changing it busts the cache",
    (ruleFile) => {
      const matching = workspaceGlobs.filter((glob) =>
        matchesGlob(ruleFile, glob),
      );
      expect(matching).not.toHaveLength(0);
    },
  );
});
