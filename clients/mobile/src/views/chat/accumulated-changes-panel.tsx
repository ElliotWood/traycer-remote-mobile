/**
 * P2 — the lower dock's accumulated-changes panel (`ChatAccumulatedChangesPanel`
 * on desktop): cumulative file changes for the whole chat, file list +
 * totals, tap-to-expand per-file diff (reusing S2's `DiffView` — the
 * change's before/after content is already inline on the wire, no extra
 * RPC needed), and Undo-all. Per-row Undo / "Review all" cumulative-bundle
 * tile are deferred (Undo-all + list/totals + per-file diff is the P2
 * round-1 bar per the Evaluator's tighten).
 */
import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { ChatAccumulatedFileChange } from "@traycer/protocol/host/agent/gui/subscribe";
import { radius, theme, type } from "@/views/design-tokens";
import { computeLineDelta } from "./line-delta";
import { DiffView } from "./diff-view";

export interface AccumulatedChangesPanelProps {
  readonly changes: readonly ChatAccumulatedFileChange[];
  readonly canMutate: boolean;
  readonly undoAllPending: boolean;
  readonly onUndoAll: () => void;
}

function displayPath(change: ChatAccumulatedFileChange): string {
  return change.artifact?.title ?? change.filePath;
}

export function AccumulatedChangesPanel({
  changes,
  canMutate,
  undoAllPending,
  onUndoAll,
}: AccumulatedChangesPanelProps): ReactElement | null {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

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
          onClick={onUndoAll}
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

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {changes.map((change) => {
          const path = displayPath(change);
          const expanded = expandedPath === path;
          const delta = computeLineDelta(change.beforeContent, change.afterContent, change.reason);
          return (
            <li key={change.filePath} style={{ borderTop: `1px solid ${theme.borderHairline}` }}>
              <button
                type="button"
                onClick={() => setExpandedPath(expanded ? null : path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
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
    </div>
  );
}
