/**
 * Chat messages projected to what a transcript needs — pure, no UI.
 *
 * FIFTEEN BLOCK KINDS EXIST — the members of `contentBlockSchema`. This
 * renders two of them faithfully (`text`, `reasoning`) and NAMES the rest
 * rather than dropping them.
 *
 * It said EIGHTEEN, which is the number of `z.literal` calls in
 * `content-blocks.ts`. Three of those — `model_rerouted`,
 * `model_verification`, `safety_buffering` — are provider-notice metadata and
 * have never been block types. The old label map carried all three, and three
 * entries for things that cannot occur are what made a map with no coverage
 * guarantee look complete. The count is now tied to the union rather than
 * counted by eye.
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
 *
 * ─── THERE IS A SECOND PROJECTION, AND THAT IS DELIBERATE ──────────────────
 *
 * `remote-bridge/src/transcript-projection.ts` projects the same transcript
 * into `{ text, parts[] }`. It is NOT a duplicate and merging the two would
 * make one surface wrong.
 *
 *   this file   structured blocks, for a DOCUMENT — the tab renders an
 *               interview's questions and distinguishes an answered one
 *               (history) from a live prompt, and shows `reasoning`
 *   the bridge  prose + flat markers, for a CARD — a scanning surface, which
 *               excludes `reasoning` on purpose because it would swamp one
 *
 * A ticket proposed replacing this projection with the bridge's, on the
 * strength of `readText` having read the wrong field. One defect is not an
 * architectural claim: adopting it would flatten `interview` to a marker and
 * lose a distinction that has already caused a defect once. Structure differs
 * because the renderers differ.
 *
 * What the two share is VOCABULARY. Block labels and the naming of tools,
 * paths, plans and to-dos live here, and the bridge's richer labels were
 * lifted into `blockDetail` rather than left on one side of the seam.
 */

import { jsonContentToMarkdown } from "@traycer/protocol/common/json-content-serializer";
// TYPE-ONLY, and load-bearing: `BLOCK_LABELS` is keyed by this union, so the
// protocol growing a block type is a compile error here. The runtime input to
// this module stays `unknown` — it is raw JSON off the wire — and this import
// costs nothing at runtime.
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";

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
        /**
         * `header`, `options` and `multiSelect` are carried for the SAME reason
         * `question` is, stated four lines up: they can be found nowhere else.
         *
         * They were dropped here until 2026-08-04, and the consequence was not
         * a missing label — it was a WRONG ANSWER SHAPE. A client that cannot
         * see the options cannot submit one, so it submits free text, which is
         * a legitimate `values` member (desktop's "Other"). The answer is
         * therefore indistinguishable on the wire from a considered choice,
         * and nothing errors. Dropping a field at a projection is not a
         * rendering loss when the field is what the reply is built from.
         *
         * `preview` is NOT carried: no client renders it. Deliberate, and the
         * reason it is written down is that this comment is the only thing
         * standing between that and the defect above.
         */
        readonly header: string | null;
        readonly options: readonly {
          readonly label: string;
          readonly description: string | null;
        }[];
        readonly multiSelect: boolean;
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
/**
 * Every block type that does not render as prose, TIED TO THE PROTOCOL.
 *
 * `Record<LabelledBlockType, string>` is the point: `LabelledBlockType` is
 * derived from `ContentBlock`, so a sixteenth member added to the protocol
 * union FAILS TO COMPILE HERE. Before, this was `Record<string, string>` with
 * a `?? \`Block: ${type}\`` fallback — a new protocol type would have become a
 * chip reading "Block: whatever_it_is" in front of a user, with nothing
 * failing and nobody aware. That is the same shape as the silently cropped
 * screenshot and the silently trimmed view list: something goes missing and
 * says nothing.
 *
 * A compile error is the correct response to a protocol growing.
 *
 * THE OLD MAP HAD THREE KEYS THAT CANNOT OCCUR — `model_rerouted`,
 * `model_verification`, `safety_buffering`. They are real names, which is why
 * they looked right, but they are `providerNoticeNormalizedMetadata` kinds and
 * have never been members of `contentBlockSchema`. Three dead entries are what
 * made a map with no coverage guarantee look complete. Removed: binding to the
 * union makes them a compile error too.
 *
 * `text` and `reasoning` are excluded because they render AS prose and return
 * before reaching a label — an entry for them would be a label nothing shows.
 */
type LabelledBlockType = Exclude<ContentBlock["type"], "text" | "reasoning">;

const BLOCK_LABELS: Readonly<Record<LabelledBlockType, string>> = {
  approval: "Approval request",
  artifact_operation: "Artifact change",
  autonomous_resume: "Resumed automatically",
  command: "Command",
  compaction: "History compacted",
  error: "Error",
  file_change: "File change",
  interview: "Interview question",
  plan: "Plan",
  steer: "Steered",
  subagent: "Subagent",
  todo: "To-do list",
  tool_call: "Tool call",
};

/**
 * The fallback stays, and is now genuinely a last resort rather than the
 * silent path: the map is exhaustive over the union, so reaching this means
 * the wire carried a `type` the protocol does not declare.
 */
