/**
 * P2 — the per-turn elapsed footer (`AssistantElapsedFooter` on desktop):
 * "{Verb} for {duration}" (or "Stopped · {duration}"), a copy button for the
 * reply text, and a cost tooltip when the harness reports `costUsd`. Fork is
 * deferred — mobile has no fork RPC wired yet (P2 contract).
 */
import { useState, type ReactElement } from "react";
import { Check, Copy } from "lucide-react";
import type { TokenUsage } from "@traycer/protocol/persistence/epic/foundation";
import { theme, type } from "@/views/design-tokens";
import { formatUsd, formatWorkedFor, pickElapsedVerb } from "./working-verb";

export interface ElapsedFooterProps {
  readonly seed: string;
  readonly elapsedMs: number;
  readonly stopped: boolean;
  readonly usage: TokenUsage | null;
  readonly replyText: string;
}

export function ElapsedFooter({ seed, elapsedMs, stopped, usage, replyText }: ElapsedFooterProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const duration = formatWorkedFor(elapsedMs);
  const label = stopped ? (
    <span style={{ color: theme.danger }}>Stopped</span>
  ) : (
    <>{pickElapsedVerb(seed)}</>
  );
  const costUsd = usage?.costUsd;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "4px 0",
        ...type.bodyXs,
        color: theme.mutedText,
      }}
    >
      <span
        title={costUsd !== undefined && costUsd > 0 ? `Cost: ${formatUsd(costUsd)}` : undefined}
      >
        {label} for {duration}
      </span>
      {replyText.length > 0 && (
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy reply"}
          onClick={() => {
            void navigator.clipboard?.writeText(replyText).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: "none",
            background: "transparent",
            color: theme.mutedText,
            cursor: "pointer",
            padding: 2,
          }}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
