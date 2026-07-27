/**
 * A user-role row (Sprint 2) — right-aligned bubble, visually distinct from
 * assistant blocks. Real text is extracted from the row's `JsonContent` via
 * `userContentToMarkdown` (never a flattened string), rendered through S1's
 * `MobileMarkdown`. An agent-sender row (agent-to-agent messaging) shows a
 * provenance line instead of a plain "You" label. A `steer` block renders
 * through this SAME component with a "steered" badge — it is never a block
 * card (matches desktop's `BLOCK_HANDLERS.steer => null`).
 */
import { memo, type ReactElement } from "react";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { UserMessageSender } from "@traycer/protocol/persistence/epic/senders";
import { userContentToMarkdown, userSenderProvenance } from "@/host/user-content";
import { MobileMarkdown } from "../markdown/mobile-markdown";
import { colors } from "../ui";

export interface UserMessageBubbleProps {
  readonly content: JsonContent;
  readonly sender: UserMessageSender | null;
  readonly steered?: boolean;
}

function UserMessageBubbleImpl({
  content,
  sender,
  steered = false,
}: UserMessageBubbleProps): ReactElement {
  const markdown = userContentToMarkdown(content);
  const provenance = sender !== null ? userSenderProvenance(sender) : null;

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <div style={{ maxWidth: "85%" }}>
        {(provenance !== null || steered) && (
          <div style={{ textAlign: "right", fontSize: 11, color: colors.muted, marginBottom: 2 }}>
            {provenance !== null ? provenance : null}
            {steered && (
              <span
                style={{
                  marginLeft: 6,
                  border: `1px solid ${colors.accent}`,
                  color: colors.accent,
                  borderRadius: 999,
                  padding: "0 6px",
                }}
              >
                steered
              </span>
            )}
          </div>
        )}
        <div
          data-testid="user-bubble"
          style={{
            background: "#1f2b3a",
            borderRadius: 12,
            padding: "8px 12px",
          }}
        >
          <MobileMarkdown>{markdown}</MobileMarkdown>
        </div>
      </div>
    </div>
  );
}

/** Perf fix: memoized so an unrelated transcript update (a new message appended elsewhere) doesn't re-render every prior bubble — see `transcript-view.tsx`'s docblock. */
export const UserMessageBubble = memo(UserMessageBubbleImpl);