function labelFor(blockType: string): string {
  return (
    (BLOCK_LABELS as Readonly<Record<string, string>>)[blockType] ??
    `Block: ${blockType}`
  );
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
        const rawOptions = Array.isArray(question["options"])
          ? (question["options"] as unknown[])
          : [];
        return [
          {
            questionId:
              typeof question["questionId"] === "string"
                ? question["questionId"]
                : null,
            question: text,
            header:
              typeof question["header"] === "string"
                ? question["header"]
                : null,
            // An option with no `label` is DROPPED, not defaulted to "": the
            // label IS the value submitted, so an empty one would render a
            // blank button that answers the question with "".
            options: rawOptions.flatMap((o) => {
              if (typeof o !== "object" || o === null) return [];
              const option = o as Record<string, unknown>;
              const label = option["label"];
              if (typeof label !== "string" || label.length === 0) return [];
              return [
                {
                  label,
                  description:
                    typeof option["description"] === "string"
                      ? option["description"]
                      : null,
                },
              ];
            }),
            multiSelect: question["multiSelect"] === true,
          },
        ];
      }),
      // Already answered → history. Rendering it as a live prompt would ask
      // the user for something they have given.
      answered: rawAnswers.length > 0,
    };
  }
  /*
   * NAME THE THING, not just its category.
   *
   * This returned `labelFor(type)` alone, so a turn that ran three tools
   * rendered `[Tool call] [Tool call] [File change]` — three chips saying
   * only that something happened. `File change` names a category where the
   * file is the information.
   *
   * The bot's card builder learned to humanise a tool name today; the tab
   * has its own renderer and did not, which is the same divergence as
   * `speakerLabel`. **What a tool call is called is protocol grammar, not
   * palette** — the answer is identical in every client — so the naming
   * lives here and both clients get it.
   */
  const detail = blockDetail(block, type);
  return {
    kind: "other",
    blockType: type,
    label: detail === null ? labelFor(type) : `${labelFor(type)}: ${detail}`,
  };
}

/**
 * A tool's name as a person should read it.
 *
 * MCP tools arrive as `mcp__<server>__<tool>`: the tool half carries the
 * meaning and the server prefix is routing. A raw
 * `mcp__traycer_a2a__traycer_send_message` in a product surface is the same
 * defect as printing subprocess output — correct about which tool, and
 * telling the reader nothing except that we leaked an internal.
 *
 * Anything unrecognised is returned unchanged. A label we cannot improve
 * beats one we corrupt, and it stays searchable.
 */
export function humaniseToolName(raw: string): string {
  const mcp = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(raw);
  const name = mcp?.[1] ?? raw;
  return name.replace(/_/g, " ").trim();
}

/**
 * The specific thing a non-rendered block is about — a tool's name, a file's
 * path — or `null` when the block carries nothing more than its category.
 *
 * Paths are trimmed to the workspace: `/srv/traycer/tenants/<name>/…` embeds
 * a TENANT NAME, and this product is heading for people looking at hosts they
 * do not own. The prefix also costs a third of a phone line to say something
 * the reader cannot act on.
 */
function blockDetail(
  block: Record<string, unknown>,
  type: string,
): string | null {
  if (type === "tool_call" || type === "tool_result") {
    const name = block["toolName"] ?? block["name"] ?? block["tool"];
    return typeof name === "string" && name.trim().length > 0
      ? humaniseToolName(name.trim())
      : null;
  }
  if (type === "file_change") {
    const path = block["path"] ?? block["filePath"] ?? block["file"];
    return typeof path === "string" && path.trim().length > 0
      ? shortenWorkspacePath(path.trim())
      : null;
  }
  /*
   * FOUR MORE, LIFTED FROM THE BRIDGE'S PROJECTION.
   *
   * `remote-bridge` has always named these — `todo · 3 items`,
   * `plan: <title>`, `approval: <tool>`, `artifact: <title>` — while this
   * projection emitted the bare category, so the tab showed four chips saying
   * only that something happened. Same divergence as `speakerLabel` and
   * `humaniseToolName` before it, and the same resolution: what a block is
   * CALLED is protocol grammar, identical in every client, so it lives here
   * and both surfaces get it.
   *
   * Fourth instance of a rule living where it was first needed. The two
   * projections stay separate — see the header — but their vocabulary should
   * not.
   */
  if (type === "subagent") {
    const name = block["name"] ?? block["agentType"];
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : null;
  }
  if (type === "command") {
    const command = block["command"];
    return typeof command === "string" && command.trim().length > 0
      ? command.trim()
      : null;
  }
  if (type === "error") {
    const message = block["message"];
    return typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : null;
  }
  if (type === "todo") {
    const items = block["items"];
    // The COUNT, not the items — a to-do list is a document and this is a
    // chip. "3 items" is what a reader can act on at a glance.
    return Array.isArray(items) ? `${String(items.length)} items` : null;
  }
  if (type === "plan" || type === "artifact_operation" || type === "interview") {
    const title = block["title"];
    return typeof title === "string" && title.trim().length > 0
      ? title.trim()
      : null;
  }
  if (type === "approval") {
    const tool = block["toolName"];
    return typeof tool === "string" && tool.trim().length > 0
      ? humaniseToolName(tool.trim())
      : null;
  }
  return null;
}

/** Drops a server-specific prefix from a path; returns it whole otherwise. */
export function shortenWorkspacePath(raw: string): string {
  const tenant = /^\/srv\/traycer\/tenants\/[^/]+\/(.+)$/.exec(raw);
  if (tenant?.[1] !== undefined) return tenant[1];
  const home = /^\/(?:home|Users)\/[^/]+\/(.+)$/.exec(raw);
  if (home?.[1] !== undefined) return home[1];
  return raw;
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
