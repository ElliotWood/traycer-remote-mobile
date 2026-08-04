/**
 * M5 items 3 + 4. The intents built here are parsed through the REAL
 * `worktreeIntentSchema` rather than compared field-by-field: this is a
 * discriminated union whose arms differ by one key, and a hand-comparison
 * would happily accept an object the host's validator rejects.
 *
 * Worktree fixtures parse through `worktreeHostEntrySchema` for the same
 * reason `repoIdentifier` keeps being mentioned — it is `{owner, repo}`, and
 * a literal that made it a string would produce a test passing against a
 * shape no host sends.
 */
import { describe, expect, it } from "vitest";
import {
  worktreeHostEntrySchema,
  worktreeIntentSchema,
  type WorktreeHostEntry,
} from "@traycer/protocol/host/worktree-schemas";
import {
  FOLDERLESS_TARGET,
  repoKey,
  selectableTargets,
  targetLabel,
  toEpicWorkspaceFields,
  toWorktreeIntent,
  type WorkspaceTarget,
} from "@/host/workspace-selection";

function hostEntry(overrides: Record<string, unknown>): WorktreeHostEntry {
  return worktreeHostEntrySchema.parse({
    worktreePath: "/src/wt/feature-a",
    repoLabel: "acme-web",
    repoIdentifier: { owner: "acme", repo: "acme-web" },
    branch: "feature-a",
    inUse: false,
    uncommittedCount: 0,
    gitRemovable: true,
    scripts: null,
    ...overrides,
  });
}

const RESOLVED = new Map([["acme/acme-web", "/src/acme-web"]]);

describe("selectableTargets", () => {
  it("always offers folderless FIRST and as a real option", () => {
    // M5 requires folderless stay "a first-class, clearly-labelled option, not
    // a hidden default".
    const targets = selectableTargets([], new Map());
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(FOLDERLESS_TARGET);
    expect(targetLabel(targets[0])).toBe("No repo (folderless)");
  });

  it("collapses many worktrees of one repo into a single repo row, keeping each worktree too", () => {
    const targets = selectableTargets(
      [
        hostEntry({ worktreePath: "/src/wt/a", branch: "a" }),
        hostEntry({ worktreePath: "/src/wt/b", branch: "b" }),
      ],
      RESOLVED,
    );
    expect(targets.filter((t) => t.kind === "repo")).toHaveLength(1);
    expect(targets.filter((t) => t.kind === "worktree")).toHaveLength(2);
  });

  it("OMITS a repo whose workspacePath did not resolve", () => {
    // Offering it would produce a row that can only fail at create time:
    // without workspacePath neither intent arm is constructible.
    const targets = selectableTargets([hostEntry({})], new Map());
    expect(targets).toEqual([FOLDERLESS_TARGET]);
  });

  it("OMITS a row with a null repoIdentifier — there is nothing to resolve it by", () => {
    const targets = selectableTargets([hostEntry({ repoIdentifier: null })], RESOLVED);
    expect(targets).toEqual([FOLDERLESS_TARGET]);
  });

  it("labels a branchless worktree by its DIRECTORY, never the full path", () => {
    // Found by photographing the picker against a real host: worktrees with a
    // null branch fell back to `worktreePath`, so rows rendered as three
    // wrapped lines of an absolute Windows path and overflowed. Unit tests
    // could not have caught it -- nothing was functionally wrong.
    const targets = selectableTargets(
      [
        hostEntry({
          branch: null,
          // `String.raw` so the backslashes are REAL separators. Written as a
          // plain literal they are escape sequences, and the fixture becomes a
          // path with no separators at all — which would have "passed" the
          // basename check without ever exercising it.
          worktreePath: String.raw`C:\Users\someone\.traycer\worktrees\acme__web\swift-cheetah`,
        }),
      ],
      RESOLVED,
    );
    const wt = targets.find((t) => t.kind === "worktree");
    const label = wt === undefined ? "" : targetLabel(wt);
    expect(label).toBe("acme-web · swift-cheetah");
    expect(label).not.toContain("\\");
  });

  it("falls back to the identifier's repo name when repoLabel is empty", () => {
    const targets = selectableTargets([hostEntry({ repoLabel: "" })], RESOLVED);
    const repo = targets.find((t) => t.kind === "repo");
    expect(repo === undefined ? null : targetLabel(repo)).toBe("acme-web");
  });
});

