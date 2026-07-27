/**
 * `interview` block, RESOLVED transcript view (Sprint 2) — distinct from
 * `chat-view.tsx`'s `InterviewForm`, which handles a still-PENDING interview's
 * live reply. This component only ever shows an already-answered (or errored)
 * interview as a historical record: collapsed by default, header "Answered
 * N/M questions".
 */
import type { ReactElement } from "react";
import type { InterviewBlock as InterviewBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";
import { CollapsibleCard } from "../collapsible-card";

export function InterviewBlock({
  block,
}: {
  readonly block: InterviewBlockType;
}): ReactElement {
  const answeredCount = block.answers.filter((a) => a.values.length > 0).length;
  const header =
    block.error !== null ? (
      <span style={{ color: colors.danger }}>Question failed</span>
    ) : (
      <span>
        Answered {answeredCount} of {block.questions.length} questions
      </span>
    );

  return (
    <CollapsibleCard header={header}>
      {block.title !== null && <p style={{ fontWeight: 600, fontSize: 13 }}>{block.title}</p>}
      {block.questions.map((question, index) => {
        const answer = block.answers.find(
          (a) => a.questionId === question.questionId && question.questionId !== null,
        ) ?? block.answers[index];
        return (
          <div key={question.questionId ?? index} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{question.question}</div>
            {answer !== undefined && answer.values.length > 0 ? (
              <p style={{ margin: "2px 0 0", fontSize: 13 }}>{answer.values.join(", ")}</p>
            ) : (
              <p style={{ margin: "2px 0 0", fontSize: 13, fontStyle: "italic", color: colors.muted }}>
                No answer
              </p>
            )}
            {answer?.notes !== undefined && answer.notes !== null && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: colors.muted }}>{answer.notes}</p>
            )}
          </div>
        );
      })}
      {block.error !== null && <p style={{ color: colors.danger, fontSize: 13 }}>{block.error}</p>}
    </CollapsibleCard>
  );
}
