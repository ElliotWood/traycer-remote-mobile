/**
 * `autonomous_resume` block (Sprint 2) — one card per trigger. Subagent-kind
 * triggers always show their `summary` inline; command/monitor/wakeup
 * triggers with an `outputFile` lazy-fetch `workspace.readFile` on expand.
 * No `RuntimeEvent` produces this block (the host synthesizes it atomically
 * at turn-start) — it only ever arrives via a snapshot, never live.
 */
import { memo, useState, type ReactElement } from "react";
import type { AutonomousResumeBlock as AutonomousResumeBlockType, AutonomousResumeTrigger } from "@traycer/protocol/persistence/epic/content-blocks";
import { useResumeOutput } from "@/host/use-resume-output";
import { colors, secondaryButton } from "../../ui";
import { StaticCard } from "../collapsible-card";

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const AutonomousResumeBlock = memo(function AutonomousResumeBlock({
  block,
}: {
  readonly block: AutonomousResumeBlockType;
}): ReactElement {
  return (
    <>
      {block.triggers.map((trigger, index) => (
        <TriggerCard key={`${trigger.blockId}-${index}`} trigger={trigger} />
      ))}
    </>
  );
});

function TriggerCard({ trigger }: { readonly trigger: AutonomousResumeTrigger }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const showInlineSummary = trigger.kind === "subagent";

  return (
    <StaticCard>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{trigger.title}</div>
      <div style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
        {trigger.kind} · {trigger.status}
      </div>
      {showInlineSummary ? (
        <p style={{ fontSize: 13, margin: 0 }}>{trigger.summary}</p>
      ) : trigger.outputFile === null ? (
        <p style={{ fontSize: 13, margin: 0 }}>{trigger.summary}</p>
      ) : (
        <>
          {!expanded && (
            <button type="button" style={secondaryButton} onClick={() => setExpanded(true)}>
              View output
            </button>
          )}
          {expanded && (
            <ResumeOutputContent
              workspacePath={trigger.outputFile.workspacePath}
              filePath={trigger.outputFile.filePath}
              fallback={trigger.summary}
            />
          )}
        </>
      )}
    </StaticCard>
  );
}

function ResumeOutputContent({
  workspacePath,
  filePath,
  fallback,
}: {
  readonly workspacePath: string;
  readonly filePath: string;
  readonly fallback: string;
}): ReactElement {
  const query = useResumeOutput({ workspacePath, filePath, enabled: true });

  if (query.isPending) {
    return <p style={{ color: colors.muted, fontSize: 13 }}>Loading output…</p>;
  }
  if (query.isError || query.data === undefined || query.data.content === null) {
    return <p style={{ fontSize: 13, margin: 0 }}>{fallback}</p>;
  }
  return (
    <pre
      style={{
        margin: 0,
        overflowX: "auto",
        maxWidth: "100%",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 12,
        whiteSpace: "pre-wrap",
      }}
    >
      {query.data.content}
    </pre>
  );
}
