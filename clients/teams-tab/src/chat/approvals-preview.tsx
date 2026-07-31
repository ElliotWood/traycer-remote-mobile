/**
 * Every action phase, side by side, at a fixed width.
 *
 * The unhappy states are where this goes wrong and the least likely to be hit
 * by hand: `pending` lasts as long as a round trip, `unconfirmed` needs a
 * partition, `rejected` needs a host that says no. Rendering all five at once
 * is the only way anyone reviews them.
 */
import type { ReactElement } from "react";
import { makeStyles, Subtitle2, tokens } from "@fluentui/react-components";
import { ApprovalCard } from "./approval-card";
import type { ActionPhase } from "./action-state";
import type { Actionability } from "./actionability";

const useStyles = makeStyles({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
});

const DESCRIPTION =
  "Write clients/teams-tab/src/chat/approval-card.tsx (+128 −0). Adds the approval row with approve and reject actions.";

const PHASES: readonly {
  readonly label: string;
  readonly phase: ActionPhase;
  readonly actionability?: Actionability;
}[] = [
    { label: "Idle", phase: { kind: "idle" } },
    { label: "Pending", phase: { kind: "pending", verb: "Approving" } },
    { label: "Applied", phase: { kind: "applied" } },
    {
      label: "Rejected by host",
      phase: { kind: "rejected", reason: "tool is not permitted in this mode" },
    },
    {
      label: "Unconfirmed",
      phase: { kind: "unconfirmed", reason: "reconcile window expired" },
    },
    // The common case in a real epic — 53 of 56 chats. No buttons at all.
    {
      label: "On another host",
      phase: { kind: "idle" },
      actionability: { kind: "other-host" },
    },
    {
      label: "Host not established",
      phase: { kind: "idle" },
      actionability: { kind: "unknown" },
    },
    // PERMISSION, not reachability — a different reason, so different words.
    {
      label: "View-only access",
      phase: { kind: "idle" },
      actionability: { kind: "viewer" },
    },
    {
      label: "Stream reconnecting",
      phase: { kind: "idle" },
      actionability: { kind: "stream-not-live" },
    },
  ];

export function ApprovalsPreview(): ReactElement {
  const styles = useStyles();
  return (
    <div className={styles.wrap}>
      {PHASES.map(({ label, phase, actionability }) => (
        <div key={label}>
          <Subtitle2>{label}</Subtitle2>
          <ApprovalCard
            toolName="Edit"
            description={DESCRIPTION}
            phase={phase}
            actionability={actionability ?? { kind: "actionable" }}
            onApprove={() => undefined}
            onReject={() => undefined}
          />
        </div>
      ))}
    </div>
  );
}
