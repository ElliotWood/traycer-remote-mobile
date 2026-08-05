/**
 * `todo` — always visible, never collapsed.
 *
 * It is small and it is what the agent intends to do next, which is exactly
 * what someone scanning a running chat is looking for. Hiding it behind a
 * disclosure would cost a click to reach the most scannable thing on screen.
 *
 * A cancelled item is struck through rather than removed: a list that quietly
 * drops what was abandoned reads as a plan that never included it.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { TodoBlock as TodoBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { StaticCard } from "./block-card";
import { plainSummary } from "./plain-summary";

type TodoStatus = TodoBlockType["items"][number]["status"];

const STATUS_ICON: Readonly<Record<TodoStatus, string>> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  cancelled: "✕",
};

const useStyles = makeStyles({
  count: {
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  item: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXXS,
  },
  done: { color: tokens.colorNeutralForeground3 },
  cancelled: {
    color: tokens.colorNeutralForeground3,
    textDecoration: "line-through",
  },
});

export function TodoBlock({
  block,
}: {
  readonly block: TodoBlockType;
}): ReactElement {
  const styles = useStyles();
  const done = block.items.filter((i) => i.status === "completed").length;
  return (
    <StaticCard>
      <Caption1 className={styles.count}>
        {done} of {block.items.length} done
      </Caption1>
      <ul className={styles.list}>
        {block.items.map((item, index) => (
          <li
            key={item.id ?? String(index)}
            className={mergeClasses(
              styles.item,
              item.status === "completed" ? styles.done : undefined,
              item.status === "cancelled" ? styles.cancelled : undefined,
            )}
          >
            <span aria-hidden="true">{STATUS_ICON[item.status]}</span>
            <Body1>{plainSummary(item.text)}</Body1>
          </li>
        ))}
      </ul>
    </StaticCard>
  );
}
