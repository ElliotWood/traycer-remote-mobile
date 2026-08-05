/**
 * `command` — a shell command the agent ran.
 *
 * stdout/stderr are never persisted (the host's own note calls
 * command+cwd+exitCode+status "the load-bearing signal"), so the body has
 * nothing to lazy-fetch. It re-shows the command unelided — the header
 * truncates a long one to a single line, and the reason to open the card is
 * to read the part that was cut.
 */
import type { ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { CommandBlock as CommandBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { CollapsibleCard, StatusBadge } from "./block-card";

const useStyles = makeStyles({
  line: {
    fontFamily: tokens.fontFamilyMonospace,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  exit: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },
  full: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  cwd: {
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginTop: tokens.spacingVerticalXS,
  },
});

export function CommandBlock({
  block,
}: {
  readonly block: CommandBlockType;
}): ReactElement {
  const styles = useStyles();
  return (
    <CollapsibleCard
      label={`Command: ${block.command}`}
      header={
        <>
          <Caption1 className={styles.line}>$ {block.command}</Caption1>
          {block.exitCode !== null && block.exitCode !== 0 ? (
            <Caption1 className={styles.exit}>
              exit {block.exitCode}
            </Caption1>
          ) : null}
          <StatusBadge status={block.status} />
        </>
      }
    >
      <pre className={styles.full}>{block.command}</pre>
      {block.cwd !== null ? (
        <Caption1 className={styles.cwd}>cwd: {block.cwd}</Caption1>
      ) : null}
    </CollapsibleCard>
  );
}
