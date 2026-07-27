/**
 * Top-level `artifact` route (U1 fix): resolves `artifactId` against the
 * shared `useCurrentEpicDoc()` doc (the same session EpicView/ChatView
 * already read — no second `epic.subscribe`) and renders `ArtifactBodyView`.
 * A stale/not-yet-projected id (the doc hasn't loaded, or the artifact was
 * deleted elsewhere) degrades to an explicit message rather than a blank
 * screen — mirrors the old EpicView-local drill's same stale-id handling.
 */
import { useEffect, type ReactElement } from "react";
import { useCurrentEpicDoc } from "@/host/current-epic-context";
import { useArtifactNav } from "@/host/artifact-nav-context";
import { markSeen } from "@/host/read-tracking-store";
import { ArtifactBodyView } from "./artifact-body-view";
import { screen } from "./design-tokens";
import { colors } from "./ui";

export interface ArtifactRouteViewProps {
  readonly epicId: string;
  readonly artifactId: string;
}

export function ArtifactRouteView({ epicId, artifactId }: ArtifactRouteViewProps): ReactElement {
  const { artifacts, artifactRooms, docLoaded } = useCurrentEpicDoc();
  const { openArtifact } = useArtifactNav();
  const artifact = artifacts.find((a) => a.id === artifactId);

  useEffect(() => {
    if (artifact !== undefined) markSeen(epicId, artifact.id);
  }, [epicId, artifact]);

  if (artifact === undefined) {
    return (
      <main style={screen}>
        <p role="status" style={{ color: colors.muted, marginTop: 16 }}>
          {docLoaded ? "Couldn't find that artifact." : "Loading…"}
        </p>
      </main>
    );
  }

  return (
    <ArtifactBodyView
      epicId={epicId}
      artifact={artifact}
      artifacts={artifacts}
      artifactRooms={artifactRooms}
      onOpenArtifact={(childArtifactId) => openArtifact(epicId, childArtifactId)}
    />
  );
}
