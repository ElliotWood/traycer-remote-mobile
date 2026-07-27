/**
 * P2 — orchestrates the lower-dock panels above the composer: queue,
 * background items, accumulated changes. Each panel returns `null` when
 * empty, so the dock takes zero space when there's nothing to show.
 *
 * UX fix (user feedback): the FULL dock used to render open by default and
 * could push the composer/transcript out of view. Collapsed by default now
 * — a single-row strip of compact summary chips ("2 files ±", "Active 1",
 * background count) directly above the composer; tap to expand into the
 * full panels. The transcript + composer stay reachable regardless.
 *
 * Active-agents summary is DEFERRED, flagged not hollow: desktop sources it
 * from the epic-wide `useEpicActiveAgentIds` (the in-process canvas store's
 * aggregate over ALL descendant chats), which needs the epic's chat tree —
 * `ChatView` only has this ONE chat's own stream, not the tree. Building a
 * faithful descendant-aware panel would mean threading the epic tree into
 * ChatView (a real architecture change), which the P2 contract's Evaluator
 * tighten explicitly said to defer rather than fake with a hollow count.
 */
import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronUp, FileDiff, ListOrdered, Radio } from "lucide-react";
import type {
  BackgroundItem,
  ChatAccumulatedFileChange,
  ChatQueuedItem,
  ChatQueueState,
} from "@traycer/protocol/host/agent/gui/subscribe";
import { radius, theme, type } from "@/views/design-tokens";
import { AccumulatedChangesPanel } from "./accumulated-changes-panel";
import { BackgroundItemsPanel } from "./background-items-panel";
import { QueuePanel } from "./queue-panel";

export interface LowerDockProps {
  readonly queue: ChatQueueState;
  readonly backgroundItems: readonly BackgroundItem[] | undefined;
  readonly accumulatedFileChanges: readonly ChatAccumulatedFileChange[];
  readonly canMutate: boolean;
  readonly undoAllPending: boolean;
  readonly onUndoAll: () => void;
  readonly onStopBackgroundItem: (taskId: string) => void;
  readonly onStopAllBackgroundItems: () => void;
  readonly onPauseQueue: () => void;
  readonly onResumeQueue: () => void;
  readonly onCancelQueueItem: (queueItemId: string) => void;
  readonly onSteerQueueItemNow: (queueItemId: string) => void;
  readonly onEditQueueItem: (item: ChatQueuedItem, text: string) => void;
}

export function LowerDock(props: LowerDockProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  const chips = useMemo(() => {
    const out: { readonly key: string; readonly icon: typeof ListOrdered; readonly label: string }[] = [];
    if (props.queue.items.length > 0) {
      out.push({ key: "queue", icon: ListOrdered, label: `${props.queue.items.length} queued` });
    }
    if (props.backgroundItems !== undefined && props.backgroundItems.length > 0) {
      out.push({ key: "bg", icon: Radio, label: `${props.backgroundItems.length} running` });
    }
    if (props.accumulatedFileChanges.length > 0) {
      out.push({
        key: "changes",
        icon: FileDiff,
        label: `${props.accumulatedFileChanges.length} file${props.accumulatedFileChanges.length === 1 ? "" : "s"} ±`,
      });
    }
    return out;
  }, [props.queue.items.length, props.backgroundItems, props.accumulatedFileChanges.length]);

  if (chips.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 36,
          padding: "0 10px",
          border: `1px solid ${theme.borderHairline}`,
          borderRadius: expanded ? `${radius.lg}px ${radius.lg}px 0 0` : radius.lg,
          background: theme.surface,
          cursor: "pointer",
        }}
      >
        {chips.map((chip) => (
          <span key={chip.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, ...type.bodyXs, color: theme.mutedText }}>
            <chip.icon size={12} aria-hidden="true" />
            {chip.label}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        {expanded ? (
          <ChevronDown size={14} color={theme.mutedText} aria-hidden="true" />
        ) : (
          <ChevronUp size={14} color={theme.mutedText} aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div style={{ border: `1px solid ${theme.borderHairline}`, borderTop: "none", borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`, padding: 6 }}>
          <QueuePanel
            queue={props.queue}
            canMutate={props.canMutate}
            onPause={props.onPauseQueue}
            onResume={props.onResumeQueue}
            onCancel={props.onCancelQueueItem}
            onSteerNow={props.onSteerQueueItemNow}
            onEdit={props.onEditQueueItem}
          />
          {props.backgroundItems !== undefined && (
            <BackgroundItemsPanel
              items={props.backgroundItems}
              canMutate={props.canMutate}
              onStop={props.onStopBackgroundItem}
              onStopAll={props.onStopAllBackgroundItems}
            />
          )}
          <AccumulatedChangesPanel
            changes={props.accumulatedFileChanges}
            canMutate={props.canMutate}
            undoAllPending={props.undoAllPending}
            onUndoAll={props.onUndoAll}
          />
        </div>
      )}
    </div>
  );
}
