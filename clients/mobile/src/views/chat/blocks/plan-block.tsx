/**
 * `plan` block (Sprint 2). Card always shows `markdownPreview` + a few
 * steps; "View full plan" lazy-fetches `agent.gui.getPlan` on expand.
 */
import { memo, useState, type ReactElement } from "react";
import type { PlanBlock as PlanBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { useAgentPlan } from "@/host/use-agent-plan";
import { MobileMarkdown } from "../../markdown/mobile-markdown";
import { colors, secondaryButton } from "../../ui";
import { StaticCard } from "../collapsible-card";

const STEP_PREVIEW_LIMIT = 5;

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const PlanBlock = memo(function PlanBlock({
  block,
  epicId,
  chatId,
}: {
  readonly block: PlanBlockType;
  readonly epicId: string;
  readonly chatId: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <StaticCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{block.title ?? "Plan"}</span>
        <span style={{ color: colors.muted, fontSize: 12 }}>{block.planStatus}</span>
      </div>
      {block.summary !== null && <p style={{ fontSize: 13, margin: "0 0 8px" }}>{block.summary}</p>}
      <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13 }}>
        {block.steps.slice(0, STEP_PREVIEW_LIMIT).map((step, index) => (
          <li key={step.id ?? index}>{step.text}</li>
        ))}
      </ul>
      {!expanded && (
        <button type="button" style={secondaryButton} onClick={() => setExpanded(true)}>
          View full plan
        </button>
      )}
      {expanded && <PlanFullContent planId={block.planId} epicId={epicId} chatId={chatId} fallback={block.markdownPreview} />}
    </StaticCard>
  );
});

function PlanFullContent({
  planId,
  epicId,
  chatId,
  fallback,
}: {
  readonly planId: string;
  readonly epicId: string;
  readonly chatId: string;
  readonly fallback: string;
}): ReactElement {
  const query = useAgentPlan({ epicId, chatId, planId, enabled: true });

  if (query.isPending) {
    return <p style={{ color: colors.muted, fontSize: 13 }}>Loading plan…</p>;
  }
  if (query.isError || query.data === undefined || query.data.unavailableReason !== null) {
    return <MobileMarkdown>{fallback}</MobileMarkdown>;
  }
  return <MobileMarkdown>{query.data.markdown}</MobileMarkdown>;
}
