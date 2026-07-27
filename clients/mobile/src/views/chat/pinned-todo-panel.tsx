/**
 * The lower dock's Todo panel (`PinnedTodoPanel` on desktop) — derived
 * purely from this chat's own block stream, see
 * `chat-projection.ts`'s `pinnedTodoSnapshot` for the exact derivation and
 * its documented simplifications vs. desktop.
 */
import { CheckCircle2, Circle, CircleDot, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { TodoItem } from "@traycer/protocol/persistence/epic/content-blocks";
import type { PinnedTodoSnapshot } from "@/host/chat-projection";
import { radius, theme, type } from "@/views/design-tokens";

const STATUS_ICON: Readonly<Record<TodoItem["status"], typeof Circle>> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
  cancelled: XCircle,
};

const STATUS_COLOR: Readonly<Record<TodoItem["status"], string>> = {
  pending: theme.mutedText,
  in_progress: theme.primary,
  completed: theme.success,
  cancelled: theme.mutedText,
};

/** The active item's label, or a fallback summary when nothing is in progress — mirrors desktop's collapsed-row copy. */
function summaryText(snapshot: PinnedTodoSnapshot): string {
  if (snapshot.activeItem !== null) {
    return snapshot.activeItem.activeForm ?? snapshot.activeItem.text;
  }
  if (snapshot.doneCount === snapshot.totalCount) return "Complete";
  const pending = snapshot.totalCount - snapshot.doneCount - snapshot.cancelledCount;
  return pending > 0 ? `${pending} pending` : "No active task";
}

export function PinnedTodoPanel({
  snapshot,
}: {
  readonly snapshot: PinnedTodoSnapshot;
}): ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${theme.borderHairline}`,
        borderRadius: radius.lg,
        background: theme.surface,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        <span style={{ ...type.bodySm, color: theme.text, flexShrink: 0 }}>Todo</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            ...type.bodyXs,
            color: theme.mutedText,
          }}
        >
          {summaryText(snapshot)}
        </span>
        <span style={{ ...type.bodyXs, color: theme.mutedText, flexShrink: 0 }}>
          {snapshot.doneCount}/{snapshot.totalCount} done
          {snapshot.cancelledCount > 0 ? ` · ${snapshot.cancelledCount} cancelled` : ""}
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {snapshot.items.map((item, index) => {
          const Icon = STATUS_ICON[item.status];
          return (
            <li
              key={item.id ?? index}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "4px 10px 4px 34px",
              }}
            >
              <Icon size={13} color={STATUS_COLOR[item.status]} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <span
                style={{
                  ...type.bodyXs,
                  color: item.status === "completed" || item.status === "cancelled" ? theme.mutedText : theme.textRow,
                  textDecoration: item.status === "cancelled" ? "line-through" : undefined,
                  wordBreak: "break-word",
                }}
              >
                {item.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
