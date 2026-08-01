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
 * ONE KIND IS NEITHER RENDERED NOR MERELY NAMED: `interview`. It carries the
 * questions a human is being asked, and the pending-interview state gives only
 * a `blockId` — so the questions can be found nowhere else. A named chip
 * would leave the user told that a question exists and unable to read it.
 *
 * This is also why the bot's card surface was retired: it projected rich
 * content into text and the projection became the product. Naming what is not
 * rendered keeps the gap visible instead of letting it close over.
 */

import { jsonContentToMarkdown } from "@traycer/protocol/common/json-content-serializer";

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
  /**
   * An interview: the questions themselves, because they are ACTIONABLE.
   *
   * `blockId` is how the answer frame addresses it, and `answered` is read
   * from the block's own `answers` — a block that already has them is history,
   * not a prompt.
   */
  | {
      readonly kind: "interview";
      readonly blockId: string;
      readonly title: string | null;
      readonly questions: readonly {
        readonly questionId: string | null;
        readonly question: string;
      }[];
      readonly answered: boolean;
    }
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

/**
 * The body of a block or a user payload, as markdown.
 *
 * THIS READ `block["text"]` AND A USER'S MESSAGE RENDERED EMPTY.
 *
 * The protocol carries message bodies as a ProseMirror JSON document under
 * `content`, not as a string under `text`. `remote-bridge` has always done
 * this correctly — `jsonContentToMarkdown(message.message.content)` — and the
 * tab reimplemented the projection reading a field that does not exist. A
 * user typed a message, the host stored it, the bot's card showed it, and the
 * tab showed a blank row.
 *
 * It also explains the literal ``` fences: a ProseMirror doc serialised
 * properly produces markdown, and reading `.text` produced either nothing or
 * an unserialised remnant. **Two of the reported defects were one function.**
 *
 * `content` first because it is the protocol's shape; `text` retained as a
 * fallback so a block that genuinely carries a plain string still renders.
 * Returning "" for neither is deliberate — one unreadable block must not cost
 * the reader the rest of the conversation.
 */
function readText(block: Record<string, unknown>): string {
  const content = block["content"];
  if (content !== null && content !== undefined && typeof content === "object") {
    try {
      return jsonContentToMarkdown(content as never, {
        mentionFormat: "user",
        platform: "POSIX",
      });
    } catch {
      // A malformed document degrades to the fallback rather than throwing.
    }
  }
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
  if (type === "interview") {
    const rawQuestions = Array.isArray(block["questions"])
      ? (block["questions"] as unknown[])
      : [];
    const rawAnswers = Array.isArray(block["answers"])
      ? (block["answers"] as unknown[])
      : [];
    const blockId =
      typeof block["blockId"] === "string" ? block["blockId"] : "";
    return {
      kind: "interview",
      blockId,
      title: typeof block["title"] === "string" ? block["title"] : null,
      questions: rawQuestions.flatMap((q) => {
        if (typeof q !== "object" || q === null) return [];
        const question = q as Record<string, unknown>;
        const text = question["question"];
        if (typeof text !== "string") return [];
        return [
          {
            questionId:
              typeof question["questionId"] === "string"
                ? question["questionId"]
                : null,
            question: text,
          },
        ];
      }),
      // Already answered → history. Rendering it as a live prompt would ask
      // the user for something they have given.
      answered: rawAnswers.length > 0,
    };
  }
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

/**
 * WHO authored a turn. Grammar, not palette — which is why it lives here.
 *
 * This existed only in `teams-bot`'s card builder. The tab has its own
 * renderer and still showed `haiku` as the speaker after the bot was fixed,
 * because the fix landed in one client and nothing could have told us.
 *
 * The seam rule says protocol questions go in `shared` and rendering choices
 * go per-client. **"Who said this" is a question about the protocol's data** —
 * the answer is identical in every client — so it was on the wrong side of
 * the seam, and being on the wrong side is what made a one-client fix
 * possible.
 *
 * `author` on an ASSISTANT turn is `sender.displayName`, and for an assistant
 * that is the MODEL ALIAS — `haiku`, `default`. On a USER turn the same field
 * is the sending agent's title. One field, two meanings, distinguished only
 * by direction. The rule is the ROLE, never a list of names that look like
 * models: a list would repair the instance that announced itself and preserve
 * the class for every model whose alias reads like a person.
 */
export function speakerLabel(message: {
  readonly role: "user" | "assistant";
  readonly author: string | null;
}): string {
  if (message.role === "assistant") return "Agent";
  const author = message.author?.trim() ?? "";
  return author.length > 0 ? author : "You";
}

/**
 * The model, when there is one to name. `null` for user turns.
 *
 * Kept beside {@link speakerLabel} because they are the two halves of one
 * decision: the model is a real fact that belongs somewhere secondary, and
 * separating them is how it drifts back into the speaker slot.
 */
export function modelLabel(message: {
  readonly role: "user" | "assistant";
  readonly author: string | null;
}): string | null {
  if (message.role !== "assistant") return null;
  const model = message.author?.trim() ?? "";
  return model.length > 0 ? model : null;
}
