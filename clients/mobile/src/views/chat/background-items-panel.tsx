/**
 * P2 — the lower dock's background-items panel (`BackgroundItemsPanel` on
 * desktop): backgrounded subagents/commands/monitors/wakeups/workflows/mcp
 * tool calls, exact kind icon/label table + per-kind title formatting, a
 * per-item stop + a "Stop all". Flat list (no parent/child indent tree) —
 * `parentTaskId` nesting is a rare case (nested subagents) not worth the
 * added complexity this round; the data is there if that changes later.
 */
import { AlarmClock, Bot, Monitor, Plug, Square, Terminal, Workflow, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { BackgroundItem, BackgroundItemKind } from "@traycer/protocol/host/agent/gui/subscribe";
import { radius, theme, type } from "@/views/design-tokens";

const KIND_ICON: Readonly<Record<BackgroundItemKind, LucideIcon>> = {
  subagent: Bot,
  command: Terminal,
  monitor: Monitor,
  wakeup: AlarmClock,
  workflow: Workflow,
  mcp: Plug,
};

const KIND_LABEL: Readonly<Record<BackgroundItemKind, string>> = {
  subagent: "Sub-agent",
  command: "Command",
  monitor: "Monitor",
  wakeup: "Wake",
  workflow: "Workflow",
  mcp: "MCP tool",
};

const STOP_LABEL: Readonly<Record<BackgroundItemKind, string>> = {
  subagent: "Stop Sub-agent",
  command: "Stop Command",
  monitor: "Stop Monitor",
  wakeup: "Cancel wake",
  workflow: "Stop Workflow",
  mcp: "Stop MCP tool",
};

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Mirrors `backgroundItemDisplayTitle`'s per-kind special casing. */
export function backgroundItemDisplayTitle(item: BackgroundItem): string {
  if (item.kind === "wakeup") return `Waiting until ${formatTime(item.scheduledFor)} · ${item.title}`;
  if (item.kind === "workflow") {
    const extras: string[] = [];
    if (item.phase !== null) extras.push(item.phase);
    if (item.activeLabel !== null) extras.push(item.activeLabel);
    if (item.agentsStarted !== null && item.agentsFinished !== null) {
      extras.push(`${item.agentsFinished}/${item.agentsStarted} done`);
    }
    return extras.length === 0 ? item.title : `${item.title} — ${extras.join(" · ")}`;
  }
  if (item.kind === "mcp") return `${item.serverName} · ${item.toolName}`;
  return item.title;
}

export interface BackgroundItemsPanelProps {
  readonly items: readonly BackgroundItem[];
  readonly canMutate: boolean;
  readonly onStop: (taskId: string) => void;
  readonly onStopAll: () => void;
}

export function BackgroundItemsPanel({ items, canMutate, onStop, onStopAll }: BackgroundItemsPanelProps): ReactElement | null {
  if (items.length === 0) return null;

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
          Background · {items.length} running
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
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          return (
            <li
              key={item.taskId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 36,
                padding: "0 10px",
                borderTop: `1px solid ${theme.borderHairline}`,
              }}
            >
              <Icon size={14} color={theme.primary} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.8 }} />
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
                {backgroundItemDisplayTitle(item)}
              </span>
              <span style={{ ...type.bodyXs, color: theme.mutedText }}>{KIND_LABEL[item.kind]}</span>
              <button
                type="button"
                aria-label={STOP_LABEL[item.kind]}
                disabled={!canMutate}
                onClick={() => onStop(item.taskId)}
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
          );
        })}
      </ul>
    </div>
  );
}
