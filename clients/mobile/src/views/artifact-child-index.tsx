/**
 * P3 — child-artifact index, rendered below an open artifact's body content.
 * Mirrors desktop's `ArtifactChildIndex` (`epic-canvas/renderers/`): derived
 * straight from the same epic-doc artifact list the tree already holds (no
 * separate query), returns `null` entirely when there are no children.
 */
import type { ReactElement } from "react";
import type { EpicArtifactEntry } from "@/host/use-epic-doc";
import { KIND_COLORS, KIND_ICONS, StatusDot, displayArtifactTitle } from "./kind-tokens";
import { colors } from "./ui";

export interface ArtifactChildIndexProps {
  readonly parentId: string;
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly onOpen: (artifactId: string) => void;
}

/** Direct children only (one level) — same `updatedAt` DESC / id ASC order as the tree's default sort. */
function childrenOf(
  parentId: string,
  artifacts: readonly EpicArtifactEntry[],
): readonly EpicArtifactEntry[] {
  return artifacts
    .filter((a) => a.parentId === parentId)
    .sort((a, b) => (a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.id.localeCompare(b.id)));
}

export function ArtifactChildIndex({ parentId, artifacts, onOpen }: ArtifactChildIndexProps): ReactElement | null {
  const children = childrenOf(parentId, artifacts);
  if (children.length === 0) return null;

  return (
    <nav
      aria-label="Child artifacts"
      style={{ borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border, marginTop: 20, paddingTop: 10 }}
    >
      {children.map((child) => {
        const Icon = KIND_ICONS[child.kind];
        const color = KIND_COLORS[child.kind];
        return (
          <button
            key={child.id}
            type="button"
            data-testid={`artifact-child-${child.id}`}
            onClick={() => onOpen(child.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              minHeight: 40,
              padding: "6px 4px",
              border: "none",
              background: "transparent",
              color: colors.text,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <Icon size={16} color={color} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayArtifactTitle(child.title, child.kind)}
            </span>
            <StatusDot kind={child.kind} status={child.status ?? undefined} />
          </button>
        );
      })}
    </nav>
  );
}
