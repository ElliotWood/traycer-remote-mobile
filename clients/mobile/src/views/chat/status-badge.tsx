/**
 * Small status pill shared by action-block headers (tool_call/command/
 * file_change/subagent) — `interrupted`/`superseded` render a neutral badge,
 * never a spinner/error (they're not failures).
 */
import type { CSSProperties, ReactElement } from "react";
import { colors } from "../ui";

export type ActionBlockStatus = "streaming" | "completed" | "errored" | "interrupted" | "superseded";

const LABELS: Readonly<Record<ActionBlockStatus, string>> = {
  streaming: "Running",
  completed: "Done",
  errored: "Error",
  interrupted: "Stopped",
  superseded: "Superseded",
};

function color(status: ActionBlockStatus): string {
  if (status === "errored") return colors.danger;
  if (status === "streaming") return colors.accent;
  if (status === "completed") return "#3fb950";
  return colors.muted;
}

export function StatusBadge({ status }: { readonly status: ActionBlockStatus }): ReactElement | null {
  if (status === "completed") return null;
  const c = color(status);
  const style: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: c,
    border: `1px solid ${c}`,
    borderRadius: 999,
    padding: "1px 6px",
    whiteSpace: "nowrap",
  };
  return (
    <span role="status" style={style}>
      {LABELS[status]}
    </span>
  );
}
