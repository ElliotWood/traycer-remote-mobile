import { useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { SwitcherAgentIcon } from "@/components/epic-canvas/mobile/switcher-agent-icon";
import {
  SwitcherListEmpty,
  SwitcherListHeader,
  SwitcherListRow,
} from "@/components/epic-canvas/mobile/switcher-list-row";
import { SwitcherRowActions } from "@/components/epic-canvas/mobile/switcher-row-actions";
import { SwitcherNewAgentButton } from "@/components/epic-canvas/mobile/switcher-create-actions";
import { useSwitcherActivate } from "@/components/epic-canvas/mobile/use-switcher-activate";
import { useOrderedSwitcherRecords } from "@/components/epic-canvas/mobile/switcher-record-order";
import {
  useEpicArtifactRecords,
  useEpicNodeHostId,
  useEpicPermissionRole,
  type EpicTreeRecord,
} from "@/lib/epic-selectors";
import { UNKNOWN_HOST_PLACEHOLDER } from "@/lib/host/constants";
import { isEditableRole } from "@/lib/epic-permissions";
import {
  computeDescendantCounts,
  formatCascadeSummary,
} from "@/lib/epic-tree-cascade";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import { useIsActiveEpicArtifact } from "@/stores/epics/canvas/canvas-selectors";
import {
  isOpenableEpicNodeKind,
  makeOpenableNodeRef,
} from "@/stores/epics/canvas/types";

interface SwitcherListProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
}

/**
 * The label to show against a chat/agent row bound to a host OTHER than the
 * selected one, or `null` when the row runs here.
 *
 * The constraint this renders is `chat.hostId`, a for-life binding: the
 * record is cloud-replicated and therefore VISIBLE from every host, but it
 * is only actionable on the host it is bound to. So the honest signal is
 * per-row, not an empty list - switching hosts changes what you can act in,
 * not what you can see.
 *
 * Naming the owning host is a fact here, not a guess: `hostId` travels in
 * the replicated record. The label, however, comes from this client's own
 * host list, so a host the user has not added resolves to a neutral
 * "another host" fallback rather than a fabricated name.
 */
function useOwnerHostLabel(recordHostId: string | null): string | null {
  const directoryList = useHostDirectoryList();
  const activeHostId = useReactiveActiveHostId();
  // A record with no hostId predates the field; treat it as belonging here
  // rather than flagging every legacy row as foreign.
  if (recordHostId === null) return null;
  // Until the directory resolves we do not know which host is selected, and
  // guessing would flag every row on first paint.
  if (activeHostId === null) return null;
  if (recordHostId === activeHostId) return null;
  const owner =
    directoryList.data?.find((entry) => entry.hostId === recordHostId) ?? null;
  return owner?.label ?? "another host";
}

/**
 * Agents category: GUI chats and TUI agents interleaved in one flat list
 * (decision: interleaved, flat, no gui/tui filter v1) over the shared
 * `useEpicArtifactRecords()` projection - no duplicated data path and none of
 * the desktop tree's dnd / indentation / hover machinery.
 */
export function SwitcherAgentsList(props: SwitcherListProps) {
  const { epicId, tabId, onClose } = props;
  const records = useEpicArtifactRecords();
  const filtered = useMemo(
    () =>
      records.filter(
        (record) =>
          record.type === "chat" || record.type === "terminal-agent",
      ),
    [records],
  );
  const agents = useOrderedSwitcherRecords(filtered);
  const canMutate = isEditableRole(useEpicPermissionRole());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SwitcherListHeader
        action={
          canMutate ? (
            <SwitcherNewAgentButton
              epicId={epicId}
              tabId={tabId}
              onClose={onClose}
            />
          ) : null
        }
      />
      {agents.length === 0 ? (
        <SwitcherListEmpty message="No agents yet." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1 pb-[env(safe-area-inset-bottom)]">
          {agents.map((record) => (
            <SwitcherAgentRow
              key={record.id}
              record={record}
              records={records}
              epicId={epicId}
              tabId={tabId}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SwitcherAgentRow(props: {
  readonly record: EpicTreeRecord;
  readonly records: ReadonlyArray<EpicTreeRecord>;
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
}) {
  const { record, records, epicId, tabId, onClose } = props;
  const activate = useSwitcherActivate(epicId, tabId, onClose);
  const isActive = useIsActiveEpicArtifact(tabId, record.id);
  const agentType: "chat" | "terminal-agent" =
    record.type === "terminal-agent" ? "terminal-agent" : "chat";

  // `record.hostId` is NOT this chat's binding: `recordForChat` stamps every
  // chat row with the app's ACTIVE host (`epic-selectors.ts`), so opening a
  // chat bound elsewhere would bind its tile - and therefore its composer -
  // to whichever host happened to be selected, and send the turn there.
  // `use-comm-graph-jump.ts` names exactly this hazard and refuses it:
  // "guessing would silently point the tab at whichever host happened to be
  // selected". Read the real binding, and fall back to the same placeholder
  // that path uses for legacy chats that predate `Chat.hostId`.
  const boundHostId = useEpicNodeHostId(record.id);

  const onSelect = useCallback(() => {
    const type = record.type;
    if (!isOpenableEpicNodeKind(type)) return;
    activate(record.id, () =>
      makeOpenableNodeRef({
        id: record.id,
        instanceId: uuidv4(),
        type,
        name: record.name,
        hostId: boundHostId ?? UNKNOWN_HOST_PLACEHOLDER,
      }),
    );
  }, [activate, boundHostId, record]);

  const cascadeSummary = formatCascadeSummary(
    computeDescendantCounts(records, record.id),
  );
  const ownerHostLabel = useOwnerHostLabel(boundHostId);

  return (
    <SwitcherListRow
      icon={<SwitcherAgentIcon nodeId={record.id} type={agentType} />}
      label={record.name}
      active={isActive}
      onSelect={onSelect}
      selectTestId={`switcher-agent-row-${record.id}`}
      badge={
        ownerHostLabel === null ? undefined : (
          // Deliberately quiet, not a warning: the row is perfectly readable
          // from here. The only thing it cannot do is RUN here, and that is
          // what naming its host conveys.
          <span
            className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-ui-xs text-muted-foreground"
            data-testid={`switcher-agent-host-${record.id}`}
          >
            {ownerHostLabel}
          </span>
        )
      }
      actions={
        <SwitcherRowActions
          epicId={epicId}
          tabId={tabId}
          kind={agentType}
          nodeId={record.id}
          name={record.name}
          cascadeSummary={cascadeSummary}
        />
      }
    />
  );
}
