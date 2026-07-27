/**
 * P2 — compact context-usage chip (`ContextUsageChip` on desktop, minus the
 * pinned/breakdown popover, deferred). Hides entirely when there's no real
 * context-window signal from the harness — never shows a fabricated
 * percentage.
 */
import type { ReactElement } from "react";
import type { TokenUsage } from "@traycer/protocol/persistence/epic/foundation";
import { theme, type } from "@/views/design-tokens";

export function effectiveContextPercentLeft(usage: TokenUsage | null): number | null {
  if (usage === null || usage.contextWindow === undefined || usage.contextWindow <= 0) {
    return null;
  }
  const used = (usage.contextTokens ?? usage.totalTokens) + (usage.contextBaselineTokens ?? 0);
  const percentUsed = Math.min(100, Math.max(0, Math.round((used / usage.contextWindow) * 100)));
  return 100 - percentUsed;
}

function toneColor(percentLeft: number): string {
  if (percentLeft <= 10) return theme.danger;
  if (percentLeft <= 25) return theme.warning;
  return theme.mutedText;
}

export function ContextUsageChip({ usage }: { readonly usage: TokenUsage | null }): ReactElement | null {
  const percentLeft = effectiveContextPercentLeft(usage);
  if (percentLeft === null) return null;
  return (
    <span style={{ ...type.bodyXs, color: toneColor(percentLeft), whiteSpace: "nowrap" }}>
      {percentLeft}% context left
    </span>
  );
}
