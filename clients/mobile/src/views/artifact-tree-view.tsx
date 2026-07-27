/**
 * Artifact browse tree (Mobile v2, Sprint 3 / M5).
 *
 * A color-coded tree of the epic's artifacts, nested by `parentId`
 * (`buildArtifactTree`), drilling into a read-only body render
 * (`ArtifactBodyView`). Managed as local drill-in state within this
 * component (not pushed onto the global `nav.ts` stack) — mirrors
 * `EpicView`'s existing `authoring` toggle pattern: `Back` from a body
 * returns to the tree, `Back` from the tree (root) calls `onBack` up to
 * `EpicView`.
 *
 * `artifacts`/`artifactRooms`/`connection` are passed down from `EpicView`'s
 * `useEpicDoc` call — this component does NOT open its own `epic.subscribe`.
 * `HostStreamConnection.openEpic` has no multiplexing; a second call here
 * would open a second concurrent session for the same epic (contract round-2
 * condition (c): "EXACTLY ONE epic.subscribe ... read replicas from the SAME
 * session EpicView already opens"), doubling the stream cost and forcing a
 * redundant re-handshake + full re-fetch every time Artifacts is opened even
 * though EpicView's stream already has everything live.
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { ArtifactRoomRegistry } from "@/host/artifact-room-registry";
import type { StreamConnectionState } from "@/host/stream-connection";
import {
  buildArtifactTree,
  type ArtifactTree,
  type EpicArtifactEntry,
} from "@/host/use-epic-doc";
import {
  KIND_COLORS,
  KIND_ICONS,
  StatusDot,
  displayArtifactTitle,
  hexToRgba,
} from "./kind-tokens";
import { ArtifactBodyView } from "./artifact-body-view";
import { colors, screen, secondaryButton } from "./ui";

interface ArtifactTreeViewProps {
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly artifactRooms: ArtifactRoomRegistry | null;
  readonly connection: StreamConnectionState;
  readonly onBack: () => void;
}

/** Rubric §2 hard gate: every tap target ≥~44px, independent of nesting depth. */
const ROW_MIN_HEIGHT = 44;
const CHEVRON_HIT = 44;
const INDENT_PX = 16;

export function ArtifactTreeView({
  artifacts,
  artifactRooms,
  connection,
  onBack,
}: ArtifactTreeViewProps): ReactElement {
  const tree = useMemo(() => buildArtifactTree(artifacts), [artifacts]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);

  const toggleExpanded = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // A stale `openArtifactId` (its artifact left the tree) resolves to `null`
  // here rather than during render — no setState-in-render.
  const openArtifact = openArtifactId === null ? null : tree.byId[openArtifactId] ?? null;

  if (openArtifact !== null) {
    return (
      <ArtifactBodyView
        artifact={openArtifact}
        artifactRooms={artifactRooms}
        onBack={() => setOpenArtifactId(null)}
      />
    );
  }

  return (
    <main style={screen}>
      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 16 }}
        onClick={onBack}
      >
        ← Back
      </button>

      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Artifacts</h1>
        {connection !== "live" && (
          <p role="status" style={{ color: colors.muted, margin: "4px 0 0", fontSize: 13 }}>
            {connection === "reconnecting" ? "Reconnecting…" : "Disconnected"}
          </p>
        )}
      </header>

      {tree.roots.length === 0 ? (
        <p style={{ color: colors.muted }}>No artifacts in this epic yet.</p>
      ) : (
        <ul role="tree" aria-label="Epic artifacts" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {tree.roots.map((id) => (
            <ArtifactNode
              key={id}
              id={id}
              depth={0}
              tree={tree}
              expandedIds={expandedIds}
              onToggleExpanded={toggleExpanded}
              onOpen={setOpenArtifactId}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

interface ArtifactNodeProps {
  readonly id: string;
  readonly depth: number;
  readonly tree: ArtifactTree;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggleExpanded: (id: string) => void;
  readonly onOpen: (id: string) => void;
}

function ArtifactNode({
  id,
  depth,
  tree,
  expandedIds,
  onToggleExpanded,
  onOpen,
}: ArtifactNodeProps): ReactElement | null {
  const artifact = tree.byId[id];
  if (artifact === undefined) return null;

  const childIds = tree.childrenByParent[id] ?? [];
  const hasChildren = childIds.length > 0;
  const isExpanded = expandedIds.has(id);
  const Icon = KIND_ICONS[artifact.kind];
  const color = KIND_COLORS[artifact.kind];

  const rowStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: ROW_MIN_HEIGHT,
    padding: "0 10px 0 6px",
    border: "none",
    borderLeft: `3px solid ${color}`,
    background: hexToRgba(color, 0.06),
    color: colors.text,
    fontSize: 14,
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <ArtifactChevron
          id={id}
          depth={depth}
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          onToggle={onToggleExpanded}
        />
        <button
          type="button"
          data-testid={`artifact-row-${id}`}
          style={rowStyle}
          onClick={() => onOpen(id)}
        >
          <Icon size={16} color={color} aria-hidden="true" />
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
      </div>
      {hasChildren && isExpanded && (
        <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {childIds.map((childId) => (
            <ArtifactNode
              key={childId}
              id={childId}
              depth={depth + 1}
              tree={tree}
              expandedIds={expandedIds}
              onToggleExpanded={onToggleExpanded}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ArtifactChevron({
  id,
  depth,
  hasChildren,
  isExpanded,
  onToggle,
}: {
  readonly id: string;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
  readonly onToggle: (id: string) => void;
}): ReactElement {
  const hitBoxStyle: CSSProperties = {
    width: CHEVRON_HIT,
    minHeight: CHEVRON_HIT,
    marginLeft: depth * INDENT_PX,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.muted,
    fontSize: 13,
  };

  if (!hasChildren) {
    return <span aria-hidden="true" style={hitBoxStyle} />;
  }

  return (
    <button
      type="button"
      data-testid={`artifact-chevron-${id}`}
      aria-label={isExpanded ? "Collapse" : "Expand"}
      style={{ ...hitBoxStyle, border: "none", background: "transparent", cursor: "pointer" }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(id);
      }}
    >
      {isExpanded ? "▾" : "▸"}
    </button>
  );
}
