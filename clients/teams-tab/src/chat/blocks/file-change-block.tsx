/**
 * `file_change` — what the agent actually changed on disk.
 *
 * The header is answerable without any request: verb, path, and the
 * PERSISTED `+N/−M` counts. The diff itself is a snapshot fetch, so it lives
 * in the body and fires only when the card is opened.
 *
 * A DENIED OR FAILED EDIT SHOWS NO COUNTS. `+12/−3` on an edit that never
 * landed describes a change to the file that did not happen — the single most
 * misleading thing this card could render — so the outcome replaces the
 * counts rather than sitting beside them.
 *
 * This card is why `buildBlockTree` suppresses the `tool_call` that produced
 * it. Without that rule one edit renders twice and the reader cannot tell it
 * is one edit.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { FileChangeBlock as FileChangeBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { shortenWorkspacePath } from "@traycer-clients/shared/epic/transcript";
import { CollapsibleCard, StatusBadge } from "./block-card";
import { DiffView } from "./diff-view";
import { useSnapshotDiff, type SnapshotDiffClient } from "./use-snapshot-diff";

const useStyles = makeStyles({
  verb: { fontWeight: tokens.fontWeightSemibold, flexShrink: 0 },
  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontFamilyMonospace,
  },
  counts: { fontFamily: tokens.fontFamilyMonospace, flexShrink: 0 },
  added: { color: tokens.colorPaletteGreenForeground1 },
  removed: { color: tokens.colorPaletteRedForeground1 },
  outcome: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },
  note: { color: tokens.colorNeutralForeground3, margin: 0 },
  failed: { color: tokens.colorPaletteRedForeground1, margin: 0 },
});

/** The operation as a person reads it; the raw verb is harness-specific. */
function verb(operation: string): string {
  const op = operation.toLowerCase();
  if (op.includes("create") || op.includes("write")) return "Create";
  if (op.includes("delete") || op.includes("remove")) return "Delete";
  return "Edit";
}

export function FileChangeBlock({
  block,
  client,
}: {
  readonly block: FileChangeBlockType;
  readonly client: SnapshotDiffClient | null;
}): ReactElement {
  const styles = useStyles();
  const denied = block.reason === "denied";
  const failed = denied || block.status === "errored";
  /*
   * The path is shortened by the SHARED rule, not a local one.
   * `/srv/traycer/tenants/<name>/…` embeds a tenant name, and this product is
   * heading for people looking at hosts they do not own. The chip path
   * already trims it; a renderer that printed the raw path would leak in the
   * richer view exactly what the poorer one was careful about.
   */
  const path = shortenWorkspacePath(block.filePath);

  return (
    <CollapsibleCard
      label={`${verb(block.operation)} ${path}`}
      header={
        <>
          <Body1 className={styles.verb}>{verb(block.operation)}</Body1>
          <Caption1 className={styles.path}>{path}</Caption1>
          {failed ? (
            <Caption1 className={styles.outcome}>
              {denied ? "denied" : "failed"}
            </Caption1>
          ) : (
            <Caption1 className={styles.counts}>
              <span className={styles.added}>+{block.additions}</span>{" "}
              <span className={styles.removed}>−{block.deletions}</span>
            </Caption1>
          )}
          <StatusBadge status={block.status} />
        </>
      }
    >
      <FileChangeDiff block={block} client={client} />
    </CollapsibleCard>
  );
}

function FileChangeDiff({
  block,
  client,
}: {
  readonly block: FileChangeBlockType;
  readonly client: SnapshotDiffClient | null;
}): ReactElement {
  const styles = useStyles();
  const state = useSnapshotDiff(client, block.beforeHash, block.afterHash);

  if (state.kind === "pending") {
    return <Caption1 className={styles.note}>Loading diff…</Caption1>;
  }
  if (state.kind === "failed") {
    // NOT an empty diff. "We could not read it" and "nothing changed" are
    // opposite claims and only one of them is true here.
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
