/**
 * P2 — the in-progress-turn run indicator (`AssistantRunIndicator` on
 * desktop): a rotating working verb + a 3-dot loader, frozen to "Stopping"
 * once the user has requested a stop. Seeded per-turn so re-renders don't
 * change the verb mid-turn.
 */
import type { ReactElement } from "react";
import { theme, type } from "@/views/design-tokens";
import { pickWorkingVerb } from "./working-verb";

export interface RunIndicatorProps {
  readonly seed: string;
  readonly runState: "running" | "stopping";
}

export function RunIndicator({ seed, runState }: RunIndicatorProps): ReactElement {
  const verb = runState === "stopping" ? "Stopping" : pickWorkingVerb(seed);
  return (
    <div
      data-testid="assistant-run-indicator"
      data-run-state={runState}
      style={{ display: "flex", alignItems: "center", gap: 4, margin: "4px 0" }}
    >
      <span className="traycer-working-text" style={{ ...type.bodySm, color: theme.mutedText }}>
        {verb}
      </span>
      <span style={{ display: "inline-flex", gap: 2 }} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="traycer-working-dot"
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: theme.mutedText,
            }}
          />
        ))}
      </span>
    </div>
  );
}
