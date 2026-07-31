/**
 * Chat messages projected to what a transcript needs — pure, no UI.
 *
 * EIGHTEEN BLOCK KINDS EXIST. This renders two of them faithfully (`text`,
 * `reasoning`) and NAMES the rest rather than dropping them.
 *
 * That choice is the whole design. Silently skipping a block would make the
 * transcript lie by omission: a turn that ran three tools and wrote one
 * sentence would read as a turn that wrote one sentence, and the reader would
 * have no way to know anything was missing. A named placeholder — "Tool call:
 * Edit" — is honest about both what happened and about our not rendering it,
 * which is the difference between an incomplete view and a misleading one.
 *
 * This is also why the bot's card surface was retired: it projected rich
 * content into text and the projection became the product. Naming what is not
 * rendered keeps the gap visible instead of letting it close over.
 */

/** A block as the transcript treats it. */
export type TranscriptBlock =
  /** Rendered as prose. */
  | { readonly kind: "text"; readonly text: string }
  /** The model's own reasoning, rendered but visually subordinate. */
  | { readonly kind: "reasoning"; readonly text: string }
  /**
   * Everything else: named, counted, never silently dropped.
   *
   * `label` is human-facing; `blockType` is the raw discriminator so a reader
   * can tell whether a gap is a kind we chose not to render or one we have
   * never seen.
   */
  | {
      readonly kind: "other";
      readonly blockType: string;
      readonly label: string;
    };

export interface TranscriptMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  /** Display name for the author; never a bare id. */
  readonly author: string;
  readonly timestamp: number;
  readonly blocks: readonly TranscriptBlock[];
}

/**
 * Human labels for the kinds we do not render inline.
 *
 * Specific rather than generic: "Tool call" and "File change" tell the reader
 * what happened; "Unsupported block" tells them only that we failed. The
 * former is a transcript with a summary in it; the latter is an apology.
 */
const BLOCK_LABELS: Readonly<Record<string, string>> = {
  approval: "Approval request",
  artifact_operation: "Artifact change",
  autonomous_resume: "Resumed automatically",
  command: "Command",
  compaction: "History compacted",
  error: "Error",
  file_change: "File change",
  interview: "Interview question",
  model_rerouted: "Model rerouted",
  model_verification: "Model verification",
  plan: "Plan",
  safety_buffering: "Safety buffering",
  steer: "Steered",
  subagent: "Subagent",
  todo: "To-do list",
  tool_call: "Tool call",
};

function labelFor(blockType: string): string {
  return BLOCK_LABELS[blockType] ?? `Block: ${blockType}`;
}

function readText(block: Record<string, unknown>): string {
  const value = block["text"];
  return typeof value === "string" ? value : "";
}

/**
 * Projects one raw block. Unknown shapes degrade to a named placeholder
 * rather than throwing — one malformed block must not cost the reader the
 * rest of the conversation.
 */
export function toTranscriptBlock(raw: unknown): TranscriptBlock {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "other", blockType: "unknown", label: "Block: unknown" };
  }
  const block = raw as Record<string, unknown>;
  const type = typeof block["type"] === "string" ? block["type"] : "unknown";
  if (type === "text") return { kind: "text", text: readText(block) };
  if (type === "reasoning") return { kind: "reasoning", text: readText(block) };
  return { kind: "other", blockType: type, label: labelFor(type) };
}

/**
 * Projects the snapshot's messages.
 *
 * User messages carry a payload rather than blocks; assistant messages carry
 * blocks. Both normalise to the same row so the renderer has one shape.
 */
export function toTranscript(
  messages: readonly unknown[],
  fallbackAuthor: string,
): readonly TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as Record<string, unknown>;
    const role = message["role"];
    const id =
      typeof message["messageId"] === "string" ? message["messageId"] : null;
    if (id === null) continue;
    const timestamp =
      typeof message["timestamp"] === "number" ? message["timestamp"] : 0;

    if (role === "assistant") {
      const rawBlocks = Array.isArray(message["blocks"])
        ? (message["blocks"] as unknown[])
        : [];
      const sender = message["sender"];
      const displayName =
        typeof sender === "object" && sender !== null
          ? (sender as Record<string, unknown>)["displayName"]
          : null;
      out.push({
        id,
        role: "assistant",
        author:
          typeof displayName === "string" && displayName.trim().length > 0
            ? displayName
            : fallbackAuthor,
        timestamp,
        blocks: rawBlocks.map(toTranscriptBlock),
      });
      continue;
    }

    if (role === "user") {
      // A user message's payload is a single body rather than blocks.
      const payload = message["message"];
      const text =
        typeof payload === "object" && payload !== null
          ? readText(payload as Record<string, unknown>)
          : "";
      out.push({
        id,
        role: "user",
        author: "You",
        timestamp,
        blocks: [{ kind: "text", text }],
      });
    }
  }
  // Oldest first — a transcript reads forwards.
  return [...out].sort((a, b) => a.timestamp - b.timestamp);
}
