/**
 * `artifact_operation` block (Sprint 2) — reuses S1's `KindCard` tokens.
 * Always top-level (excluded from subagent nesting in `transcript-model.ts`,
 * matching desktop exactly). `title: null` falls back to the kind label
 * (e.g. "Spec") — never a blank card. Live epic-doc title resolution is
 * S3's job.
 */
import { useState, type ReactElement } from "react";
import type { ArtifactOperationBlock as ArtifactOperationBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { useSnapshotDiff } from "@/host/use-snapshot-diff";
import { useArtifactNav } from "@/host/artifact-nav-context";
import { KIND_LABELS, type CardKind } from "../../kind-tokens";
import { colors, secondaryButton } from "../../ui";
import { DiffView } from "../diff-view";

const OPERATION_LABEL: Readonly<Record<ArtifactOperationBlockType["operation"], string>> = {
  create: "+",
  update: "●",
  delete: "−",
};

/** U1 fix: the card already carries `artifactId` (its own field, not a link href), so opening it needs no RPC resolve — a direct in-app nav, same as every other artifact-opening surface. */
export function ArtifactOperationBlock({
  block,
  epicId,
}: {
  readonly block: ArtifactOperationBlockType;
  readonly epicId: string;
}): ReactElement {
  const { openArtifact } = useArtifactNav();
  const kind = block.kind as CardKind;
  const title = block.title ?? KIND_LABELS[kind];
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff = block.beforeHash !== null || block.afterHash !== null;
  // A delete leaves nothing to open — the artifact is gone from the tree.
  const isOpenable = block.operation !== "delete";

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${colors.text}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div
        role={isOpenable ? "button" : undefined}
        tabIndex={isOpenable ? 0 : undefined}
        onClick={isOpenable ? () => openArtifact(epicId, block.artifactId) : undefined}
        onKeyDown={
          isOpenable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") openArtifact(epicId, block.artifactId);
              }
            : undefined
        }
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: isOpenable ? "pointer" : "default" }}
      >
        <span aria-hidden="true">{OPERATION_LABEL[block.operation]}</span>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ color: colors.muted, fontSize: 12 }}>{KIND_LABELS[kind]}</span>
      </div>
      {hasDiff && (
        <>
          <button
            type="button"
            style={{ ...secondaryButton, marginTop: 8 }}
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? "Hide diff" : "View diff"}
          </button>
          {showDiff && (
            <div style={{ marginTop: 8 }}>
              <ArtifactDiffPanel beforeHash={block.beforeHash} afterHash={block.afterHash} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ArtifactDiffPanel({
  beforeHash,
  afterHash,
}: {
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}): ReactElement {
  const query = useSnapshotDiff({ beforeHash, afterHash, enabled: true });

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
