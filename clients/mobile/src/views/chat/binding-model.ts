/**
 * M5 — pure projections of a chat's `worktreeBinding` for the binding chip and
 * its sheet. Separated from the component so each rule can be tested without a
 * DOM, and so the "which entry are we even talking about" question has one
 * answer rather than one per render site.
 *
 * What the old `branch-chip.tsx` lost, and this recovers:
 *   - **every** entry, not just the primary. A chat bound to two repos rendered
 *     as single-repo, silently.
 *   - `repoIdentifier` / `worktreePath`, which were on the wire and unshown.
 *   - `setupState`: a worktree whose setup script FAILED was indistinguishable
 *     from a healthy one.
 */
import { pathBasename } from "@/host/path-basename";
import type {
  WorktreeBinding,
  WorktreeBindingEntry,
} from "@traycer/protocol/host/worktree-schemas";

export { pathBasename };


/**
 * The repo name for an entry.
 *
 * `repoIdentifier` is STRUCTURED `{owner, repo}` (`taskRepoIdentifierSchema`),
 * not a string — worth stating because reading it as a string yields
 * `undefined` rather than an error, and the row then silently falls back.
 * Prefers the bare repo name over `owner/repo`: on a phone chip the owner is
 * usually the same for every row and costs the width that distinguishes them.
 *
 * Falls back to the `workspacePath` basename, which is what the ticket asks
 * for and is a real case — `repoIdentifier` is nullable on the wire.
 */
export function repoLabelForEntry(entry: WorktreeBindingEntry): string {
  const id = entry.repoIdentifier;
  if (id !== null) return id.repo;
  return pathBasename(entry.workspacePath);
}

/**
 * The worktree's own name, or `null` when this entry is not a worktree.
 *
 * Suppressed when it would merely repeat the repo label: an entry running
 * against the checkout itself often has a `worktreePath` whose basename IS the
 * repo directory, and rendering "traycer-mobile · traycer-mobile · main" is
 * noise that reads as a bug.
 */
export function worktreeNameForEntry(
  entry: WorktreeBindingEntry,
): string | null {
  if (entry.worktreePath === null) return null;
  const name = pathBasename(entry.worktreePath);
  if (name.length === 0) return null;
  return name === repoLabelForEntry(entry) ? null : name;
}

/**
 * Setup states that mean "this worktree is not ready, and the user should know".
 *
 * `not_required` and `succeeded` are healthy. `pending` / `running` are
 * in-progress rather than broken, so they are reported separately — telling
 * someone their setup script is *running* is useful; colouring it like a
 * failure is not.
 */
export type SetupHealth = "healthy" | "in_progress" | "unhealthy";

export function setupHealthForEntry(entry: WorktreeBindingEntry): SetupHealth {
  switch (entry.setupState) {
    case "failed":
    case "cancelled":
      return "unhealthy";
    case "pending":
    case "running":
      return "in_progress";
    default:
      return "healthy";
  }
}

/**
 * A one-line explanation of a non-healthy entry, or `null` when it is fine.
 *
 * `setupExitCode` is included when present because "the setup script failed"
 * and "the setup script failed with exit 127" are different amounts of help,
 * and 127 in particular says "command not found" to anyone who has met a shell.
 */
export function setupDetailForEntry(entry: WorktreeBindingEntry): string | null {
  const health = setupHealthForEntry(entry);
  if (health === "healthy") return null;
  if (health === "in_progress") {
    return entry.setupState === "running"
      ? "Setup script is running…"
      : "Setup script hasn't run yet.";
  }
  const base =
    entry.setupState === "cancelled"
      ? "Setup script was cancelled."
      : "Setup script failed.";
  return entry.setupExitCode === null
    ? base
    : `${base} Exit code ${String(entry.setupExitCode)}.`;
}

/** Entries ordered for display: primary first, everything else in wire order. */
export function orderedEntries(
  binding: WorktreeBinding | null,
): readonly WorktreeBindingEntry[] {
  if (binding === null) return [];
  const primary = binding.entries.filter((e) => e.isPrimary);
  const rest = binding.entries.filter((e) => !e.isPrimary);
  return [...primary, ...rest];
}

/**
 * Whether an entry's worktree is absent from the host's disk.
 *
 * Compared against `worktreePath` AND `workspacePath`: the existing
 * missing-path signal is reported per path by the host, and an entry running
 * locally has no `worktreePath` to match on at all — checking only the former
 * would silently never flag a `local`-mode entry.
 */
export function isMissingOnDisk(
  entry: WorktreeBindingEntry,
  missingWorktreePaths: readonly string[],
): boolean {
  if (missingWorktreePaths.length === 0) return false;
  return missingWorktreePaths.some(
    (p) => p === entry.worktreePath || p === entry.workspacePath,
  );
}

export interface BindingSummary {
  /** Repo name of the entry the chip represents. */
  readonly repo: string;
  readonly worktree: string | null;
  readonly branch: string | null;
  /** How many entries beyond the one shown — drives the "+N" affordance. */
  readonly additionalCount: number;
  readonly anyUnhealthy: boolean;
  readonly anyMissing: boolean;
}

/**
 * What the collapsed chip shows. `null` when there is no binding at all — a
 * folderless chat renders no chip, exactly as `branchLabel` used to return
 * `null`.
 */
export function bindingSummary(
  binding: WorktreeBinding | null,
  missingWorktreePaths: readonly string[],
): BindingSummary | null {
  const entries = orderedEntries(binding);
  const head = entries[0];
  if (head === undefined) return null;
  return {
    repo: repoLabelForEntry(head),
    worktree: worktreeNameForEntry(head),
    branch: head.branch,
    additionalCount: entries.length - 1,
    // Across ALL entries, not just the one displayed: the chip is the only
    // thing on screen until it is tapped, so a failure on the second repo has
    // to be visible from the first.
    anyUnhealthy: entries.some((e) => setupHealthForEntry(e) === "unhealthy"),
    anyMissing: entries.some((e) => isMissingOnDisk(e, missingWorktreePaths)),
  };
}
