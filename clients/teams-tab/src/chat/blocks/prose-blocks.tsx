/**
 * `text`, `reasoning` and the historical half of `interview` — the three
 * kinds that were already rendering before this directory existed.
 *
 * They are here so the tree path has ONE dispatcher rather than a tree for
 * the twelve new kinds and a leftover branch for the three old ones. The
 * rendering itself is unchanged, deliberately: `ArtifactMarkdown` (the
 * client's sanitised react-markdown renderer) for both prose kinds, subdued
 * styling for reasoning, and an answered interview as history.
 *
 * AN UNANSWERED INTERVIEW RENDERS NULL HERE. It is promoted to a live form
 * above the transcript, where it has inputs — and this file returning null
 * for it is the same call `transcript-view.tsx` already made. Rendering it in
 * both places would ask the reader for something twice, once uneditably.
 */
import type { ReactElement } from "react";
import { Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type {
  InterviewBlock as InterviewBlockType,
  ReasoningBlock as ReasoningBlockType,
  TextBlock as TextBlockType,
} from "@traycer/protocol/persistence/epic/content-blocks";
import { ArtifactMarkdown } from "../../artifacts/artifact-markdown";
import { CollapsibleCard } from "./block-card";

const useStyles = makeStyles({
  /** Present, legible, visibly not the answer. */
  reasoning: { color: tokens.colorNeutralForeground3 },
  answered: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginBottom: tokens.spacingVerticalS,
  },
  answeredHead: { color: tokens.colorNeutralForeground3 },
  question: {
    color: tokens.colorNeutralForeground3,
    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalS,
  },
});

export function TextBlock({
  block,
}: {
  readonly block: TextBlockType;
}): ReactElement | null {
  if (block.text.trim().length === 0) return null;
  return <ArtifactMarkdown body={block.text} />;
}

/**
 * REASONING HAS NEVER RENDERED IN THIS CLIENT, and the reason is one field.
 *
 * `reasoning` carries its prose in `content` — a plain string. The wording
 * projection's `readText` reads `content` only when it is an OBJECT (a
 * ProseMirror document, which is how a message body arrives) and otherwise
 * falls back to `text`, which a reasoning block does not have. So the
 * projection produced `{ kind: "reasoning", text: "" }`, and the old view
 * correctly returned null for empty prose. Every layer behaved as written and
 * the model's reasoning was silently absent.
 *
 * The gap table counted this row as one of the two kinds that DID render.
 * Reading the block directly is what fixes it — the same reason this whole
 * directory exists.
 *
 * Collapsed by default with a duration header, matching mobile: a real chat
 * carries hundreds of these and they are not the answer.
 */
export function ReasoningBlock({
  block,
}: {
  readonly block: ReasoningBlockType;
}): ReactElement | null {
  const styles = useStyles();
  if (block.content.trim().length === 0) return null;
  const label =
    block.status === "streaming"
      ? "Thinking…"
      : block.startedAt !== null
        ? `Thought for ${String(Math.max(0, Math.round((block.timestamp - block.startedAt) / 1000)))}s`
        : "Thought";
  return (
    <CollapsibleCard
      label={label}
      header={<Caption1 className={styles.reasoning}>{label}</Caption1>}
    >
      <ArtifactMarkdown body={block.content} />
    </CollapsibleCard>
  );
}

export function InterviewBlock({
  block,
}: {
  readonly block: InterviewBlockType;
}): ReactElement | null {
  const styles = useStyles();
  if (block.answers.length === 0) return null; // live form, above the transcript
  return (
    <div className={styles.answered}>
      <Caption1 className={styles.answeredHead}>
        Answered: {block.title ?? "the agent’s question"}
      </Caption1>
      {block.questions.map((q, i) => (
        <Caption1 key={q.questionId ?? String(i)} className={styles.question}>
          {q.question}
        </Caption1>
      ))}
    </div>
  );
}
