/**
 * One artifact's body, opened from the epic's artifact tree.
 *
 * The renderer (`ArtifactMarkdown`) and the byte retention
 * (`ArtifactRoomRegistry`, fed by `useEpicAgents`) already existed — this is
 * the missing middle step, `useArtifactBody`'s Y.Doc-to-markdown pipeline,
 * wired to an actual door. See `parity-contract` §*Two renderers with no
 * door*.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Caption1,
  Subtitle1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import type { ArtifactRoomRegistry } from "@traycer-clients/shared/epic/artifact-room-registry";
import { FleetLoading } from "../fleet/fleet-state";
import { ArtifactMarkdown } from "./artifact-markdown";
import { useArtifactBody } from "./use-artifact-body";

const useStyles = makeStyles({
  subtle: { color: tokens.colorNeutralForeground3 },
  notice: {
    marginTop: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
  },
});

export interface ArtifactViewerProps {
  readonly entry: EpicArtifactEntry;
  /** `null` while the epic's agents subscription hasn't produced one yet. */
  readonly registry: ArtifactRoomRegistry | null;
  readonly onBack: () => void;
}

export function ArtifactViewer({ entry, registry, onBack }: ArtifactViewerProps): ReactElement {
  const styles = useStyles();
  const state = useArtifactBody(registry, entry.artifactRoomId, entry.id);

  return (
    <>
      <Breadcrumb aria-label="Location">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={onBack}>Artifacts</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>{entry.title}</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <Subtitle1>{entry.title}</Subtitle1>

      {state.kind === "loading" ? (
        <FleetLoading rows={4} slowAfterMs={2500} label="Opening the artifact…" />
      ) : state.kind === "unavailable" ? (
        <div className={styles.notice}>
          <Body1>Not available from this host right now.</Body1>
        </div>
      ) : state.kind === "retrying" ? (
        <div className={styles.notice}>
          <Body1>Reconnecting…</Body1>
        </div>
      ) : state.kind === "error" ? (
        <div className={styles.notice}>
          <Body1>Couldn’t render this artifact.</Body1>
          <Caption1 className={styles.subtle}>{state.message}</Caption1>
        </div>
      ) : (
        <ArtifactMarkdown body={state.markdown} />
      )}
    </>
  );
}
