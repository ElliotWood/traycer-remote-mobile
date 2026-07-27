/**
 * P2 — orchestrates the lower-dock panels above the composer: queue,
 * background items, accumulated changes. Each panel returns `null` when
 * empty, so the dock takes zero space until there's something to show.
 *
 * Active-agents summary is DEFERRED, flagged not hollow: desktop sources it
 * from the epic-wide `useEpicActiveAgentIds` (the in-process canvas store's
 * aggregate over ALL descendant chats), which needs the epic's chat tree —
 * `ChatView` only has this ONE chat's own stream, not the tree. Building a
 * faithful descendant-aware panel would mean threading the epic tree into
 * ChatView (a real architecture change), which the P2 contract's Evaluator
 * tighten explicitly said to defer rather than fake with a hollow count.
 */
import type { ReactElement } from "react";
import type {
  BackgroundItem,
  ChatAccumulatedFileChange,
  ChatQueuedItem,
  ChatQueueState,
} from "@traycer/protocol/host/agent/gui/subscribe";
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

export function LowerDock(props: LowerDockProps): ReactElement {
  return (
    <div>
      <QueuePanel
        queue={props.queue}
        canMutate={props.canMutate}
        onPause={props.onPauseQueue}
        onResume={props.onResumeQueue}
        onCancel={props.onCancelQueueItem}
        onSteerNow={props.onSteerQueueItemNow}
        onEdit={props.onEditQueueItem}
      />
      {/* Background items — undefined means the host/session never advertised support; hide entirely rather than showing an empty section. */}
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
  );
}