describe("toWorktreeIntent", () => {
  it("is null for folderless", () => {
    expect(toWorktreeIntent(FOLDERLESS_TARGET)).toBeNull();
  });

  it("builds a schema-valid `local` intent for a repo pick", () => {
    const target = selectableTargets([hostEntry({})], RESOLVED).find(
      (t) => t.kind === "repo",
    );
    const intent = toWorktreeIntent(target as WorkspaceTarget);
    // Through the real validator: the arms differ by one key, so a
    // field-by-field comparison would accept what the host rejects.
    const parsed = worktreeIntentSchema.parse(intent);
    expect(parsed.entries[0].kind).toBe("local");
    expect(parsed.entries[0].isPrimary).toBe(true);
    expect(parsed.entries[0].workspacePath).toBe("/src/acme-web");
  });

  it("builds a schema-valid `import` intent carrying worktreePath for a worktree pick", () => {
    // `import` ADOPTS an existing worktree — allowed here; the scope-out's
    // "importing" names the `worktree.import` RPC, a different object.
    const target = selectableTargets([hostEntry({})], RESOLVED).find(
      (t) => t.kind === "worktree",
    );
    const parsed = worktreeIntentSchema.parse(toWorktreeIntent(target as WorkspaceTarget));
    const entry = parsed.entries[0];
    expect(entry.kind).toBe("import");
    if (entry.kind !== "import") throw new Error("expected an import arm");
    expect(entry.worktreePath).toBe("/src/wt/feature-a");
    expect(entry.workspacePath).toBe("/src/acme-web");
  });

  it("never emits the `worktree` kind, which would CREATE one", () => {
    const targets = selectableTargets([hostEntry({})], RESOLVED);
    for (const target of targets) {
      const intent = toWorktreeIntent(target);
      if (intent === null) continue;
      for (const entry of intent.entries) {
        expect(entry.kind).not.toBe("worktree");
      }
    }
  });

  it("marks the single bound entry primary", () => {
    // A binding whose only entry is non-primary has no primary at all, and
    // every "the primary entry" read downstream assumes one exists.
    for (const target of selectableTargets([hostEntry({})], RESOLVED)) {
      const intent = toWorktreeIntent(target);
      if (intent === null) continue;
      expect(intent.entries.every((e) => e.isPrimary)).toBe(true);
    }
  });
});

describe("toEpicWorkspaceFields", () => {
  it("keeps the existing folderless triple byte-for-byte", () => {
    expect(toEpicWorkspaceFields(FOLDERLESS_TARGET)).toEqual({
      repoIdentifiers: [],
      workspaces: [],
      workspaceMode: "folderless",
    });
  });

  it("binds the repo and INHERITS rather than inventing a 'workspace' mode", () => {
    // `worktreeBindingWorkspaceModeSchema` is "inherit" | "folderless"; there
    // is no "workspace" member, which a first draft of this assumed.
    const target = selectableTargets([hostEntry({})], RESOLVED).find(
      (t) => t.kind === "repo",
    );
    const fields = toEpicWorkspaceFields(target as WorkspaceTarget);
    expect(fields.workspaces).toEqual([{ workspacePath: "/src/acme-web" }]);
    expect(fields.repoIdentifiers).toEqual([{ owner: "acme", repo: "acme-web" }]);
    expect(fields.workspaceMode).toBe("inherit");
  });
});

describe("repoKey", () => {
  it("distinguishes same-named repos under different owners", () => {
    // The reason the map is keyed on owner/repo rather than repo alone.
    expect(repoKey({ owner: "acme", repo: "web" })).not.toBe(
      repoKey({ owner: "other", repo: "web" }),
    );
  });
});
