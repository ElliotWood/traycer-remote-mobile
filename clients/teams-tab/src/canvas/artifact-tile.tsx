/**
 * An artifact's body, rendered as the body of a canvas pane.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS DIALS NOTHING, AND THAT IS THE WHOLE POINT OF THE CHANGE THAT ADDED IT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `canvas-screen.tsx`'s subscription invariant says a tile body must read from
 * the epic doc passed down and must not dial anything itself. An artifact's
 * bytes ride the SAME `epic.subscribe` session as its `ArtifactRoomRegistry`,
 * so honouring that invariant here is not a matter of restraint — there is no
 * second subscription that would even work. The registry has to arrive as a
 * prop, and until `app.tsx` shared one subscription across the `epic` and
 * `canvas` routes there was nothing to pass, which is why this tile rendered a
 * placeholder rather than a body.
 *
 * Unlike `ChatTile`, which genuinely does open a `chat.subscribe` because a
 * transcript lives in no doc, this component opens nothing at all.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS TWO COMPONENTS AND NOT ONE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `useArtifactBody` needs an `artifactRoomId`, and a `TileRef` does not carry
 * one — a tile holds content IDENTITY only, deliberately, so that persisting a
 * layout persists no live state. The room id comes from the epic doc's row for
 * that artifact, which is a LOOKUP that can legitimately answer `null`.
 *
 * A single component would therefore have to call the hook with a placeholder
 * id on the null branch, and asking the registry for room `""` produces a
 * state that is indistinguishable, on screen, from a real artifact that failed
 * to load. Splitting on the component boundary is what makes the hook
 * unconditional while the DECISION stays conditional — the same device
 * `app.tsx` uses for `EpicScreen`, and for the same stated reason: a
 * subscription must not be opened by a conditional branch of a larger
 * component.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO TITLE, NO BREADCRUMB — pane chrome is none
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ArtifactViewer` renders both, correctly: it is a full screen reached from
 * the artifacts tree and the user needs a way back. A pane's tab strip already
 * shows the artifact's name and already has a close control, so repeating the
 * title inside the body is chrome duplicated at the one size where space is
 * scarcest. Same split as `ChatTile` vs `ChatRoute`.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import type { ArtifactRoomRegistry } from "@traycer-clients/shared/epic/artifact-room-registry";
import { FleetLoading } from "../fleet/fleet-state";
import { ArtifactMarkdown } from "../artifacts/artifact-markdown";
import { useArtifactBody } from "../artifacts/use-artifact-body";

const useStyles = makeStyles({
  /**
   * The pane is the scroll container, not the page — the same containment pair
   * `ChatTile` documents. `minHeight: 0` is the load-bearing half: without it
   * a flex child refuses to shrink below its content, and a long spec pushes
   * the pane past its allotted extent instead of scrolling inside it, which
   * presents as the split handle "not working".
   */
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    minHeight: 0,
    height: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
  },
  notice: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalL,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

export interface ArtifactTileProps {
  /**
   * The artifact's epic-doc row, or `null` when the doc has no row under this
   * tile's id.
   */
  readonly entry: EpicArtifactEntry | null;
  /** `null` until the epic subscription has produced a registry. */
  readonly registry: ArtifactRoomRegistry | null;
  /**
   * Whether the epic doc's artifact list has arrived.
   *
   * Load-bearing, and the reason this is a prop rather than something derived
   * from `entry`: a `null` entry means two completely different things before
   * and after the list lands — *"not here yet"* and *"not in this epic"* — and
   * only one of them is worth waiting on. Without this flag the tile would
   * have to pick one, and picking "loading" gives a tab that spins forever on
   * an artifact that was deleted.
   */
  readonly listReady: boolean;
  /** The tile's own name, so the gone-state can say WHICH artifact is gone. */
  readonly title: string;
}

export function ArtifactTile({
  entry,
  registry,
  listReady,
  title,
}: ArtifactTileProps): ReactElement {
  const styles = useStyles();

  if (entry === null) {
    return (
      <div className={styles.body}>
        {listReady ? (
          <div className={styles.notice}>
            <Body1>This artifact is no longer in this epic.</Body1>
            <Caption1 className={styles.subtle}>
              {title} was open in this pane. Close the tab to tidy up.
            </Caption1>
          </div>
        ) : (
          <FleetLoading rows={4} slowAfterMs={2500} label="Opening the artifact…" />
        )}
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <ArtifactTileBody entry={entry} registry={registry} />
    </div>
  );
}

/**
 * The half that reads bytes. Mounted only once an `entry` exists, so its hook
 * is never handed an id it cannot resolve.
 */
function ArtifactTileBody({
  entry,
  registry,
}: {
  readonly entry: EpicArtifactEntry;
  readonly registry: ArtifactRoomRegistry | null;
}): ReactElement {
  const styles = useStyles();
  const state = useArtifactBody(registry, entry.artifactRoomId, entry.id);

  if (state.kind === "loading") {
    return <FleetLoading rows={4} slowAfterMs={2500} label="Opening the artifact…" />;
  }
  if (state.kind === "unavailable") {
    return (
      <div className={styles.notice}>
        <Body1>Not available from this host right now.</Body1>
      </div>
    );
  }
  if (state.kind === "retrying") {
    return (
      <div className={styles.notice}>
        <Body1>Reconnecting…</Body1>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={styles.notice}>
        <Body1>Couldn’t render this artifact.</Body1>
        <Caption1 className={styles.subtle}>{state.message}</Caption1>
      </div>
    );
  }
  return <ArtifactMarkdown body={state.markdown} />;
}
