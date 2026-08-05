/**
 * P2 — READ-ONLY branch/workspace chip. Desktop's `HostWorkspaceSelector` is
 * a full create/import/worktree-staging subsystem tied to local git tooling
 * on the desktop host — not portable. This shows the CURRENT binding's
 * branch (from `chatSnapshotSchema.worktreeBinding`, already on the wire),
 * nothing more; no switch/create affordance this round (P2 contract).
 */
import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";
import type { WorktreeBinding } from "@traycer/protocol/host/worktree-schemas";
import { theme, type } from "@/views/design-tokens";

export function branchLabel(binding: WorktreeBinding | null): string | null {
  if (binding === null || binding.entries.length === 0) return null;
  const primary = binding.entries.find((e) => e.isPrimary) ?? binding.entries[0];
  if (primary === undefined) return null;
  return primary.branch;
}

export function BranchChip({
  binding,
  missingWorktreePaths,
}: {
  readonly binding: WorktreeBinding | null;
  readonly missingWorktreePaths: readonly string[];
}): ReactElement | null {
  const branch = branchLabel(binding);
  if (branch === null) return null;
  const missing = missingWorktreePaths.length > 0;
  return (
    <span
      title={missing ? "This chat's workspace is missing on disk" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        ...type.bodyXs,
        color: missing ? theme.danger : theme.mutedText,
        whiteSpace: "nowrap",
      }}
    >
      <GitBranch size={12} aria-hidden="true" />
      {branch}
    </span>
  );
}
