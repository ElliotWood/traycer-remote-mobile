/**
 * Minimal client-side unified-line diff (Sprint 2) — deliberately NOT
 * `@pierre/diffs` (the heavy desktop-only diff component library). Computes
 * line-level add/del/context via the `diff` npm package and renders plain
 * colored rows, scroll-contained so a long line never breaks page width.
 */
import { diffLines } from "diff";
import { useMemo, type ReactElement } from "react";
import type { FileEditReason } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../ui";

const FILE_EDIT_REASON_COPY: Readonly<Record<FileEditReason, string>> = {
  snapshot: "",
  binary: "Binary file — no text diff available.",
  too_large: "File too large to diff.",
  blob_missing: "Snapshot content is no longer available on this host.",
  capture_failed: "The change's before/after content could not be captured.",
  not_intercepted: "This change predates diff capture — no content to show.",
  denied: "The edit was denied — the file was never changed.",
};

export interface DiffViewProps {
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly reason: FileEditReason;
}

export function DiffView({ beforeContent, afterContent, reason }: DiffViewProps): ReactElement {
  const lines = useMemo(() => {
    if (reason !== "snapshot") return null;
    return diffLines(beforeContent ?? "", afterContent ?? "");
  }, [beforeContent, afterContent, reason]);

  if (reason !== "snapshot" || lines === null) {
    return (
      <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
        {FILE_EDIT_REASON_COPY[reason]}
      </p>
    );
  }

  return (
    <pre
      data-testid="diff-view"
      style={{
        margin: 0,
        overflowX: "auto",
        maxWidth: "100%",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {lines.flatMap((part, partIndex) => {
        const rowColor = part.added ? "#3fb950" : part.removed ? "#f85149" : colors.muted;
        const prefix = part.added ? "+" : part.removed ? "-" : " ";
        const partLines = part.value.replace(/\n$/, "").split("\n");
        return partLines.map((line, lineIndex) => (
          <div key={`${partIndex}-${lineIndex}`} style={{ color: rowColor, whiteSpace: "pre" }}>
            {prefix} {line}
          </div>
        ));
      })}
    </pre>
  );
}
