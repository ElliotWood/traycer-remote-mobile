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
import { InterviewCard } from "./interview-card";
import { chatActionability } from "./actionability";
import type { ChatController } from "./use-chat";
import type { SnapshotDiffClient } from "./blocks/use-snapshot-diff";

const useStyles = makeStyles({
  section: { marginTop: tokens.spacingVerticalL },
  approvals: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
});

/**
 * Where this chat is being drawn, and therefore what chrome it owns.
 *
 * A canvas pane ALREADY names the chat — `tab-strip.tsx` renders
 * `tileTitle(ref)` — and `canvas-screen.tsx` already carries a breadcrumb. So
 * a chat rendered in a pane must draw neither. The naive wiring (render the
 * screen inside the pane and change nothing) produces two breadcrumbs stacked
 * and the title twice, which reads as a rendering bug rather than a layout.
 *
 * A UNION rather than a `showChrome` boolean, because `onBack` exists in only
 * one of the two states. A pane has no "back" — it has a close button that
 * belongs to the strip, and closing is not going back. Modelling this as an
 * optional callback would leave every pane caller passing a function that
 * must never be called, which is the shape that eventually gets called.
 */
export type ChatChrome =
  | { readonly kind: "screen"; readonly onBack: () => void }
  | { readonly kind: "pane" };

export interface ChatScreenProps {
  readonly controller: ChatController;
  /** The chat's epic-doc row, for locality. `null` on a deep link. */
  readonly entry: EpicChatEntry | null;
  readonly configuredHostId: string;
  /**
   * The UNARY client, for the diff bodies inside `file_change` /
   * `artifact_operation` cards. Distinct from the stream the controller
   * holds: a diff is a request/response, not a subscription.
   */
  readonly diffClient: SnapshotDiffClient | null;
  readonly now: number;
  readonly chrome: ChatChrome;
}

export function ChatScreen({
  controller,
  entry,
  configuredHostId,
  diffClient,
  now,
  chrome,
}: ChatScreenProps): ReactElement {
  const styles = useStyles();
  const { state, phases, approve, reject, answerInterview } = controller;

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
      {chrome.kind === "screen" ? (
        <>
          <Breadcrumb aria-label="Location">
            <BreadcrumbItem>
              <BreadcrumbButton onClick={chrome.onBack}>Epics</BreadcrumbButton>
            </BreadcrumbItem>
            <BreadcrumbDivider />
            <BreadcrumbItem>
              <BreadcrumbButton current>
                {state.kind === "ready" ? state.title : "Chat"}
              </BreadcrumbButton>
            </BreadcrumbItem>
          </Breadcrumb>

          <Subtitle1>{state.kind === "ready" ? state.title : "Chat"}</Subtitle1>
        </>
      ) : null}

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
          {/*
            Unanswered interviews, pulled out of the transcript.

            They are pending owner actions like approvals, so they belong
            beside them rather than buried where the conversation happens to
            have reached. An already-answered block stays inline as history.
          */}
          {state.kind === "ready" &&
            state.messages
              .flatMap((m) => m.blocks)
              .filter(
                (b) => b.kind === "interview" && !b.answered,
              )
              .map((b) =>
                b.kind !== "interview" ? null : (
                  <InterviewCard
                    key={b.blockId}
                    title={b.title}
                    questions={b.questions}
                    phase={phases[b.blockId] ?? { kind: "idle" }}
                    actionability={actionability}
                    onAnswer={(answers) => {
                      answerInterview(b.blockId, answers);
                    }}
                  />
                ),
              )}

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
          <TranscriptView
            messages={state.messages}
            blockTrees={state.blockTrees}
            client={diffClient}
            now={now}
          />
        </>
      )}
    </>
  );
}
