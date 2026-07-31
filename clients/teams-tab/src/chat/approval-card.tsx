/**
 * One pending approval, with the two actions that resolve it.
 *
 * THE DENSEST ROW IN THE APP: a description, two buttons, an optional reason
 * field and a status line. 320px is where it breaks, so that width is shot
 * specifically rather than inferred from the desktop one.
 *
 * The state machine and its three wording constraints live in
 * `./action-state` — the row renders them and does not restate them.
 */
import { useState, type ReactElement } from "react";
import {
  Body1,
  Button,
  Caption1,
  Field,
  makeStyles,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkRegular,
  DismissRegular,
  ShieldTaskRegular,
} from "@fluentui/react-icons";
import {
  actionPhaseMessage,
  actionsEnabled,
  type ActionPhase,
} from "./action-state";
import {
  actionabilityReason,
  type Actionability,
} from "./actionability";

const useStyles = makeStyles({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  /**
   * The description WRAPS rather than truncating.
   *
   * Every other surface truncates because a row is a navigation target. This
   * one is a decision: the user is being asked to approve this specific
   * thing, and an ellipsised tool call is not enough to decide on. Truncating
   * here would be optimising the wrong axis.
   */
  what: { overflowWrap: "anywhere" },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  status: { color: tokens.colorNeutralForeground3 },
  /** Unconfirmed reads as a warning, not a failure — it may have applied. */
  unconfirmed: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

export interface ApprovalCardProps {
  readonly toolName: string;
  readonly description: string;
  readonly phase: ActionPhase;
  /**
   * Whether owner frames for this chat can reach anything.
   *
   * Not actionable → NO BUTTONS, and the reason stated in their place. The
   * gate is here rather than a disabled button because a disabled control
   * still says "this is the thing you would do", and the honest message is
   * that this client is in the wrong place — with a pointer to where it
   * would work.
   */
  readonly actionability: Actionability;
  readonly onApprove: () => void;
  readonly onReject: (reason: string | null) => void;
}

export function ApprovalCard({
  toolName,
  description,
  phase,
  actionability,
  onApprove,
  onReject,
}: ApprovalCardProps): ReactElement {
  const styles = useStyles();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);
  const blockedReason = actionabilityReason(actionability);
  const enabled = blockedReason === null && actionsEnabled(phase);
  const message = actionPhaseMessage(phase);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span aria-hidden className={styles.icon}>
          <ShieldTaskRegular fontSize={18} />
        </span>
        <Caption1>{toolName}</Caption1>
      </div>
      <Body1 className={styles.what}>{description}</Body1>

      {blockedReason !== null ? (
        // Stated INSTEAD of the buttons, not beside them.
        <Caption1 className={styles.status} role="status">
          {blockedReason}
        </Caption1>
      ) : null}

      {blockedReason === null && showReason ? (
        <Field
          // OPTIONAL, and labelled as such. A required reason blocks the
          // fastest legitimate action — "no, obviously not" — and users type
          // "no" to satisfy a validator, which is worse than an empty reason
          // because it looks like information and is not.
          label="Reason (optional)"
          hint="The agent sees this and can act on it."
        >
          <Textarea
            value={reason}
            disabled={!enabled}
            resize="vertical"
            onChange={(_, data) => {
              setReason(data.value);
            }}
          />
        </Field>
      ) : null}

      {blockedReason !== null ? null : (
      <div className={styles.actions}>
        <Button
          appearance="primary"
          icon={<CheckmarkRegular />}
          // Disabled while in flight so a second click cannot mint a second
          // `clientActionId` — two frames for one decision.
          disabled={!enabled}
          onClick={onApprove}
        >
          Approve
        </Button>
        <Button
          icon={<DismissRegular />}
          disabled={!enabled}
          onClick={() => {
            // First press reveals the optional reason; second sends. Keeps
            // reject one click away for the common case while making the
            // field discoverable rather than hidden.
            if (!showReason) {
              setShowReason(true);
              return;
            }
            onReject(reason.trim().length > 0 ? reason.trim() : null);
          }}
        >
          {showReason ? "Send rejection" : "Reject"}
        </Button>
      </div>
      )}

      {message === null ? null : (
        <Caption1
          // `alert` for the unconfirmed case: it needs the user to go look,
          // and a polite announcement arrives after they have moved on.
          role={phase.kind === "unconfirmed" ? "alert" : "status"}
          className={
            phase.kind === "unconfirmed" ? styles.unconfirmed : styles.status
          }
        >
          {message}
        </Caption1>
      )}
    </div>
  );
}
