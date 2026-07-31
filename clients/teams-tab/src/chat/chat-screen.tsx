/**
 * One chat: its conversation and the approvals waiting on you.
 *
 * ONE SUBSCRIPTION serves both — see `./use-chat`. Approvals appear ABOVE the
 * transcript because they are the reason to open this screen; the
 * conversation is the context for deciding, not the other way round.
 */
import type { ReactElement } from "react";
import {
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Subtitle1,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import { FleetError, FleetLoading } from "../fleet/fleet-state";
import { ApprovalCard } from "./approval-card";
import { TranscriptView } from "./transcript-view";
import { chatActionability } from "./actionability";
import type { ChatController } from "./use-chat";

const useStyles = makeStyles({
  section: { marginTop: tokens.spacingVerticalL },
  approvals: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
});

export interface ChatScreenProps {
  readonly controller: ChatController;
  /** The chat's epic-doc row, for locality. `null` on a deep link. */
  readonly entry: EpicChatEntry | null;
  readonly configuredHostId: string;
  readonly now: number;
  readonly onBack: () => void;
}

export function ChatScreen({
  controller,
  entry,
  configuredHostId,
  now,
  onBack,
}: ChatScreenProps): ReactElement {
  const styles = useStyles();
  const { state, phases, approve, reject } = controller;

  /**
   * A deep-linked chat has no epic-doc row yet, so locality is UNKNOWN — not
   * actionable. That is the correct default: acting on a chat whose host we
   * cannot establish is the case both of the tracker's settle routes report
   * as success.
   */
  const actionability =
    state.kind !== "ready"
      ? ({ kind: "unknown" } as const)
      : entry === null
        ? ({ kind: "unknown" } as const)
        : chatActionability(entry, configuredHostId, state.access);

  return (
    <>
      <Breadcrumb aria-label="Location">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={onBack}>Epics</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {state.kind === "ready" ? state.title : "Chat"}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <Subtitle1>{state.kind === "ready" ? state.title : "Chat"}</Subtitle1>

      {state.kind === "loading" ? (
        <FleetLoading rows={4} slowAfterMs={2500} label="Opening the chat…" />
      ) : state.kind === "error" ? (
        <FleetError
          title="Couldn’t open this chat"
          subject="this conversation"
          detail={state.detail}
        />
      ) : (
        <>
          {state.approvals.length > 0 ? (
            <>
              <Subtitle2 className={styles.section}>Waiting on you</Subtitle2>
              <div className={styles.approvals}>
                {state.approvals.map((approval) => (
                  <ApprovalCard
                    key={approval.approvalId}
                    toolName={approval.toolName}
                    description={approval.description}
                    phase={phases[approval.approvalId] ?? { kind: "idle" }}
                    actionability={actionability}
                    onApprove={() => {
                      approve(approval.approvalId);
                    }}
                    onReject={(reason) => {
                      reject(approval.approvalId, reason);
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}

          <Subtitle2 className={styles.section}>Conversation</Subtitle2>
          <TranscriptView messages={state.messages} now={now} />
        </>
      )}
    </>
  );
}
