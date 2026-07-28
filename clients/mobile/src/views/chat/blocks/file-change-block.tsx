/**
 * `file_change` block (Sprint 2). Header shows verb + path + the persisted
 * `+N/-M` counts (no fetch needed for those); body (on expand) lazy-fetches
 * `snapshots.readSnapshotDiff` and renders a minimal line diff.
 */
import { memo, type ReactElement } from "react";
import type { FileChangeBlock as FileChangeBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { useSnapshotDiff } from "@/host/use-snapshot-diff";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";
import { StatusBadge } from "../status-badge";
import { DiffView } from "../diff-view";

function verb(operation: string): string {
  const op = operation.toLowerCase();
  if (op.includes("create") || op.includes("write")) return "Create";
  if (op.includes("delete") || op.includes("remove")) return "Delete";
  return "Edit";
}

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const FileChangeBlock = memo(function FileChangeBlock({
  block,
}: {
  readonly block: FileChangeBlockType;
}): ReactElement {
  const isDeniedOrFailed = block.reason === "denied" || block.status === "errored";

  const header = (
    <>
      <span style={{ fontWeight: 600 }}>{verb(block.operation)}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12,
        }}
      >
        {block.filePath}
      </span>
      {isDeniedOrFailed ? (
        <span style={{ color: colors.danger, fontSize: 11 }}>
          {block.reason === "denied" ? "denied" : "failed"}
        </span>
      ) : (
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
          <span style={{ color: "#3fb950" }}>+{block.additions}</span>{" "}
          <span style={{ color: "#f85149" }}>-{block.deletions}</span>
        </span>
      )}
      <StatusBadge status={block.status} />
    </>
  );

  return (
    <CollapsibleCard header={header}>
      <FileChangeDiffPanel block={block} />
    </CollapsibleCard>
  );
});

function FileChangeDiffPanel({ block }: { readonly block: FileChangeBlockType }): ReactElement {
  const query = useSnapshotDiff({
    beforeHash: block.beforeHash,
    afterHash: block.afterHash,
    enabled: true,
  });

  if (query.isPending) {
    return <p style={{ color: colors.muted, fontSize: 13 }}>Loading diff…</p>;
  }
  if (query.isError || query.data === undefined) {
    return <p style={{ color: colors.danger, fontSize: 13 }}>Failed to load diff.</p>;
  }
  return (
    <DiffView
      beforeContent={query.data.beforeContent}
      afterContent={query.data.afterContent}
      reason={query.data.reason}
    />
  );
}
