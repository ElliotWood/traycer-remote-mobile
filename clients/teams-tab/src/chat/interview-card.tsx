/**
 * An interview: the agent asking a human a question, and the answer going back.
 *
 * Shares the phase machine, the actionability gate and the wording constraints
 * with `ApprovalCard` — an answer is an owner frame like any other, and the
 * ack proves the frame was processed rather than that it changed anything.
 *
 * Free text per question. The schema supports options and multi-select; those
 * render as text here, which is a REDUCTION and is stated rather than hidden —
 * a user typing an option's name is answering the question, whereas a picker
 * that silently dropped options would not be.
 */
import { useState, type ReactElement } from "react";
import {
  Button,
  Caption1,
  Field,
  makeStyles,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { PersonQuestionMarkRegular, SendRegular } from "@fluentui/react-icons";
import {
  actionPhaseMessage,
  actionsEnabled,
  type ActionPhase,
} from "./action-state";
import { actionabilityReason, type Actionability } from "./actionability";

const useStyles = makeStyles({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  question: { overflowWrap: "anywhere" },
  status: { color: tokens.colorNeutralForeground3 },
  unconfirmed: { color: tokens.colorPaletteDarkOrangeForeground1 },
  send: { alignSelf: "flex-start" },
});

export interface InterviewAnswerDraft {
  readonly questionId: string | null;
  readonly question: string;
  readonly value: string;
}

export interface InterviewCardProps {
  readonly title: string | null;
  readonly questions: readonly {
    readonly questionId: string | null;
    readonly question: string;
  }[];
  readonly phase: ActionPhase;
  readonly actionability: Actionability;
  readonly onAnswer: (answers: readonly InterviewAnswerDraft[]) => void;
}

export function InterviewCard({
  title,
  questions,
  phase,
  actionability,
  onAnswer,
}: InterviewCardProps): ReactElement {
  const styles = useStyles();
  const [values, setValues] = useState<Record<number, string>>({});
  const blockedReason = actionabilityReason(actionability);
  const enabled = blockedReason === null && actionsEnabled(phase);
  const message = actionPhaseMessage(phase);
  // EVERY question must be answered before sending. A partial answer set is
  // accepted by the wire and leaves the agent asking again — one interruption
  // becoming two, which is the same cost the optional reject-reason avoids.
  const complete = questions.every(
    (_, i) => (values[i] ?? "").trim().length > 0,
  );

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span aria-hidden className={styles.icon}>
          <PersonQuestionMarkRegular fontSize={18} />
        </span>
        <Caption1>{title ?? "The agent has a question"}</Caption1>
      </div>

      {questions.map((q, i) => (
        <Field key={q.questionId ?? String(i)} label={q.question}>
          <Textarea
            value={values[i] ?? ""}
            disabled={!enabled}
            resize="vertical"
            onChange={(_, data) => {
              setValues((prev) => ({ ...prev, [i]: data.value }));
            }}
          />
        </Field>
      ))}

      {blockedReason !== null ? (
        <Caption1 className={styles.status} role="status">
          {blockedReason}
        </Caption1>
      ) : (
        <Button
          className={styles.send}
          appearance="primary"
          icon={<SendRegular />}
          disabled={!enabled || !complete}
          onClick={() => {
            onAnswer(
              questions.map((q, i) => ({
                questionId: q.questionId,
                question: q.question,
                value: (values[i] ?? "").trim(),
              })),
            );
          }}
        >
          Send answer
        </Button>
      )}

      {message === null ? null : (
        <Caption1
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
