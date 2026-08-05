/**
 * M5 items 1 + 2 — the chat's whole worktree binding, not just its branch.
 *
 * Replaces `branch-chip.tsx`, which reduced the binding to `primary.branch`
 * and so lost two things that were already on the wire:
 *   - **multi-entry bindings.** A chat bound to two repos rendered identically
 *     to a single-repo one. The bug is invisible with one entry, which is why
 *     the chip now states the count rather than only the head.
 *   - **`setupState`.** A worktree whose setup script failed was
 *     indistinguishable from a healthy one. The chip already had a red state
 *     for missing-on-disk, so the affordance existed — it just watched one
 *     signal and not the other.
 *
 * All projection rules live in `binding-model.ts` so they can be tested
 * without a DOM.
 */
import { AlertTriangle, GitBranch, type LucideIcon } from "lucide-react";
import { useState, type ReactElement } from "react";
import type {
  WorktreeBinding,
  WorktreeBindingEntry,
} from "@traycer/protocol/host/worktree-schemas";
import {
  bindingSummary,
  isMissingOnDisk,
  orderedEntries,
  repoLabelForEntry,
  setupDetailForEntry,
  setupHealthForEntry,
  worktreeNameForEntry,
} from "@/views/chat/binding-model";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";

/**
 * Kept as a named export because callers outside this file still ask "what
 * branch is this chat on" for compact surfaces. It is now derived from the
 * same ordering the chip uses, rather than re-deriving "the primary entry"
 * independently.
 */
export function branchLabel(binding: WorktreeBinding | null): string | null {
  return orderedEntries(binding)[0]?.branch ?? null;
}

export function BindingChip({
  binding,
  missingWorktreePaths,
}: {
  readonly binding: WorktreeBinding | null;
  readonly missingWorktreePaths: readonly string[];
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const summary = bindingSummary(binding, missingWorktreePaths);
  // No binding at all — a folderless chat. Render nothing, as before.
  if (summary === null) return null;

  const alarming = summary.anyMissing || summary.anyUnhealthy;
  const parts = [summary.repo, summary.worktree, summary.branch].filter(
    (p): p is string => p !== null && p.length > 0,
  );

  return (
    <>
      <button
        type="button"
        aria-label="Workspace binding"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          ...type.bodyXs,
          border: "none",
          background: "transparent",
          padding: 0,
          color: alarming ? theme.danger : theme.mutedText,
          whiteSpace: "nowrap",
          cursor: "pointer",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {alarming ? (
          <AlertTriangle size={12} aria-hidden="true" />
        ) : (
          <GitBranch size={12} aria-hidden="true" />
        )}
        {parts.join(" · ")}
        {/* The count is the whole point: a two-repo chat must not look like a
            one-repo chat even before the sheet is opened. */}
        {summary.additionalCount > 0 && ` +${String(summary.additionalCount)}`}
      </button>
      {open && (
        <BottomSheet title="Workspace" onClose={() => setOpen(false)}>
          {orderedEntries(binding).map((entry) => (
            <BindingEntryRow
              key={`${entry.workspacePath}:${entry.worktreePath ?? ""}`}
              entry={entry}
              missing={isMissingOnDisk(entry, missingWorktreePaths)}
            />
          ))}
        </BottomSheet>
      )}
    </>
  );
}

function BindingEntryRow({
  entry,
  missing,
}: {
  readonly entry: WorktreeBindingEntry;
  readonly missing: boolean;
}): ReactElement {
  const health = setupHealthForEntry(entry);
  const detail = setupDetailForEntry(entry);
  const worktree = worktreeNameForEntry(entry);
  const noteColor = health === "unhealthy" ? theme.danger : theme.mutedText;

  return (
    <div
      style={{
        padding: "10px 0",
        borderBottom: `1px solid ${theme.borderHairline}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...type.bodySm, color: theme.text }}>
          {repoLabelForEntry(entry)}
        </span>
        {entry.isPrimary && (
          <span
            style={{
              ...type.bodyXs,
              color: theme.mutedText,
              border: `1px solid ${theme.border}`,
              borderRadius: radius.sm,
              padding: "0 4px",
            }}
          >
            Primary
          </span>
        )}
      </div>
      {worktree !== null && (
        <div style={{ ...type.bodyXs, color: theme.mutedText, marginTop: 2 }}>
          {worktree}
        </div>
      )}
      {entry.branch !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            ...type.bodyXs,
            color: theme.mutedText,
            marginTop: 2,
          }}
        >
          <GitBranch size={11} aria-hidden="true" />
          {entry.branch}
        </div>
      )}
      {/* Two INDEPENDENT signals. The old chip watched only the first, so a
          failed setup script rendered as healthy. Both are shown because they
          have different causes and different fixes. */}
      {missing && (
        <Note icon={AlertTriangle} color={theme.danger}>
          This workspace is missing on the host&rsquo;s disk.
        </Note>
      )}
      {detail !== null && (
        <Note icon={AlertTriangle} color={noteColor}>
          {detail}
        </Note>
      )}
    </div>
  );
}

function Note({
  icon: Icon,
  color,
  children,
}: {
  readonly icon: LucideIcon;
  readonly color: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        ...type.bodyXs,
        color,
        marginTop: 4,
      }}
    >
      <Icon size={11} aria-hidden="true" />
      {children}
    </div>
  );
}
