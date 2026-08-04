/**
 * One epic, reached by drilling in from the list.
 *
 * WHAT IS AND IS NOT HERE YET. The agents inside an epic come from the epic's
 * Y.Doc (`epic.subscribe`), not from `agent.list` — that RPC needs a
 * `senderAgentId` as well as an `epicId`, and a signed-in human has no agent
 * identity, so having an epic id does NOT unblock it the way we expected.
 * `epic.subscribe` is a stream rather than a unary call, so it lands next.
 *
 * Rather than render an empty shell, this screen shows what it genuinely
 * knows — the epic's own metadata, carried from the row that opened it — and
 * says plainly that the agent list is unfinished work rather than an empty
 * epic. Same rule as the signed-in placeholder: absence must be attributed,
 * or the user assumes their data is missing.
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
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { epicDisplayName, type FleetEpic } from "@traycer-clients/shared/epic/epic-list";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";
import { AgentsList } from "./agents-list";
import { ArtifactsTree } from "./artifacts-tree";
import type { EpicAgentsState } from "./use-epic-agents";

const useStyles = makeStyles({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  title: { overflowWrap: "anywhere" },
  subtle: { color: tokens.colorNeutralForeground3 },
  section: { marginTop: tokens.spacingVerticalL },
  pending: {
    marginTop: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export interface EpicDetailProps {
  /**
   * The row that was clicked, when the user arrived by clicking.
   *
   * `null` on a DEEP LINK or a reload, where the id is in the URL and nothing
   * has fetched the epic yet. The screen must therefore work without it —
   * a detail view that only renders when navigated to from the list is a
   * detail view that breaks on refresh, which is exactly what real routing
   * was adopted to avoid.
   */
  readonly epic: FleetEpic | null;
  readonly epicId: string;
  readonly onBack: () => void;
  readonly agents: EpicAgentsState;
  readonly configuredHostId: string;
  readonly now: number;
  readonly onOpenAgent: (chatId: string, entry: EpicChatEntry) => void;
  readonly onOpenArtifact: (entry: EpicArtifactEntry) => void;
}

export function EpicDetail({
  epic,
  epicId,
  onBack,
  agents,
  configuredHostId,
  now,
  onOpenAgent,
  onOpenArtifact,
}: EpicDetailProps): ReactElement {
  const styles = useStyles();
  const name = epic === null ? null : epicDisplayName(epic);

  return (
    <>
      {/*
        Breadcrumb rather than relying on browser back: a Teams tab is chrome
        inside chrome, and the browser's back control is not where a Teams
        user looks. Back still works — this is the visible route home.
      */}
      <Breadcrumb aria-label="Location">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={onBack}>Epics</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {name ?? `Epic ${epicId.slice(0, 8)}`}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.header}>
        <Subtitle1 className={styles.title}>
          {name ?? `Epic ${epicId.slice(0, 8)}`}
        </Subtitle1>
        {epic === null ? (
          // Says WHY the name is missing. An id where a title belongs, with
          // no explanation, reads as the epic being broken.
          <Caption1 className={styles.subtle}>
            Opened directly, so only the id is known so far.
          </Caption1>
        ) : null}
      </div>

      <Subtitle2 className={styles.section}>Agents</Subtitle2>
      <AgentsList
        state={agents}
        now={now}
        configuredHostId={configuredHostId}
        onOpen={onOpenAgent}
      />

      <Subtitle2 className={styles.section}>Artifacts</Subtitle2>
      {agents.kind === "ready" ? (
        <ArtifactsTree
          tree={agents.artifacts}
          now={now}
          onOpen={onOpenArtifact}
        />
      ) : (
        // Artifacts share the agents' subscription, so they share its states.
        // Rendering "no artifacts" while the snapshot is still in flight would
        // state something false for the whole 47s.
        <div className={styles.pending}>
          <Body1>Loading…</Body1>
        </div>
      )}
    </>
  );
}
