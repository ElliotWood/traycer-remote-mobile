/**
 * `artifact_operation` — an artifact was created, updated or deleted.
 *
 * Always top level. `buildBlockTree` deliberately excludes this kind from
 * subagent nesting, matching desktop: an artifact change is a fact about the
 * epic, not about the agent that happened to make it.
 *
 * `title: null` falls back to the artifact KIND rather than rendering a blank
 * card — the reader still learns a spec changed even when the title has not
 * projected yet.
 */
import { useState, type ReactElement } from "react";
import { Body1, Button, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { ArtifactOperationBlock as ArtifactOperationBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { StaticCard } from "./block-card";
import { DiffView } from "./diff-view";
import { useSnapshotDiff, type SnapshotDiffClient } from "./use-snapshot-diff";

const OPERATION_MARK: Readonly<
  Record<ArtifactOperationBlockType["operation"], string>
> = {
  create: "+",
  update: "●",
  delete: "−",
};

const useStyles = makeStyles({
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
  },
  title: { fontWeight: tokens.fontWeightSemibold },
  kind: { color: tokens.colorNeutralForeground3 },
  toggle: { marginTop: tokens.spacingVerticalS },
  panel: { marginTop: tokens.spacingVerticalS },
  note: { color: tokens.colorNeutralForeground3, margin: 0 },
  failed: { color: tokens.colorPaletteRedForeground1, margin: 0 },
});

export function ArtifactOperationBlock({
  block,
  client,
}: {
  readonly block: ArtifactOperationBlockType;
  readonly client: SnapshotDiffClient | null;
}): ReactElement {
  const styles = useStyles();
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff = block.beforeHash !== null || block.afterHash !== null;

  return (
    <StaticCard>
      <div className={styles.head}>
        <span aria-hidden="true">{OPERATION_MARK[block.operation]}</span>
        <Body1 className={styles.title}>{block.title ?? block.kind}</Body1>
        <Caption1 className={styles.kind}>{block.kind}</Caption1>
      </div>
      {hasDiff ? (
        <>
          <Button
            className={styles.toggle}
            size="small"
            appearance="secondary"
            onClick={() => {
              setShowDiff((v) => !v);
            }}
          >
            {showDiff ? "Hide diff" : "View diff"}
          </Button>
          {showDiff ? (
            <div className={styles.panel}>
              <ArtifactDiff
                client={client}
                beforeHash={block.beforeHash}
                afterHash={block.afterHash}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </StaticCard>
  );
}

function ArtifactDiff({
  client,
  beforeHash,
  afterHash,
}: {
  readonly client: SnapshotDiffClient | null;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}): ReactElement {
  const styles = useStyles();
  const state = useSnapshotDiff(client, beforeHash, afterHash);
  if (state.kind === "pending") {
    return <Caption1 className={styles.note}>Loading diff…</Caption1>;
  }
  if (state.kind === "failed") {
    return (
      <Caption1 className={styles.failed}>
        Couldn’t load this diff — {state.detail}
      </Caption1>
    );
  }
  return (
    <DiffView
      beforeContent={state.diff.beforeContent}
      afterContent={state.diff.afterContent}
      reason={state.diff.reason}
    />
  );
}
