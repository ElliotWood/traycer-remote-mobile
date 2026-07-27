/**
 * P1 — Epic tree Artifacts section: spec/ticket/story/review nested by
 * `parentId`, kind icon+color, status dot (ticket/story), and an unread bar
 * (solid self / translucent descendant) — mirrors desktop's
 * `epic-sidebar-artifact-tree.tsx` + `ArtifactUnreadMarker`.
 */
import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { ChevronDown, ChevronRight, ListFilter } from "lucide-react";
import {
  buildArtifactTree,
  type ArtifactTree,
  type EpicArtifactEntry,
} from "@/host/use-epic-doc";
import { anyDescendantUnread, collectDescendantIds } from "@/host/agent-ladder";
import { isUnread } from "@/host/read-tracking-store";
import { resortTree, type SortMode } from "@/host/tree-sort";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useRenameArtifact, useDeleteArtifact } from "@/host/use-node-mutations";
import {
  KIND_COLORS,
  KIND_ICONS,
  StatusDot,
  displayArtifactTitle,
  hexToRgba,
} from "@/views/kind-tokens";
import { radius, theme, type } from "@/views/design-tokens";
import {
  GuideRails,
  RowActionsButton,
  TreeChevron,
  TreeRowSkeleton,
  rowOpenButtonStyle,
  rowShellStyle,
  sectionHeaderStyle,
  sectionLabelStyle,
} from "./tree-primitives";
import { NodeActionSheet, RenamePrompt } from "./node-action-sheet";
import {
  ArtifactFilterPanel,
  DEFAULT_ARTIFACT_FILTER,
  artifactMatchesFilter,
  hasActiveArtifactFilter,
  type ArtifactFilter,
} from "./artifact-filter-panel";

export interface ArtifactsSectionProps {
  readonly epicId: string;
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly connectionLive: boolean;
  /** `false` while the epic snapshot is still decoding — renders a skeleton instead of a premature "no artifacts" empty-state. */
  readonly docLoaded: boolean;
  readonly sortMode: SortMode;
  readonly onOpenArtifact: (artifactId: string) => void;
  readonly onAddChild: (parentArtifactId: string | null) => void;
}

