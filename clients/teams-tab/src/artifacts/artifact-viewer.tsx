/**
 * One artifact's body AND its comment threads, opened from the epic's
 * artifact tree.
 *
 * The renderer (`ArtifactMarkdown`) and the byte retention
 * (`ArtifactRoomRegistry`, fed by `useEpicAgents`) already existed — this is
 * the missing middle step, `useArtifactBody`'s Y.Doc-to-markdown pipeline,
 * wired to an actual door. See `parity-contract` §*Two renderers with no
 * door*.
 *
 * **The second renderer in that section is `CommentsPanel`, and it is wired
 * here.** It had the same shape as the body did — a good panel reachable only
 * from `?preview=comments`, against `COMMENTS_FIXTURE`, with `onReply` and
 * `onSetResolved` as `() => undefined`. A fixture route is not a door.
 *
 * TWO INDEPENDENT LOADS, TWO INDEPENDENT STATES, for the reason
 * `use-settings.ts` states: the body comes over the epic's Y.Doc stream and
 * the threads over three unary RPCs, so either can fail without the other.
 * Folding them into one state would take the comments down whenever an
 * artifact's bytes had not arrived — and the comments are the half that still
 * works when the document does not.
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
import { CommentsPanel } from "../comments/comments-panel";
import {
  useCommentThreads,
  type CommentThreadsClient,
} from "../comments/use-comment-threads";
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
  readonly epicId: string;
  /** `null` under any preview and when no host is configured. */
  readonly client: CommentThreadsClient | null;
  /** For the threads' relative timestamps, from the screen's own clock. */
  readonly now: number;
  readonly onBack: () => void;
}

export function ArtifactViewer({
  entry,
  registry,
  epicId,
  client,
  now,
  onBack,
}: ArtifactViewerProps): ReactElement {
  const styles = useStyles();
  const state = useArtifactBody(registry, entry.artifactRoomId, entry.id);
  /*
   * `entry.kind` IS the wire's `artifactType`, not a value that needs mapping.
   * `EpicArtifactEntry["kind"]` is `"spec" | "ticket" | "story" | "review"`,
   * which is `LatestEpicArtifactKindSchema` exactly — checked rather than
   * assumed, because a silent widening here would send a kind the host
   * rejects for an artifact the tree happily displayed.
   */
  const comments = useCommentThreads(client, {
    epicId,
    artifactType: entry.kind,
    artifactId: entry.id,
  });

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

      {/*
        Rendered whatever the BODY did, including when it failed — the two
        loads are independent and a document whose bytes have not arrived
        still has comments worth reading. The heading is unconditional so the
        section never silently disappears; an artifact with no threads says so
        through `CommentsPanel`'s own empty state.
      */}
      <Subtitle1>Comments</Subtitle1>

      {comments.state.kind === "loading" ? (
        <FleetLoading rows={2} slowAfterMs={2500} label="Loading comments…" />
      ) : comments.state.kind === "error" ? (
        <div className={styles.notice}>
          <Body1>Couldn’t load comments.</Body1>
          <Caption1 className={styles.subtle}>{comments.state.detail}</Caption1>
        </div>
      ) : (
        <>
          {/*
            A failed WRITE is reported beside the threads rather than replacing
            them: the list on screen is still the host's last authoritative
            answer, and blanking it would lose the reply the user is trying to
            resend.
          */}
          {comments.state.actionError !== null ? (
            <Caption1 className={styles.subtle} role="alert">
              Couldn’t save that: {comments.state.actionError}
            </Caption1>
          ) : null}
          <CommentsPanel
            threads={comments.state.threads}
            now={now}
            busyThreadId={comments.state.busyThreadId}
            onReply={comments.reply}
            onSetResolved={comments.setResolved}
          />
        </>
      )}
    </>
  );
}
