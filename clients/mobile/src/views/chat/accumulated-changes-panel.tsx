/**
 * P2 — the lower dock's accumulated-changes panel (`ChatAccumulatedChangesPanel`
 * on desktop): cumulative file changes for the whole chat, file list +
 * totals, tap-to-expand per-file diff (reusing S2's `DiffView` — the
 * change's before/after content is already inline on the wire, no extra
 * RPC needed), Undo-all and PER-ROW Undo (M6 items 1 + 3).
 *
 * ## Undo reports its outcome, and that is the substance of M6 item 1
 *
 * Both Undo controls dispatch through the correlated path, so `submitting`
 * ends on the host's `actionAck` rather than on a timer. Before this, Undo-all
 * cleared its own pending flag after 3s and a REJECTED revert was
 * indistinguishable from a successful one — the host's `reason` was on the
 * wire and discarded.
 *
 * That matters more here than almost anywhere else in the app, because the
 * panel cannot verify its own effect: `accumulatedFileChanges` omits any file
 * whose content equals its first snapshot, so a ROW DISAPPEARING is equally
 * consistent with a successful revert and with an unrelated edit happening to
 * restore the content. The ack is the only in-app evidence that the revert
 * itself was accepted; the filesystem is the only evidence of what it did.
 *
 * "Review all" (M6 item 2) is still deferred.
 */
import { useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { ChatAccumulatedFileChange } from "@traycer/protocol/host/agent/gui/subscribe";
import type { ReplyStatus } from "@/host/use-chat";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";
import { computeLineDelta } from "./line-delta";
import { DiffView } from "./diff-view";

export interface AccumulatedChangesPanelProps {
  readonly changes: readonly ChatAccumulatedFileChange[];
  readonly canMutate: boolean;
  /** Live status of the Undo-all dispatch — `undefined` when none is in flight. */
  readonly undoAllStatus: ReplyStatus | undefined;
  /** Live status of one row's Undo, keyed by `filePath`. */
  readonly undoStatusFor: (filePath: string) => ReplyStatus | undefined;
  readonly onUndoAll: () => void;
  readonly onUndoFile: (change: ChatAccumulatedFileChange) => void;
}

/** What a confirmation dialog is currently asking about. */
type PendingConfirm =
  | { readonly kind: "all" }
  | { readonly kind: "file"; readonly change: ChatAccumulatedFileChange };

function displayPath(change: ChatAccumulatedFileChange): string {
  return change.artifact?.title ?? change.filePath;
}

export function AccumulatedChangesPanel({
  changes,
  canMutate,
  undoAllStatus,
  undoStatusFor,
  onUndoAll,
  onUndoFile,
}: AccumulatedChangesPanelProps): ReactElement | null {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PendingConfirm | null>(null);
  const undoAllPending = undoAllStatus?.phase === "submitting";

  const totals = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const c of changes) {
      const delta = computeLineDelta(c.beforeContent, c.afterContent, c.reason);
      added += delta.added;
      deleted += delta.deleted;
    }
    return { added, deleted };
  }, [changes]);

  if (changes.length === 0) return null;

  return (
    <div
      style={{
        border: `1px solid ${theme.borderHairline}`,
        borderRadius: radius.lg,
        background: theme.surface,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
        <span style={{ ...type.bodySm, color: theme.text }}>
          {changes.length} file{changes.length === 1 ? "" : "s"} changed
          {" · "}
          <span style={{ color: theme.success }}>+{totals.added}</span>{" "}
          <span style={{ color: theme.danger }}>-{totals.deleted}</span>
        </span>
        <button
          type="button"
          disabled={!canMutate || undoAllPending}
          onClick={() => setConfirming({ kind: "all" })}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: canMutate ? theme.mutedText : theme.mutedText,
            opacity: canMutate && !undoAllPending ? 1 : 0.5,
            cursor: canMutate && !undoAllPending ? "pointer" : "default",
            ...type.bodyXs,
            padding: "4px 6px",
          }}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {undoAllPending ? "Undoing…" : "Undo all"}
        </button>
      </div>

      {undoAllStatus?.phase === "rejected" && (
        <FailureNote message={undoAllStatus.message} />
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {changes.map((change) => {
          const path = displayPath(change);
          const expanded = expandedPath === path;
          const delta = computeLineDelta(change.beforeContent, change.afterContent, change.reason);
          const rowStatus = undoStatusFor(change.filePath);
          return (
            <li key={change.filePath} style={{ borderTop: `1px solid ${theme.borderHairline}` }}>
              <div style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setExpandedPath(expanded ? null : path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 36,
                  padding: "0 10px",
                  border: "none",
                  background: "transparent",
                  color: theme.textRow,
                  fontSize: 12,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {expanded ? (
                  <ChevronDown size={13} color={theme.mutedText} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} color={theme.mutedText} aria-hidden="true" />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {path}
                </span>
                <span style={{ color: theme.success }}>+{delta.added}</span>
                <span style={{ color: theme.danger }}>-{delta.deleted}</span>
              </button>
              <RowUndoButton
                change={change}
                canMutate={canMutate}
                status={rowStatus}
                onAsk={() => setConfirming({ kind: "file", change })}
              />
              </div>
              {rowStatus?.phase === "rejected" && <FailureNote message={rowStatus.message} />}
              {expanded && (
                <div style={{ padding: "0 10px 10px 30px" }}>
                  <DiffView
                    beforeContent={change.beforeContent}
                    afterContent={change.afterContent}
                    reason={change.reason}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {confirming !== null && (
        <BottomSheet title="Undo changes?" onClose={() => setConfirming(null)}>
          <p style={{ ...type.bodySm, color: theme.text, margin: "4px 0 10px" }}>
            {confirming.kind === "all"
              ? `This discards the agent's edits to ${String(changes.length)} file${changes.length === 1 ? "" : "s"}.`
              : `This discards the agent's edits to ${displayPath(confirming.change)}.`}
          </p>
          {/* Desktop has an undo history and a filesystem to recover from. A
              phone has neither, so the destructive path is stated plainly
              rather than implied by an icon. */}
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 12px" }}>
            It cannot be undone from this device.
          </p>
          <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              style={confirmButtonStyle(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                // Closed BEFORE dispatching, so the control that opened it is
                // already gone: the double-tap this guards against is a second
                // tap on THIS button, and a sheet that outlived the dispatch
                // would still be offering one.
                const target = confirming;
                setConfirming(null);
                if (target.kind === "all") onUndoAll();
                else onUndoFile(target.change);
              }}
              style={confirmButtonStyle(true)}
            >
              Undo
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function confirmButtonStyle(destructive: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    border: `1px solid ${destructive ? theme.danger : theme.border}`,
    background: "transparent",
    color: destructive ? theme.danger : theme.text,
    ...type.bodySm,
    cursor: "pointer",
  };
}

/**
 * The host refused a revert, in its own words.
 *
 * `reason` is rendered rather than a generic string: "the file changed
 * underneath you" and "you do not own this chat" need different actions from
 * the user, and the wire already distinguishes them.
 */
function FailureNote({ message }: { readonly message: string }): ReactElement {
  return (
    <div
      data-testid="undo-failure"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        ...type.bodyXs,
        color: theme.danger,
        padding: "0 10px 8px",
      }}
    >
      <AlertTriangle size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{message}</span>
    </div>
  );
}

/**
 * One row's Undo.
 *
 * Disabled on `undoable: false` — the host says that first snapshot cannot be
 * restored, and offering a control that is known to fail is worse than not
 * offering one. Its pending state comes from the ack, so two rapid taps cannot
 * dispatch twice: the first tap disables the second.
 */
function RowUndoButton({
  change,
  canMutate,
  status,
  onAsk,
}: {
  readonly change: ChatAccumulatedFileChange;
  readonly canMutate: boolean;
  readonly status: ReplyStatus | undefined;
  readonly onAsk: () => void;
}): ReactElement {
  const pending = status?.phase === "submitting";
  const disabled = !canMutate || pending || !change.undoable;
  return (
    <button
      type="button"
      aria-label={`Undo changes to ${displayPath(change)}`}
      disabled={disabled}
      onClick={onAsk}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        minHeight: 36,
        padding: "0 10px",
        border: "none",
        background: "transparent",
        color: theme.mutedText,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        ...type.bodyXs,
      }}
    >
      <RotateCcw size={12} aria-hidden="true" />
      {pending ? "Undoing…" : "Undo"}
    </button>
  );
}