export function ArtifactsSection({
  epicId,
  artifacts,
  connectionLive,
  docLoaded,
  sortMode,
  onOpenArtifact,
  onAddChild,
}: ArtifactsSectionProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionsForId, setActionsForId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtifactFilter>(DEFAULT_ARTIFACT_FILTER);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const hostClient = useHostClientOrNull();

  const fullTree = useMemo(
    () => resortTree(buildArtifactTree(artifacts), sortMode),
    [artifacts, sortMode],
  );
  const unreadById = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const a of artifacts) out[a.id] = isUnread(epicId, a.id, a.updatedAt);
    return out;
  }, [artifacts, epicId]);

  const hasActiveFilter = hasActiveArtifactFilter(filter);
  const visibleIds = useMemo(() => {
    if (!hasActiveFilter) return null;
    const set = new Set<string>();
    for (const a of artifacts) {
      if (artifactMatchesFilter(a, filter, unreadById[a.id] ?? false)) set.add(a.id);
    }
    return set;
  }, [artifacts, filter, hasActiveFilter, unreadById]);

  // Perf: stable identity so `React.memo`'d `ArtifactNode` rows bail out.
  const toggleExpanded = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const actionsArtifact = actionsForId === null ? null : fullTree.byId[actionsForId];
  const renamingArtifact = renamingId === null ? null : fullTree.byId[renamingId];

  const renameArtifact = useRenameArtifact(hostClient, epicId, renamingId ?? "", () => setRenamingId(null));
  const deleteArtifact = useDeleteArtifact(hostClient, epicId, actionsForId ?? "", () => setActionsForId(null));
  const canMutate = hostClient !== null && connectionLive;

  const roots = visibleIds === null ? fullTree.roots : fullTree.roots.filter((id) => visibleIds.has(id));

  return (
    <section style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          style={{ ...sectionHeaderStyle, flex: 1 }}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span style={sectionLabelStyle}>
            Artifacts{hasActiveFilter ? " · filtered" : ""}
          </span>
          {collapsed ? (
            <ChevronRight size={14} color={theme.primary} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} color={theme.primary} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label="Filter artifacts"
          onClick={() => setShowFilterPanel((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            flexShrink: 0,
            border: "none",
            borderRadius: radius.md,
            background: showFilterPanel || hasActiveFilter ? `${theme.primary}22` : "transparent",
            color: showFilterPanel || hasActiveFilter ? theme.primary : theme.mutedText,
            cursor: "pointer",
          }}
        >
          <ListFilter size={15} aria-hidden="true" />
        </button>
      </div>

      {showFilterPanel && <ArtifactFilterPanel filter={filter} onChange={setFilter} />}

      {!collapsed && (
        <>
          {roots.length > 0 ? null : !docLoaded ? (
            // See AgentsSection's identical gate: a non-empty tree (cache-seeded
            // or live) always wins regardless of docLoaded, so cached rows paint
            // instantly; "no artifacts" is only ever claimed once confirmed live.
            <TreeRowSkeleton />
          ) : (
            <p style={{ ...type.bodySm, color: theme.mutedText, padding: "0 8px" }}>
              {hasActiveFilter ? "No artifacts match this filter." : "No artifacts in this epic yet."}
            </p>
          )}
          {roots.length > 0 && (
            <ul role="tree" aria-label="Artifacts" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {roots.map((id) => (
                <ArtifactNode
                  key={id}
                  id={id}
                  depth={0}
                  tree={fullTree}
                  visibleIds={visibleIds}
                  unreadById={unreadById}
                  expandedIds={expandedIds}
                  onToggleExpanded={toggleExpanded}
                  onOpen={onOpenArtifact}
                  onOpenActions={setActionsForId}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {actionsArtifact !== undefined && actionsArtifact !== null && (
        <NodeActionSheet
          title={displayArtifactTitle(actionsArtifact.title, actionsArtifact.kind)}
          canMutate={canMutate}
          deleting={deleteArtifact.phase === "submitting"}
          deleteError={deleteArtifact.error}
          deleteCascadeCount={collectDescendantIds(actionsArtifact.id, fullTree.childrenByParent).length}
          onRename={() => setRenamingId(actionsArtifact.id)}
          onAddChild={() => onAddChild(actionsArtifact.id)}
          onDeleteConfirmed={deleteArtifact.deleteNode}
          onClose={() => setActionsForId(null)}
        />
      )}

      {renamingArtifact !== undefined && renamingArtifact !== null && (
        <RenamePrompt
          initialTitle={renamingArtifact.title}
          submitting={renameArtifact.phase === "submitting"}
          error={renameArtifact.error}
          onSubmit={renameArtifact.rename}
          onClose={() => setRenamingId(null)}
        />
      )}
    </section>
  );
}

function UnreadMarker({ variant }: { readonly variant: "self" | "descendant" | null }): ReactElement {
  const style: CSSProperties = {
    display: "inline-block",
    width: 2,
    height: 16,
    borderRadius: 1,
    flexShrink: 0,
    background:
      variant === "self" ? "#38bdf8" : variant === "descendant" ? "rgba(56, 189, 248, 0.5)" : "transparent",
  };
  return <span aria-hidden="true" style={style} />;
}

/** Perf: memoized (default shallow prop compare) — see `ChatNodeImpl`'s equivalent docblock in `agents-section.tsx` for why this bails out on unrelated re-renders. */
function ArtifactNodeImpl({
  id,
  depth,
  tree,
  visibleIds,
  unreadById,
  expandedIds,
  onToggleExpanded,
  onOpen,
  onOpenActions,
}: {
  readonly id: string;
  readonly depth: number;
  readonly tree: ArtifactTree;
  readonly visibleIds: ReadonlySet<string> | null;
  readonly unreadById: Readonly<Record<string, boolean>>;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggleExpanded: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onOpenActions: (id: string) => void;
}): ReactElement | null {
  const artifact = tree.byId[id];
  if (artifact === undefined) return null;

  const allChildIds = tree.childrenByParent[id] ?? [];
  const childIds = visibleIds === null ? allChildIds : allChildIds.filter((c) => visibleIds.has(c));
  const hasChildren = childIds.length > 0;
  const isExpanded = expandedIds.has(id);
  const Icon = KIND_ICONS[artifact.kind];
  const color = KIND_COLORS[artifact.kind];

  const selfUnread = unreadById[id] ?? false;
  const descendantUnread =
    !selfUnread && !isExpanded && hasChildren
      ? anyDescendantUnread(id, tree.childrenByParent, (descId) => unreadById[descId] ?? false)
      : false;
  const markerVariant: "self" | "descendant" | null = selfUnread
    ? "self"
    : descendantUnread
      ? "descendant"
      : null;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div style={rowShellStyle}>
        <GuideRails depth={depth} />
        <TreeChevron hasChildren={hasChildren} expanded={isExpanded} onToggle={() => onToggleExpanded(id)} depth={depth} />
        <button
          type="button"
          data-testid={`artifact-row-${id}`}
          style={{ ...rowOpenButtonStyle(), borderLeft: `3px solid ${color}`, background: hexToRgba(color, 0.06) }}
          onClick={() => onOpen(id)}
        >
          <UnreadMarker variant={markerVariant} />
          <Icon size={15} color={color} aria-hidden="true" />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayArtifactTitle(artifact.title, artifact.kind)}
          </span>
          <StatusDot kind={artifact.kind} status={artifact.status ?? undefined} />
        </button>
        <RowActionsButton
          label={`Actions for ${displayArtifactTitle(artifact.title, artifact.kind)}`}
          onOpen={() => onOpenActions(id)}
        />
      </div>
      {hasChildren && isExpanded && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {childIds.map((childId) => (
            <ArtifactNode
              key={childId}
              id={childId}
              depth={depth + 1}
              tree={tree}
              visibleIds={visibleIds}
              unreadById={unreadById}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onOpen={onOpen}
              onOpenActions={onOpenActions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const ArtifactNode = memo(ArtifactNodeImpl);
