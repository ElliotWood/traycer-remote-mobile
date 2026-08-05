/**
 * Read-only artifact body (Mobile v2, Sprint 3 / M6, + Sprint 4 integration).
 *
 * Header = kind icon/color + title + status dot (Sprint 1's `kind-tokens`);
 * body = `useArtifactBody`'s state rendered via Sprint 1's `MobileMarkdown`
 * (markdown + mermaid + wireframe), with an explicit, never-blank message
 * for every degraded state (rubric §3: "artifact-room unavailable -> clear
 * message, not blank"). Below the body: Sprint 4's `CommentsPanelBody`
 * (embedded, no page chrome of its own) — the artifact body screen is
 * comments' real home, not the standalone `?comments=` harness route.
 */
import type { ReactElement } from "react";
import type { ArtifactRoomRegistry } from "@/host/artifact-room-registry";
import { useArtifactBody, type ArtifactBodyState } from "@/host/use-artifact-body";
import type { EpicArtifactEntry } from "@/host/use-epic-doc";
import { ArtifactChildIndex } from "./artifact-child-index";
import { CommentsPanelBody } from "./comments/comments-panel";
import { KIND_COLORS, KIND_ICONS, StatusPill, displayArtifactTitle } from "./kind-tokens";
import { MobileMarkdown } from "./markdown/mobile-markdown";
import { colors, screen } from "./ui";

interface ArtifactBodyViewProps {
  readonly epicId: string;
  readonly artifact: EpicArtifactEntry;
  /** P3: the epic's full artifact list, so the child-index below the body can find this artifact's children without a separate query. */
  readonly artifacts: readonly EpicArtifactEntry[];
  readonly artifactRooms: ArtifactRoomRegistry | null;
  /** P3: navigates to a child artifact (opens it in the SAME drill-in, replacing the current one). */
  readonly onOpenArtifact: (artifactId: string) => void;
}

export function ArtifactBodyView({
  epicId,
  artifact,
  artifacts,
  artifactRooms,
  onOpenArtifact,
}: ArtifactBodyViewProps): ReactElement {
  const body = useArtifactBody(artifactRooms, artifact.artifactRoomId, artifact.id);
  const Icon = KIND_ICONS[artifact.kind];
  const color = KIND_COLORS[artifact.kind];
  const showsStatus =
    artifact.status !== null && (artifact.kind === "ticket" || artifact.kind === "story");

  return (
    <main style={screen}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon size={20} color={color} aria-hidden="true" />
        <h1 style={{ fontSize: 18, margin: 0, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {displayArtifactTitle(artifact.title, artifact.kind)}
        </h1>
      </header>

      {showsStatus && (
        <div style={{ marginBottom: 16 }}>
          <StatusPill kind={artifact.kind} status={artifact.status ?? undefined} />
        </div>
      )}

      <ArtifactBodyContent state={body} />

      <ArtifactChildIndex parentId={artifact.id} artifacts={artifacts} onOpen={onOpenArtifact} />

      <hr style={{ border: 0, borderTop: `1px solid ${colors.border}`, margin: "24px 0" }} />

      <CommentsPanelBody
        epicId={epicId}
        artifactType={artifact.kind}
        artifactId={artifact.id}
      />
    </main>
  );
}

function ArtifactBodyContent({ state }: { readonly state: ArtifactBodyState }): ReactElement {
  switch (state.kind) {
    case "loading":
      return (
        <p role="status" style={{ color: colors.muted }}>
          Loading…
        </p>
      );
    case "ready":
      return <MobileMarkdown>{state.markdown}</MobileMarkdown>;
    case "unavailable":
      return (
        <p role="status" style={{ color: colors.muted }}>
          Not synced on this host.
        </p>
      );
    case "retrying":
      return (
        <p role="status" style={{ color: colors.muted }}>
          Reconnecting to this artifact…
        </p>
      );
    case "error":
      return (
        <p role="status" style={{ color: colors.danger }}>
          Couldn't render this artifact.
        </p>
      );
  }
}
