/**
 * `todo` block (Sprint 2) — always-visible, non-collapsible (small, useful
 * to scan at a glance).
 */
import type { ReactElement } from "react";
import type { TodoBlock as TodoBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { StaticCard } from "../collapsible-card";

const STATUS_ICON: Readonly<Record<TodoBlockType["items"][number]["status"], string>> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  cancelled: "✕",
};

export function TodoBlock({ block }: { readonly block: TodoBlockType }): ReactElement {
  const done = block.items.filter((i) => i.status === "completed").length;
  return (
    <StaticCard>
      <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted }}>
        {done} of {block.items.length} done
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {block.items.map((item, index) => (
          <li
            key={item.id ?? index}
            style={{
              display: "flex",
              gap: 8,
              fontSize: 13,
              marginBottom: 4,
              color: item.status === "completed" ? colors.muted : colors.text,
              textDecoration: item.status === "cancelled" ? "line-through" : undefined,
            }}
          >
            <span aria-hidden="true">{STATUS_ICON[item.status]}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </StaticCard>
  );
}
