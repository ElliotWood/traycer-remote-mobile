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
  if (block.kind === "text") {
    if (block.text.trim().length === 0) return null;
    return <Body1 className={styles.text}>{block.text}</Body1>;
  }
  if (block.kind === "reasoning") {
    if (block.text.trim().length === 0) return null;
    return <Caption1 className={styles.reasoning}>{block.text}</Caption1>;
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
