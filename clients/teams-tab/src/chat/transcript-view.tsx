/**
 * The conversation.
 *
 * EVERY BLOCK KIND NOW RENDERS. This file used to say "two block kinds
 * render, sixteen are named", and the chip it described was a good answer to
 * the question it was asked: a named block is honest, and honesty was the
 * property that mattered when the card surface was retired for projecting
 * rich content into text.
 *
 * It was the wrong question for the standing goal. "Does the tab have a chat
 * screen" is answered yes by one screen; "does the tab do what mobile's chat
 * screen does" is answered by rendered kinds, and the answer was 2 of 15.
 *
 * The blocker was never twelve unwritten renderers — it was the PROJECTION.
 * `shared/epic/transcript.ts` reduces every non-prose block to a label string
 * before a renderer can see it, so `toolName`, `filePath`, the diff and the
 * to-do items were gone before this file ran. That is why no amount of work
 * here reached parity, and why the fix was `transcript-tree.ts` landing
 * first.
 *
 * WHAT EACH PROJECTION IS STILL FOR. `messages` (wording) supplies the author,
 * the timestamp and the user turn's prose; `blockTrees` (structure) supplies
 * the assistant turn's cards, nested and de-duplicated. The chip survives as
 * `block-list.tsx`'s unreachable fallback, so the no-silent-drop promise is
 * kept by a renderer that should never fire rather than by thirteen that do.
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
import type { RenderableBlock } from "@traycer-clients/shared/epic/transcript-tree";
import { terseTime } from "../fleet/fleet-grid";
import { ArtifactMarkdown } from "../artifacts/artifact-markdown";
import { BlockList } from "./blocks/block-list";
import type { SnapshotDiffClient } from "./blocks/use-snapshot-diff";

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
  /*
   * The `chips` / `chip` styles that lived here are GONE, not orphaned. The
   * fallback chip moved to `blocks/block-list.tsx` with its own style, so the
   * one place that can still render an unnamed block is the one place that
   * styles it.
   */
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
  /** Structure per assistant `messageId`. See `use-chat.ts`. */
  readonly blockTrees: ReadonlyMap<string, readonly RenderableBlock[]>;
  /** Unary client, for the diff bodies. `null` under preview. */
  readonly client: SnapshotDiffClient | null;
  readonly now: number;
}

export function TranscriptView({
  messages,
  blockTrees,
  client,
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
        const tree = blockTrees.get(message.id);
        return (
          <div key={message.id} className={styles.message}>
            <div className={styles.head}>
              <Body1 className={styles.author}>{message.author}</Body1>
              <Caption1 className={styles.when}>
                {terseTime(message.timestamp, now)}
              </Caption1>
            </div>
            {/*
              A user turn has no blocks to build a tree from — its payload is
              one body — so it keeps the prose path. An assistant turn renders
              from the tree, and falls back to the prose path only if no tree
              was built for it, which would mean the two projections disagreed
              about the same snapshot.
            */}
            {tree === undefined ? (
              message.blocks.map((block, i) => <Block key={i} block={block} />)
            ) : (
              <BlockList nodes={tree} client={client} />
            )}
          </div>
        );
      })}
    </div>
  );
}
