/**
 * `plan` — what the agent intends to do, and the block most worth reading in
 * full.
 *
 * `markdownPreview` is rendered through `ArtifactMarkdown`, the same
 * sanitised renderer the artifact bodies and the chat prose already use. A
 * plan is markdown with headings and lists; printing it as a text node is the
 * defect that put literal ``` fences on screen one layer short of the render.
 *
 * The full plan behind `agent.gui.getPlan` is NOT fetched here. The preview
 * is what the host persisted for exactly this purpose, and it is complete
 * enough to read — an unfetched plan shows its preview rather than a spinner
 * or a button that admits we have more and are not showing it.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type { PlanBlock as PlanBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { ArtifactMarkdown } from "../../artifacts/artifact-markdown";
import { StaticCard } from "./block-card";
import { plainSummary } from "./plain-summary";

const STEP_PREVIEW_LIMIT = 5;

const useStyles = makeStyles({
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  title: { fontWeight: tokens.fontWeightSemibold },
  status: { color: tokens.colorNeutralForeground3 },
  summary: { margin: `0 0 ${tokens.spacingVerticalS}` },
  steps: {
    margin: `0 0 ${tokens.spacingVerticalS}`,
    paddingLeft: tokens.spacingHorizontalXXL,
  },
  more: { color: tokens.colorNeutralForeground3, display: "block" },
});

export function PlanBlock({
  block,
}: {
  readonly block: PlanBlockType;
}): ReactElement {
  const styles = useStyles();
  const shown = block.steps.slice(0, STEP_PREVIEW_LIMIT);
  const hidden = block.steps.length - shown.length;

  return (
    <StaticCard>
      <div className={styles.head}>
        <Body1 className={styles.title}>{block.title ?? "Plan"}</Body1>
        <Caption1 className={styles.status}>{block.planStatus}</Caption1>
      </div>
      {block.summary !== null ? (
        /*
          MARKDOWN, for the same reason the subagent's result is. A plan's
          summary is a PARAGRAPH the harness wrote — the body half of the two
          transformations, not the one-line half — so it renders rather than
          being stripped. It was the sibling this fix nearly left behind:
          `step.text` was corrected while the field directly above it went on
          printing `#` and fences into a `<p>`.

          A `div` rather than `Body1 as="p"`: the markdown renderer emits its
          own block elements, and a `<pre>` inside a `<p>` is invalid HTML the
          browser silently re-parents.
        */
        <div className={styles.summary}>
          <ArtifactMarkdown body={block.summary} />
        </div>
      ) : null}
      {shown.length > 0 ? (
        <ul className={styles.steps}>
          {shown.map((step, index) => (
            <li key={step.id ?? String(index)}>
              <Body1>{plainSummary(step.text)}</Body1>
            </li>
          ))}
        </ul>
      ) : null}
      {/*
        The count of what is NOT listed, rather than silence. A plan truncated
        to five steps that says so is a preview; one that does not is a plan
        the reader believes has five steps.
      */}
      {hidden > 0 ? (
        <Caption1 className={styles.more}>
          + {hidden} more {hidden === 1 ? "step" : "steps"} below
        </Caption1>
      ) : null}
      {block.markdownPreview.trim().length > 0 ? (
        <ArtifactMarkdown body={block.markdownPreview} />
      ) : null}
    </StaticCard>
  );
}
