/**
 * M5 items 3 + 4 — turning "what the user tapped" into the shapes
 * `epic.create` and `epic.createChat` actually accept.
 *
 * ## The two-step the ticket does not mention
 *
 * M5 sources the picker from `worktree.listAllForHost` and then says to pass
 * the pick as `worktreeIntent`. That cannot be done from that RPC alone:
 * `worktreeHostEntrySchema` carries `worktreePath` / `repoIdentifier` /
 * `repoLabel` / `branch` and **no `workspacePath`**, while every arm of
 * `worktreeFolderIntentSchema` requires `workspacePath` in its base shape
 * (`worktree-schemas.ts:189-193`).
 *
 * The bridge is `workspace.resolvePathsByRepoIdentifiers` (also in the released
 * floor), returning `{repoIdentifier, workspacePath}`. Verified against a real
 * host: 28 worktrees → 4 distinct repos → 4 of 4 resolved. A repo that does
 * NOT resolve cannot be turned into an intent, so it must not be offered —
 * see `selectableTargets`.
 *
 * ## Why `kind: "import"` is allowed here
 *
 * M5's scope-out forbids "Creating, **importing**, or staging worktrees" and
 * lists `worktree.create / createPaths / import / retrySetup`. **Those are RPC
 * names.** `kind: "import"` on a `worktreeFolderIntent` is a different object
 * that shares the word: it ADOPTS a worktree that already exists at
 * `worktreePath`, creates nothing, touches no disk and can fail no setup
 * script. The scope-out's stated rationale — repo setup needs a view of the
 * disk and a place to fix a failed setup script — does not reach it.
 * Ratified by the parent before this was written.
 *
 * `kind: "worktree"` stays out: that one creates.
 */
import type {
  CreateEpicWorkspaceIdentifier,
  TaskRepoIdentifier,
} from "@traycer/protocol/host/epic/unary-schemas";
import type {
  WorktreeBindingWorkspaceMode,
  WorktreeHostEntry,
  WorktreeIntent,
} from "@traycer/protocol/host/worktree-schemas";

/** Canonical key for a structured repo identifier. Not a display label. */
export function repoKey(id: TaskRepoIdentifier): string {
  return `${id.owner}/${id.repo}`;
}

/**
 * What the user picked.
 *
 * `folderless` is a first-class member rather than "no selection", because M5
 * requires it stay "a first-class, clearly-labelled option, not a hidden
 * default" — and modelling it as `null` is exactly how it became a hidden
 * default in the first place.
 */
export type WorkspaceTarget =
  | { readonly kind: "folderless" }
  | {
      readonly kind: "repo";
      readonly repoIdentifier: TaskRepoIdentifier;
      readonly workspacePath: string;
      readonly label: string;
    }
  | {
      readonly kind: "worktree";
      readonly repoIdentifier: TaskRepoIdentifier;
      readonly workspacePath: string;
      readonly worktreePath: string;
      readonly branch: string | null;
      readonly label: string;
    };

export const FOLDERLESS_TARGET: WorkspaceTarget = { kind: "folderless" };

/**
 * The pickable targets, given the host's worktrees and the resolved
 * repo→workspace map.
 *
 * A repo whose `workspacePath` did not resolve is OMITTED, not shown-and-
 * broken: without it neither intent arm can be constructed, so offering it
 * would produce a row that fails only at create time. `repoIdentifier: null`
 * rows are omitted for the same reason — there is nothing to resolve them by.
 */
export function selectableTargets(
  worktrees: readonly WorktreeHostEntry[],
  workspacePathByRepo: ReadonlyMap<string, string>,
): readonly WorkspaceTarget[] {
  const repos = new Map<string, WorkspaceTarget>();
  const worktreeTargets: WorkspaceTarget[] = [];

  for (const entry of worktrees) {
    const id = entry.repoIdentifier;
    if (id === null) continue;
    const key = repoKey(id);
    const workspacePath = workspacePathByRepo.get(key);
    if (workspacePath === undefined) continue;

    if (!repos.has(key)) {
      repos.set(key, {
        kind: "repo",
        repoIdentifier: id,
        workspacePath,
        label: entry.repoLabel.length > 0 ? entry.repoLabel : id.repo,
      });
    }
    worktreeTargets.push({
      kind: "worktree",
      repoIdentifier: id,
      workspacePath,
      worktreePath: entry.worktreePath,
      branch: entry.branch,
      label: entry.branch ?? entry.worktreePath,
    });
  }

  // Repos first: picking "the repo" is the common case, and a phone list
  // headed by 28 worktrees buries it.
  return [FOLDERLESS_TARGET, ...repos.values(), ...worktreeTargets];
}

/**
 * The `worktreeIntent` for a target, or `null` for folderless.
 *
 * `isPrimary: true` on the single entry: these flows bind exactly one folder,
 * and a binding whose only entry is non-primary has no primary at all — which
 * is what `orderedEntries` and every "the primary entry" read downstream
 * assume exists.
 */
export function toWorktreeIntent(target: WorkspaceTarget): WorktreeIntent | null {
  if (target.kind === "folderless") return null;
  if (target.kind === "repo") {
    return {
      entries: [
        {
          kind: "local",
          workspacePath: target.workspacePath,
          repoIdentifier: target.repoIdentifier,
          isPrimary: true,
        },
      ],
    };
  }
  return {
    entries: [
      {
        kind: "import",
        workspacePath: target.workspacePath,
        repoIdentifier: target.repoIdentifier,
        isPrimary: true,
        worktreePath: target.worktreePath,
      },
    ],
  };
}

export interface EpicWorkspaceFields {
  readonly repoIdentifiers: readonly TaskRepoIdentifier[];
  /**
   * `createEpicRequestSchema.workspaces` is an array of
   * `{workspacePath}` OBJECTS, not bare strings — a plain path array
   * typechecks nowhere and would have failed validation at the host.
   */
  readonly workspaces: readonly CreateEpicWorkspaceIdentifier[];
  /**
   * `worktreeBindingWorkspaceModeSchema` is `"inherit" | "folderless"` — there
   * is no `"workspace"` member. A bound epic's seed chat therefore INHERITS
   * the workspaces the epic was created with, rather than restating them.
   */
  readonly workspaceMode: WorktreeBindingWorkspaceMode;
}

/**
 * `epic.create`'s `repoIdentifiers` / `workspaces` / `workspaceMode` for a
 * target. Folderless keeps the exact triple the phone sends today, so that
 * path is unchanged rather than re-derived.
 */
export function toEpicWorkspaceFields(
  target: WorkspaceTarget,
): EpicWorkspaceFields {
  if (target.kind === "folderless") {
    return { repoIdentifiers: [], workspaces: [], workspaceMode: "folderless" };
  }
  return {
    repoIdentifiers: [target.repoIdentifier],
    workspaces: [{ workspacePath: target.workspacePath }],
    workspaceMode: "inherit",
  };
}

/** Human label for a target, used by the picker and the create screens' summary line. */
export function targetLabel(target: WorkspaceTarget): string {
  if (target.kind === "folderless") return "No repo (folderless)";
  if (target.kind === "repo") return target.label;
  return `${target.repoIdentifier.repo} · ${target.label}`;
}
