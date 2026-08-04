/**
 * An interview: the agent asking a human a question, and the answer going back.
 *
 * Shares the phase machine, the actionability gate and the wording constraints
 * with `ApprovalCard` — an answer is an owner frame like any other, and the
 * ack proves the frame was processed rather than that it changed anything.
 *
 * OPTIONS ARE RENDERED. Until 2026-08-04 this card showed a textarea for every
 * question and never read `q.options`, behind a docblock claiming the options
 * "render as text here" and that "a user typing an option's name is answering
 * the question". They did not render at all, so nobody could type one — the
 * disclosure described a mechanism that did not exist, and read as considered
 * enough to stop anyone checking.
 *
 * The damage was not a missing label. Free text is a LEGITIMATE `values` member
 * (it is how desktop's "Other" is sent), so an answer typed here was
 * indistinguishable on the wire from a deliberate refusal of every option, and
 * no layer could tell them apart even in principle. **Hence the hard rule
 * below: when a question has options, there is NO path that submits typed
 * text.** An extra textarea beside the buttons would restore the defect.
 *
 * Shape follows the mobile PWA (`chat-view.tsx`), the parity target: options →
 * buttons only; free text only when there are none. Desktop additionally has an
 * explicit "Other" affordance and mobile does not — that difference is
 * UNSETTLED BETWEEN THE REFERENCES, not a gap in either, and is Elliot's call.
 * Adding it later is a button beside the toggles, not a rework.
 */
import { useState, type ReactElement } from "react";
import {
  Button,
  Caption1,
  Field,
  makeStyles,
  Textarea,
  ToggleButton,
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
  group: { border: 0, margin: 0, padding: `0 0 ${tokens.spacingVerticalS}` },
  legend: {
    fontWeight: tokens.fontWeightSemibold,
    padding: 0,
    marginBottom: tokens.spacingVerticalXS,
    overflowWrap: "anywhere",
  },
  header: { color: tokens.colorNeutralForeground3, display: "block" },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    alignItems: "stretch",
  },
  option: { justifyContent: "flex-start", height: "auto", textAlign: "left" },
  optionLabel: { fontWeight: tokens.fontWeightSemibold },
  optionDescription: {
    display: "block",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
  },
  stranded: {
    display: "block",
    color: tokens.colorPaletteDarkOrangeForeground1,
    marginBottom: tokens.spacingVerticalXS,
  },
});

export interface InterviewAnswerDraft {
  readonly questionId: string | null;
  readonly question: string;
  /**
   * PLURAL, and the wire's own shape (`interviewAnswerSchema.values`). It was
   * a single `value: string` that `use-chat` wrapped as `[value]`, which is
   * exactly right for free text and cannot express a multi-select answer.
   */
  readonly values: readonly string[];
}

export interface InterviewCardProps {
  readonly title: string | null;
  readonly questions: readonly {
    readonly questionId: string | null;
    readonly question: string;
    readonly header: string | null;
    readonly options: readonly {
      readonly label: string;
      readonly description: string | null;
    }[];
    readonly multiSelect: boolean;
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
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, readonly string[]>>(
    {},
  );
  const blockedReason = actionabilityReason(actionability);
  const enabled = blockedReason === null && actionsEnabled(phase);
  const message = actionPhaseMessage(phase);

  /**
   * The ONE place an answer's values are derived, so the Send button, the
   * completeness gate and the submitted frame cannot disagree.
   *
   * The branch is on `options.length`, never on what the user typed: a
   * question with options yields selected labels or nothing. `texts` may hold
   * a leftover string for such a question (options can arrive later) and it is
   * deliberately unreachable from here — see `stranded` below.
   */
  const valuesFor = (index: number): readonly string[] => {
    const question = questions[index];
    if (question.options.length > 0) return selected[index] ?? [];
    const text = (texts[index] ?? "").trim();
    return text === "" ? [] : [text];
  };

  const toggle = (index: number, label: string, multiSelect: boolean): void => {
    setSelected((prev) => {
      const current = prev[index] ?? [];
      if (!multiSelect) {
        // Single-select re-tap CLEARS. Leaving it selected would make the
        // choice unrevisable without answering something else first.
        return { ...prev, [index]: current.includes(label) ? [] : [label] };
      }
      return {
        ...prev,
        [index]: current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label],
      };
    });
  };

  // EVERY question must be answered before sending. A partial answer set is
  // accepted by the wire and leaves the agent asking again — one interruption
  // becoming two, which is the same cost the optional reject-reason avoids.
  const complete = questions.every((_, i) => valuesFor(i).length > 0);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span aria-hidden className={styles.icon}>
          <PersonQuestionMarkRegular fontSize={18} />
        </span>
        <Caption1>{title ?? "The agent has a question"}</Caption1>
      </div>

      {questions.map((q, i) => {
        /**
         * A question that had no options yet (rendered as free text) can gain
         * them in a later snapshot. The branch above then flips to buttons and
         * a typed answer stops counting — silently, since the textarea it was
         * typed into is gone. The text is never deleted, only unsubmittable;
         * the user is told so rather than left to wonder.
         *
         * Ported from mobile (`chat-view.tsx`) because the condition is
         * produced by the HOST, so it is identically reachable here.
         */
        const stranded =
          q.options.length > 0 &&
          (selected[i] ?? []).length === 0 &&
          (texts[i] ?? "").trim() !== "";

        return (
          <fieldset key={q.questionId ?? String(i)} className={styles.group}>
            {q.header !== null ? (
              <Caption1 className={styles.header}>{q.header}</Caption1>
            ) : null}

            {q.options.length > 0 ? (
              <>
                <legend className={styles.legend}>{q.question}</legend>
                {stranded ? (
                  <Caption1 role="alert" className={styles.stranded}>
                    You typed “{(texts[i] ?? "").trim()}” before options were
                    added — pick one below to answer.
                  </Caption1>
                ) : null}
                <div className={styles.options}>
                  {q.options.map((option) => (
                    <ToggleButton
                      key={option.label}
                      className={styles.option}
                      checked={(selected[i] ?? []).includes(option.label)}
                      disabled={!enabled}
                      onClick={() => {
                        toggle(i, option.label, q.multiSelect);
                      }}
                    >
                      <span>
                        <span className={styles.optionLabel}>
                          {option.label}
                        </span>
                        {option.description !== null ? (
                          <span className={styles.optionDescription}>
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </ToggleButton>
                  ))}
                </div>
              </>
            ) : (
              // Free text ONLY here. There is deliberately no textarea in the
              // options branch above.
              <Field label={q.question}>
                <Textarea
                  value={texts[i] ?? ""}
                  disabled={!enabled}
                  resize="vertical"
                  onChange={(_, data) => {
                    setTexts((prev) => ({ ...prev, [i]: data.value }));
                  }}
                />
              </Field>
            )}
          </fieldset>
        );
      })}

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
                values: valuesFor(i),
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
