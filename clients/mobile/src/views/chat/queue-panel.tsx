/**
 * P2 — the lower dock's queue panel (`QueuedMessagePanel` on desktop):
 * pause/resume, per-row edit (moves the item back to the composer text and
 * cancels it — desktop's "Move queued message to composer" for steerable
 * items), cancel, and steer-now (same-turn items only). No drag-reorder
 * this round (dnd-kit is desktop-only tooling, low value on a phone list).
 */
import type { ReactElement } from "react";
import { ListOrdered, Pause, Pencil, Play, SendHorizontal, Trash2 } from "lucide-react";
import type { ChatQueuedItem, ChatQueueState } from "@traycer/protocol/host/agent/gui/subscribe";
import { radius, theme, type } from "@/views/design-tokens";
import { userContentToMarkdown } from "@/host/user-content";

const STATUS_LABEL: Readonly<Record<ChatQueuedItem["status"], string>> = {
  pending: "Queuing",
  steer_requested: "Waiting for steer",
  steering: "Steering",
  injected: "Embedding",
  fallback: "After turn",
  paused: "Paused",
};

export interface QueuePanelProps {
  readonly queue: ChatQueueState;
  readonly canMutate: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onCancel: (queueItemId: string) => void;
  readonly onSteerNow: (queueItemId: string) => void;
  readonly onEdit: (item: ChatQueuedItem, text: string) => void;
}

export function QueuePanel({ queue, canMutate, onPause, onResume, onCancel, onSteerNow, onEdit }: QueuePanelProps): ReactElement | null {
  if (queue.items.length === 0) return null;

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
        <span style={{ display: "flex", alignItems: "center", gap: 6, ...type.bodySm, color: theme.text }}>
          <ListOrdered size={14} aria-hidden="true" />
          Message queue · {queue.items.length}
        </span>
        <button
          type="button"
          disabled={!canMutate}
          onClick={queue.status === "paused" ? onResume : onPause}
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
          {queue.status === "paused" ? (
            <>
              <Play size={12} aria-hidden="true" /> Resume
            </>
          ) : (
            <>
              <Pause size={12} aria-hidden="true" /> Pause
            </>
          )}
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {queue.items.map((item) => {
          const text = userContentToMarkdown(item.message.content);
          const steerable = item.delivery === "same_turn" && item.status === "pending";
          return (
            <li
              key={item.queueItemId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 40,
                padding: "6px 10px",
                borderTop: `1px solid ${theme.borderHairline}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: theme.textRow,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {text || "(empty)"}
                </p>
                <span style={{ ...type.bodyXs, color: theme.mutedText }}>{STATUS_LABEL[item.status]}</span>
              </div>
              {steerable && (
                <button
                  type="button"
                  aria-label="Steer now"
                  disabled={!canMutate}
                  onClick={() => onSteerNow(item.queueItemId)}
                  style={iconButtonStyle(canMutate)}
                >
                  <SendHorizontal size={13} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                aria-label="Edit queued message"
                disabled={!canMutate}
                onClick={() => onEdit(item, text)}
                style={iconButtonStyle(canMutate)}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Delete queued message"
                disabled={!canMutate}
                onClick={() => onCancel(item.queueItemId)}
                style={iconButtonStyle(canMutate)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function iconButtonStyle(canMutate: boolean) {
  return {
    border: "none",
    background: "transparent",
    color: theme.mutedText,
    opacity: canMutate ? 1 : 0.5,
    cursor: canMutate ? "pointer" : "default",
    padding: 4,
    flexShrink: 0,
  } as const;
}
