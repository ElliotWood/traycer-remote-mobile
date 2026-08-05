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
import type {
  ContentBlock,
  InterviewBlock,
  TodoItem,
} from "@traycer/protocol/persistence/epic/content-blocks";
import type { TokenUsage } from "@traycer/protocol/persistence/epic/foundation";

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

export interface LastAssistantTurn {
  readonly turnId: string | null;
  readonly startedAt: number | null;
  readonly timestamp: number;
  readonly usage: TokenUsage | null;
  readonly replyText: string;
}

/** P2 — the most recent assistant message's turn metadata, for the elapsed footer. `null` when there is no assistant message yet. */
export function lastAssistantTurn(messages: readonly ChatMessage[]): LastAssistantTurn | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const textParts: string[] = [];
    for (const block of message.blocks) {
      if (block.type === "text" && block.text.trim() !== "") textParts.push(block.text);
    }
    return {
      turnId: message.turnId,
      startedAt: message.startedAt,
      timestamp: message.timestamp,
      usage: message.usage,
      replyText: textParts.join("\n\n"),
    };
  }
  return null;
}

/** Lower-dock Todo panel: the pinned snapshot — the active item plus a done/total/cancelled tally. */
export interface PinnedTodoSnapshot {
  readonly items: readonly TodoItem[];
  readonly activeItem: TodoItem | null;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly cancelledCount: number;
}

/**
 * Derives the lower dock's Todo panel purely from THIS chat's own block
 * stream (confirmed against desktop's `chat-pinned-todos.ts`: it reads the
 * SAME chat's rendered messages, not epic-wide data — unlike the active-
 * agents panel below, which needs the epic tree and is deferred for that
 * reason). Folds two block kinds already present in a single chat's
 * `chat.subscribe` snapshot:
 *   - a `todo`-type block's `items` fully REPLACE the running snapshot
 *     (mirrors desktop: a semantic todo segment always outranks/resets the
 *     task-list accumulation).
 *   - a `tool_call` block's `taskTodoItems` (TaskCreate/TaskUpdate, parsed
 *     on the host) are folded item-by-item into the running snapshot by id.
 *
 * Simplified vs. desktop: does not reset accumulation on the first `create`
 * after a user turn (desktop's `applyParsedTaskTodoItems` does) — a chat
 * with two genuinely UNRELATED todo lists back-to-back could merge them
 * here. Flagged, not silently wrong: acceptable for a phone's at-a-glance
 * summary — the full chat always has the real per-block detail. An item
 * with a `null` id (can't be tracked/upserted) is skipped from the
 * accumulation.
 */
export function pinnedTodoSnapshot(
  messages: readonly ChatMessage[],
  liveBlocks: readonly ContentBlock[],
): PinnedTodoSnapshot | null {
  let running = new Map<string, TodoItem>();
  let sawAny = false;

  const allBlocks: readonly ContentBlock[] = [
    ...messages.filter((m) => m.role === "assistant").flatMap((m) => m.blocks),
    ...liveBlocks,
  ];

  for (const block of allBlocks) {
    if (block.type === "todo") {
      sawAny = true;
      running = new Map(block.items.map((item) => [item.id ?? item.text, item]));
    } else if (block.type === "tool_call" && block.taskTodoItems !== null) {
      for (const raw of block.taskTodoItems) {
        if (raw.id === null) continue;
        sawAny = true;
        const prev = running.get(raw.id);
        running.set(raw.id, {
          id: raw.id,
          text: raw.text ?? prev?.text ?? "",
          status: raw.action === "cancel" ? "cancelled" : (raw.status ?? prev?.status ?? "pending"),
          priority: raw.priority ?? prev?.priority ?? null,
          activeForm: raw.activeForm ?? prev?.activeForm ?? null,
        });
      }
    }
  }

  if (!sawAny || running.size === 0) return null;
  const items = [...running.values()];
  const activeItem = items.find((i) => i.status === "in_progress") ?? null;
  return {
    items,
    activeItem,
    doneCount: items.filter((i) => i.status === "completed").length,
    totalCount: items.length,
    cancelledCount: items.filter((i) => i.status === "cancelled").length,
  };
}
