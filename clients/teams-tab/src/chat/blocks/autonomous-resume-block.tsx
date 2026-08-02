/**
 * `autonomous_resume` — why the agent started again on its own.
 *
 * One card per trigger, because a resume can have several and merging them
 * would lose which one actually woke it.
 *
 * Mobile lazy-fetches an `outputFile` through `workspace.readFile` on expand.
 * That is not reproduced here: the trigger's own `summary` is what the host
 * wrote for this purpose, and a "View output" button that reads a file off
 * the host's disk is a second capability with its own failure modes, not a
 * renderer. The summary always renders — so the reader learns why it resumed
 * either way, and the difference is detail rather than presence.
 */
import type { ReactElement } from "react";
import { Body1, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import type {
  AutonomousResumeBlock as AutonomousResumeBlockType,
  AutonomousResumeTrigger,
} from "@traycer/protocol/persistence/epic/content-blocks";
import { StaticCard } from "./block-card";
import { ArtifactMarkdown } from "../../artifacts/artifact-markdown";

const useStyles = makeStyles({
  title: {
    fontWeight: tokens.fontWeightSemibold,
    display: "block",
    marginBottom: tokens.spacingVerticalXXS,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginBottom: tokens.spacingVerticalXS,
  },
  summary: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  source: {
    color: tokens.colorNeutralForeground3,
    display: "block",
    marginTop: tokens.spacingVerticalXS,
    fontFamily: tokens.fontFamilyMonospace,
  },
});

export function AutonomousResumeBlock({
  block,
}: {
  readonly block: AutonomousResumeBlockType;
}): ReactElement {
  return (
    <>
      {block.triggers.map((trigger, index) => (
        <TriggerCard
          key={`${trigger.blockId}-${String(index)}`}
          trigger={trigger}
        />
      ))}
    </>
  );
}

function TriggerCard({
  trigger,
}: {
  readonly trigger: AutonomousResumeTrigger;
}): ReactElement {
  const styles = useStyles();
  return (
    <StaticCard>
      <Body1 className={styles.title}>{trigger.title}</Body1>
      <Caption1 className={styles.meta}>
        {trigger.kind} · {trigger.status}
      </Caption1>
      {/*
        THE FIELD THAT WAS COSTING THE LIVE COUNT OF 50.
        A trigger summary is an agent's report — headings, rules and fences —
        and it was printed as a text node. Found by matching the label the
        live harness saw, "subagent · completed", to the composition two lines
        above; the previous, plausible guess at a different `Body1 as="p"`
        moved the number not at all.
        A `div`, because the markdown renderer emits block elements and a
        `<pre>` inside a `<p>` is invalid HTML.
      */}
      <div className={styles.summary}>
        <ArtifactMarkdown body={trigger.summary} />
      </div>
      {/*
        The file is NAMED even though its contents are not fetched. "There is
        more, and here is where it lives" is a different statement from
        silence, and it is the one that lets a reader go and look.
      */}
      {trigger.outputFile !== null ? (
        <Caption1 className={styles.source}>
          output: {trigger.outputFile.filePath}
        </Caption1>
      ) : null}
    </StaticCard>
  );
}
