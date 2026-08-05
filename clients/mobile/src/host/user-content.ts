/**
 * Renders a user/steer row's `JsonContent` (ProseMirror doc) as real text
 * (Sprint 2 / M "user + steer content"). Reuses the shared, already-tested
 * `jsonContentToMarkdown` serializer rather than hand-rolling an extractor —
 * the result feeds straight into `MobileMarkdown` (S1) so a mobile user
 * bubble gets the same rich rendering (lists, code, links) a desktop user
 * message would, not a flattened string.
 */
import { jsonContentToMarkdown } from "@traycer/protocol/common/json-content-serializer";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type { UserMessageSender } from "@traycer/protocol/persistence/epic/senders";

/**
 * `mentionFormat: "user"` renders mentions as their human-facing form
 * (`@name`, `` `path` ``), not the LLM-facing `@agent:id` form. `platform`
 * only affects path-flavored mention formatting; POSIX is the reasonable
 * default for a read-only display client with no OS affinity of its own.
 */
export function userContentToMarkdown(content: JsonContent): string {
  return jsonContentToMarkdown(content, {
    mentionFormat: "user",
    platform: "POSIX",
  });
}

/**
 * A short provenance line for an agent-as-user sender (agent-to-agent
 * messaging) — e.g. "Traycer Planner agent". `null` for a plain human sender,
 * whose bubble needs no extra label.
 */
export function userSenderProvenance(sender: UserMessageSender): string | null {
  if (sender.type !== "agent") return null;
  return sender.displayName ?? sender.agentId;
}
