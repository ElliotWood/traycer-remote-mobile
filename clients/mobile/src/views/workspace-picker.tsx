/**
 * M5 item 3 — pick an existing repo or worktree when creating an epic/agent
 * from the phone.
 *
 * Until this existed, every epic started from a phone was folderless
 * (`new-epic-view.tsx`'s old docblock said so plainly), which meant every
 * phone-started epic was one that could not touch code.
 *
 * ## Only pick-existing
 *
 * No create, no import-from-disk, no filesystem browser. The rows come from
 * worktrees the host already has. See the "not worth building" table in the
 * gap analysis: repo *setup* needs a view of the disk and somewhere to fix a
 * failed setup script, and neither exists on a phone.
 *
 * ## Folderless is a row, not an absence
 *
 * M5 requires it stay "a first-class, clearly-labelled option, not a hidden
 * default". It is the first row, always present, and still the initial
 * selection — but now visibly so, rather than by never having been asked.
 */
import { useState, type ReactElement } from "react";
import { Check, ChevronDown, FolderGit2, GitBranch, Slash } from "lucide-react";
import type { WorkspaceTarget } from "@/host/workspace-selection";
import { targetLabel } from "@/host/workspace-selection";
import type { WorkspaceTargetsPhase } from "@/host/use-workspace-targets";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";

export function WorkspacePicker({
  targets,
  phase,
  truncated,
  value,
  onChange,
  disabled,
}: {
  readonly targets: readonly WorkspaceTarget[];
  readonly phase: WorkspaceTargetsPhase;
  readonly truncated: boolean;
  readonly value: WorkspaceTarget;
  readonly onChange: (target: WorkspaceTarget) => void;
  readonly disabled: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const repos = targets.filter((t) => t.kind === "repo");
  const worktrees = targets.filter((t) => t.kind === "worktree");

  return (
    <>
      <button
        type="button"
        aria-label="Workspace"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          boxSizing: "border-box",
          minHeight: 40,
          padding: "0 12px",
          border: `1px solid ${theme.border}`,
          borderRadius: radius.row,
          background: "transparent",
          color: theme.text,
          ...type.bodySm,
          textAlign: "left",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {value.kind === "folderless" ? (
          <Slash size={14} aria-hidden="true" style={{ color: theme.mutedText, flexShrink: 0 }} />
        ) : (
          <FolderGit2 size={14} aria-hidden="true" style={{ color: theme.mutedText, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {targetLabel(value)}
        </span>
        <ChevronDown size={14} aria-hidden="true" style={{ color: theme.mutedText, flexShrink: 0 }} />
      </button>

      {open && (
        <BottomSheet title="Workspace" onClose={() => setOpen(false)}>
          {phase === "loading" && (
            <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px" }}>
              Looking up your host&rsquo;s repositories…
            </p>
          )}
          {/* An honest degrade: creation still works, folderless, and the
              reason the list is short is stated rather than implied. */}
          {phase === "error" && (
            <p style={{ ...type.bodySm, color: theme.mutedText, margin: "0 0 8px" }}>
              Couldn&rsquo;t read your host&rsquo;s repositories. You can still start without one.
            </p>
          )}

          <Row
            target={{ kind: "folderless" }}
            selected={value.kind === "folderless"}
            description="The agent runs without your code. Good for planning and questions."
            onPick={() => {
              onChange({ kind: "folderless" });
              setOpen(false);
            }}
          />

          {repos.length > 0 && <GroupHeading>Repositories</GroupHeading>}
          {repos.map((target) => (
            <Row
              key={`repo:${targetLabel(target)}`}
              target={target}
              selected={isSame(value, target)}
              description="Runs against the checked-out repository."
              onPick={() => {
                onChange(target);
                setOpen(false);
              }}
            />
          ))}

          {worktrees.length > 0 && <GroupHeading>Existing worktrees</GroupHeading>}
          {worktrees.map((target) => (
            <Row
              key={`wt:${target.kind === "worktree" ? target.worktreePath : ""}`}
              target={target}
              selected={isSame(value, target)}
              description={null}
              onPick={() => {
                onChange(target);
                setOpen(false);
              }}
            />
          ))}

          {truncated && (
            <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "8px 0 0" }}>
              Showing the first {String(repos.length + worktrees.length)} — your host has more.
            </p>
          )}
        </BottomSheet>
      )}
    </>
  );
}

/**
 * Identity by what the target BINDS to, not by object reference: the picker's
 * rows are rebuilt on every fetch, so a reference comparison would show
 * nothing selected after a refresh.
 */
function isSame(a: WorkspaceTarget, b: WorkspaceTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "folderless" || b.kind === "folderless") return true;
  if (a.kind === "worktree" && b.kind === "worktree") {
    return a.worktreePath === b.worktreePath;
  }
  return a.workspacePath === b.workspacePath;
}

function GroupHeading({ children }: { readonly children: string }): ReactElement {
  return (
    <p
      style={{
        ...type.bodyXs,
        color: theme.mutedText,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        margin: "12px 0 4px",
      }}
    >
      {children}
    </p>
  );
}

function Row({
  target,
  selected,
  description,
  onPick,
}: {
  readonly target: WorkspaceTarget;
  readonly selected: boolean;
  readonly description: string | null;
  readonly onPick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "10px 8px",
        border: "none",
        borderRadius: radius.md,
        background: selected ? theme.background : "transparent",
        color: theme.text,
        cursor: "pointer",
      }}
    >
      <span style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>
        {selected && <Check size={14} aria-hidden="true" />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...type.bodySm, display: "block", color: theme.text }}>
          {targetLabel(target)}
        </span>
        {target.kind === "worktree" && target.branch !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              ...type.bodyXs,
              color: theme.mutedText,
            }}
          >
            <GitBranch size={11} aria-hidden="true" />
            {target.branch}
          </span>
        )}
        {description !== null && (
          <span style={{ ...type.bodyXs, display: "block", color: theme.mutedText }}>
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
