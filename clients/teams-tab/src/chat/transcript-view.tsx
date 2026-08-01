/**
 * The conversation.
 *
 * TWO BLOCK KINDS RENDER, SIXTEEN ARE NAMED. A block we don't render appears
 * as a labelled chip — "Tool call", "File change" — never as nothing. Dropping
 * it would make a turn that ran three tools and wrote one sentence read as a
 * turn that wrote one sentence, with no signal that anything was missing.
 *
 * That is the difference between an incomplete view and a misleading one, and
 * it is the reason the card surface was retired: it projected rich content
 * into text until the projection became the product.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type {
  TranscriptBlock,
  TranscriptMessage,
} from "@traycer-clients/shared/epic/transcript";
import { terseTime } from "../fleet/fleet-grid";
import { ArtifactMarkdown } from "../artifacts/artifact-markdown";

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  message: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
  },
  author: { fontWeight: tokens.fontWeightSemibold },
  when: { color: tokens.colorNeutralForeground3 },
  /**
   * Prose WRAPS and preserves its line breaks.
   *
   * `pre-wrap` rather than markdown rendering: agent output contains code and
   * indentation, and collapsing whitespace would silently reformat it. Real
   * markdown lands with the artifact bodies; until then, showing the text as
   * written beats showing it prettier and wrong.
   */
  text: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  /** Reasoning is subordinate: present, legible, visibly not the answer. */
  reasoning: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: tokens.colorNeutralForeground3,
    borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalS,
  },
  answered: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  answeredHead: { color: tokens.colorNeutralForeground3 },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
  },
  /**
   * A named, unrendered block.
   *
   * Deliberately understated — it is a note about the conversation, not part
   * of it — but never invisible.
   */
  chip: {
    display: "inline-flex",
    alignItems: "center",
    padding: `2px ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

function Block({ block }: { block: TranscriptBlock }): ReactElement | null {
  const styles = useStyles();
  /**
   * An ANSWERED interview renders here as history.
   *
   * It has to, and the reason is a defect this file created: promoting
   * `interview` out of `other` removed it from the chip path, and an
   * answered one is filtered out of the card path — so it fell through BOTH
   * and rendered as nothing. Silently invisible, which is the exact failure
   * the sixteen-chips rule exists to prevent, introduced by the promotion
   * that was meant to improve on it.
   *
   * Found by looking at the image: the fixture's answered interview simply
   * was not on screen.
   */
  if (block.kind === "interview") {
    if (!block.answered) return null; // rendered as a live card, above.
    return (
      <div className={styles.answered}>
        <Caption1 className={styles.answeredHead}>
          Answered: {block.title ?? "the agent's question"}
        </Caption1>
        {block.questions.map((q, i) => (
          <Caption1 key={q.questionId ?? String(i)} className={styles.reasoning}>
            {q.question}
          </Caption1>
        ))}
      </div>
    );
  }
  if (block.kind === "text") {
    if (block.text.trim().length === 0) return null;
    /*
     * MARKDOWN, not a text node.
     *
     * This was `<Body1>{block.text}</Body1>`, so a message containing a fenced
     * code block rendered its ``` markers literally — which is what Elliot
     * photographed. Message bodies are markdown by the time they reach here:
     * the protocol carries a ProseMirror document and the projection
     * serialises it, so producing markdown and then printing it as plain text
     * loses every bit of that work one layer short of the screen.
     *
     * `ArtifactMarkdown` ALREADY EXISTED in this client — react-markdown with
     * remark-gfm and rehype-sanitize, rendering tables, mermaid and
     * wireframes for artifact bodies. Chat simply never called it. The
     * sanitiser matters more here than there, if anything: an assistant turn
     * is agent-authored text arriving over the wire.
     */
    return <ArtifactMarkdown body={block.text} />;
  }
  if (block.kind === "reasoning") {
    if (block.text.trim().length === 0) return null;
    // Reasoning stays visually subordinate but is still markdown — it carries
    // fences and lists as often as the answer does.
    return (
      <div className={styles.reasoning}>
        <ArtifactMarkdown body={block.text} />
      </div>
    );
  }
  return null;
}

export interface TranscriptViewProps {
  readonly messages: readonly TranscriptMessage[];
  readonly now: number;
}

export function TranscriptView({
  messages,
  now,
}: TranscriptViewProps): ReactElement {
  const styles = useStyles();

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <Body1>No messages in this chat yet.</Body1>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {messages.map((message) => {
        const named = message.blocks.filter((b) => b.kind === "other");
        return (
          <div key={message.id} className={styles.message}>
            <div className={styles.head}>
              <Body1 className={styles.author}>{message.author}</Body1>
              <Caption1 className={styles.when}>
                {terseTime(message.timestamp, now)}
              </Caption1>
            </div>
            {message.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
            {named.length === 0 ? null : (
              <div className={styles.chips}>
                {named.map((block, i) => (
                  <Caption1
                    key={i}
                    className={styles.chip}
                    // The chip IS the information — it says something happened
                    // that this view does not render. No `aria-hidden`.
                    title={
                      block.kind === "other" ? block.blockType : undefined
                    }
                  >
                    {block.kind === "other" ? block.label : ""}
                  </Caption1>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
