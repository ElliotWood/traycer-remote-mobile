/**
 * The lower dock's Active-agents panel — self + running descendant chats,
 * each with its own Stop, plus a Stop all. See
 * `use-descendant-agents.ts`'s docblock for how this reaches data desktop
 * gets from an epic-wide cross-host store, via a smaller/bounded path
 * instead.
 */
import { Bot, Square } from "lucide-react";
import type { ReactElement } from "react";
import { radius, theme, type } from "@/views/design-tokens";

export interface ActiveAgentRow {
  readonly chatId: string;
  readonly title: string;
  readonly isSelf: boolean;
}

export interface ActiveAgentsPanelProps {
  readonly rows: readonly ActiveAgentRow[];
  readonly canMutate: boolean;
  readonly onStop: (chatId: string, isSelf: boolean) => void;
  readonly onStopAll: () => void;
}

export function ActiveAgentsPanel({ rows, canMutate, onStop, onStopAll }: ActiveAgentsPanelProps): ReactElement | null {
  if (rows.length === 0) return null;

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
        <span style={{ ...type.bodySm, color: theme.text }}>
          Active agents · {rows.length} running
        </span>
        <button
          type="button"
          disabled={!canMutate}
          onClick={onStopAll}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            border: "none",
            background: "transparent",
            color: theme.mutedText,
            opacity: canMutate ? 1 : 0.5,
            cursor: canMutate ? "pointer" : "default",
            ...type.bodyXs,
            padding: "4px 6px",
          }}
        >
          <Square size={11} aria-hidden="true" />
          Stop all
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li
            key={row.chatId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              padding: "0 10px",
              borderTop: `1px solid ${theme.borderHairline}`,
            }}
          >
            <Bot size={14} color={theme.primary} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.8 }} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 12,
                color: theme.textRow,
              }}
            >
              {row.title || "Untitled chat"}
              {row.isSelf && <span style={{ color: theme.mutedText }}> · this chat</span>}
            </span>
            <button
              type="button"
              aria-label={`Stop ${row.title || "agent"}`}
              disabled={!canMutate}
              onClick={() => onStop(row.chatId, row.isSelf)}
              style={{
                border: "none",
                background: "transparent",
                color: theme.mutedText,
                opacity: canMutate ? 1 : 0.5,
                cursor: canMutate ? "pointer" : "default",
                padding: 4,
                flexShrink: 0,
              }}
            >
              <Square size={11} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
