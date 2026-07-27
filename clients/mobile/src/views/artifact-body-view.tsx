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
import { CommentsPanelBody } from "./comments/comments-panel";
import { KIND_COLORS, KIND_ICONS, StatusDot, displayArtifactTitle } from "./kind-tokens";
import { MobileMarkdown } from "./markdown/mobile-markdown";
import { colors, screen, secondaryButton } from "./ui";

interface ArtifactBodyViewProps {
  readonly epicId: string;
  readonly artifact: EpicArtifactEntry;
  readonly artifactRooms: ArtifactRoomRegistry | null;
  readonly onBack: () => void;
}

export function ArtifactBodyView({
  epicId,
  artifact,
  artifactRooms,
  onBack,
}: ArtifactBodyViewProps): ReactElement {
  const body = useArtifactBody(artifactRooms, artifact.artifactRoomId, artifact.id);
  const Icon = KIND_ICONS[artifact.kind];
  const color = KIND_COLORS[artifact.kind];

  return (
    <main style={screen}>
      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 16 }}
        onClick={onBack}
      >
        ← Back
      </button>

      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Icon size={20} color={color} aria-hidden="true" />
        <h1 style={{ fontSize: 18, margin: 0, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {displayArtifactTitle(artifact.title, artifact.kind)}
        </h1>
        <StatusDot kind={artifact.kind} status={artifact.status ?? undefined} />
      </header>

      <ArtifactBodyContent state={body} />

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
