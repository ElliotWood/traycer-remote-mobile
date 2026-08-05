/**
 * `error` — static and never collapsed.
 *
 * Everything else in this directory hides its body by default because a
 * transcript is mostly finished work. An error is the exception: it is the
 * thing the reader opened the chat to find, and a collapsed error is a
 * transcript that knows what went wrong and does not say.
 *
 * `role="alert"` because it is announced content, not decoration.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { ErrorBlock as ErrorBlockType } from "@traycer/protocol/persistence/epic/content-blocks";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    backgroundColor: tokens.colorPaletteRedBackground1,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalS,
  },
  head: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorPaletteRedForeground1,
    display: "block",
  },
  message: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    wordBreak: "break-word",
  },
});

export function ErrorBlock({
  block,
}: {
  readonly block: ErrorBlockType;
}): ReactElement {
  const styles = useStyles();
  return (
    <div role="alert" className={styles.card}>
      <Caption1 className={styles.head}>
        Error{block.code !== null ? ` · ${block.code}` : ""}
      </Caption1>
      <Body1 as="p" className={styles.message}>
        {block.message}
      </Body1>
    </div>
  );
}
