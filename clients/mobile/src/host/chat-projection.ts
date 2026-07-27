/**
 * Pure projections over a `chat.subscribe` snapshot's chat tree (T6).
 *
 * A pending interview frame (`pendingInterviews[i]`) carries ONLY its
 * `{ blockId, requestedAt }` — the prompt text, questions, and options live in
 * the chat tree, inside the `type:"interview"` content block with that id
 * (`content-blocks.ts` `interviewBlockSchema`). These helpers resolve that block
 * and a short recent-activity line without pulling in gui-app's message
 * projector. Framework-agnostic (no React) so they unit-test directly.
 */
import type { Message } from "@traycer/protocol/persistence/epic/messages";
import type { InterviewBlock } from "@traycer/protocol/persistence/epic/content-blocks";

export type { InterviewBlock } from "@traycer/protocol/persistence/epic/content-blocks";
export type ChatMessage = Message;

/**
 * Resolves a pending interview's prompt block from the chat tree. Returns the
 * `type:"interview"` block whose `blockId` matches, or `null` when it is not
 * present yet (e.g. an interview announced by a delta before its snapshot). A
 * `null` result is the caller's cue to show a loading state, never an empty one.
 */
export function interviewBlockFor(
  messages: readonly ChatMessage[],
  blockId: string,
): InterviewBlock | null {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.blocks) {
      if (block.type === "interview" && block.blockId === blockId) {
        return block;
      }
    }
  }
  return null;
}

const MAX_ACTIVITY_LEN = 140;

/**
 * A short line of recent context: the latest assistant text block's text,
 * collapsed to one line and truncated. Empty string when there is no assistant
 * text yet (the caller renders nothing rather than an empty box).
 */
export function latestActivityText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (let j = message.blocks.length - 1; j >= 0; j--) {
      const block = message.blocks[j];
      if (block.type === "text" && block.text.trim() !== "") {
        const oneLine = block.text.replace(/\s+/g, " ").trim();
        return oneLine.length > MAX_ACTIVITY_LEN
          ? `${oneLine.slice(0, MAX_ACTIVITY_LEN - 1)}…`
          : oneLine;
      }
    }
  }
  return "";
}
