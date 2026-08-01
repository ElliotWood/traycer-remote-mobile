/**
 * Projects the host's chat transcript down to prose plus non-prose PARTS,
 * for channel adapters that render cards rather than a document.
 *
 * Why this lives in the bridge and not in the adapter: an assistant row's
 * content is an array of fifteen content-block types, and a user row's
 * content is a ProseMirror document. Teaching every adapter to walk both
 * would spread protocol knowledge into packages whose whole point is not to
 * have it, and would rebind their rendering to a schema that changes for
 * reasons unrelated to any channel.
 *
 * The projection is LOSSY on purpose. A card is a scanning surface: prose
 * stays prose, and everything else collapses to a labelled marker that says
 * what is there without reproducing it. Full fidelity is a drill-in
 * concern, not an inline one.
 *
 * Nothing is silently dropped. Every block type is named in
 * {@link projectBlock}'s switch, so adding a sixteenth is a type error here
 * rather than a marker that quietly reads `other` in production.
 *
 * ─── THERE IS A SECOND PROJECTION, AND THAT IS DELIBERATE ──────────────────
 *
 * `clients/shared/epic/transcript.ts` projects the same transcript into
 * `TranscriptBlock[]`. It is NOT a duplicate of this file and consolidating
 * the two would make one of the surfaces wrong.
 *
 *   this file          prose + flat markers, for a CARD — a scanning surface
 *                      where full fidelity is a drill-in concern
 *   shared/transcript  structured blocks, for a DOCUMENT — the tab renders
 *                      an interview's questions and distinguishes an answered
 *                      one (history) from a live prompt
 *
 * Collapsing them would flatten `interview` to a marker and lose that
 * distinction, which has already caused a defect once; and it would drop
 * `reasoning`, which this file excludes on purpose and the tab shows on
 * purpose. A card and a document want different shapes.
 *
 * What the two SHOULD share is vocabulary, not structure. The block labels
 * live in `shared` and both read them from there.
 *
 * ─── THIS PROJECTION'S OUTPUT IS RAW. CONSUMERS MUST CLEAN IT. ─────────────
 *
 * `TranscriptPart.label` carries protocol identifiers exactly as they arrive:
 * a tool name is `mcp__<server>__<tool>`, and a file path is absolute,
 * including a `/srv/traycer/tenants/<name>/…` prefix that embeds A TENANT
 * NAME.
 *
 * Today exactly one consumer renders these — the Teams bot's `partMarker` —
 * and it calls shared's `humaniseToolName` and `shortenWorkspacePath` before
 * displaying anything. So nothing leaks. But that is an accident of there
 * being ONE consumer, and this is a CLI anyone can pipe: the safety is in the
 * caller, not in this type. A second consumer that renders `part.label`
 * directly puts an internal identifier and a tenant name in front of a user,
 * and would discover it in a screenshot.
 */
import { jsonContentToMarkdown } from "@traycer/protocol/common/json-content-serializer";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import type { Message } from "@traycer/protocol/persistence/epic/messages";

export type TranscriptPartKind =
  "code" | "table" | "tool" | "file_change" | "command" | "error" | "other";

export interface TranscriptPart {
  readonly kind: TranscriptPartKind;
  /**
   * RAW. A protocol identifier, not display text.
   *
   * `kind: "tool"` carries `mcp__<server>__<tool>`; `kind: "file_change"`
   * carries an absolute path that may embed a tenant name. Run them through
   * `humaniseToolName` / `shortenWorkspacePath` before showing them to a
   * person — see this file's header.
   */
  readonly label: string;
  /** Line count where the part is line-shaped, else 0. */
  readonly lines: number;
}

export interface TranscriptMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly author: string | null;
  readonly timestamp: number;
  readonly text: string;
  readonly parts: readonly TranscriptPart[];
}

export interface Transcript {
  readonly chatId: string;
  readonly title: string | null;
  readonly totalCount: number;
  /**
   * How many of the NEWEST messages this window skips — measured from the
   * RECENT end, not from message #1.
   *
   * This direction is load-bearing, not a convention. Paging runs
   * newest-first, so `offset: 0` is always "now"; and because the offset is
   * anchored to the recent end, a page the reader has already loaded keeps
   * its contents when the agent says something new. Anchored to the oldest
   * message instead, every page boundary would shift on each new message and
   * a reader on page 2 would watch it reshuffle underneath them.
   */
  readonly offset: number;
  /** The window itself, always oldest-first WITHIN the window. */
  readonly messages: readonly TranscriptMessage[];
}

/** A block that contributes prose, a part, or both. */
interface Projected {
  readonly text: string;
  readonly parts: readonly TranscriptPart[];
}

const NOTHING: Projected = { text: "", parts: [] };

const part = (
  kind: TranscriptPartKind,
  label: string,
  lines: number,
): Projected => ({ text: "", parts: [{ kind, label, lines }] });

function countLines(value: string | null): number {
  if (value === null || value.length === 0) return 0;
  return value.split("\n").length;
}

/**
 * Every content-block type, explicitly.
 *
 * The `switch` is exhaustive and the function returns `Projected` with no
 * default branch, so a new block type fails to compile here. That is
 * deliberate: a catch-all default is how a transcript ends up full of
 * anonymous `⟨other⟩` markers with nobody aware that a type was added.
 *
 * Three types are deliberately NOT rendered as prose even though they carry
 * some:
 *   - `reasoning` — the agent's private thinking. Including it would swamp
 *     a scanning surface, and it is not what the reader is looking for.
 *   - `plan` — `markdownPreview` is a whole document; the title is the part
 *     a card can honestly show.
 *   - `compaction` — a housekeeping event, not something anyone said.
 * Each still emits a marker, so the reader can see that something happened
 * rather than encountering an unexplained gap.
 */
function projectBlock(block: ContentBlock): Projected {
  switch (block.type) {
    case "text":
      return { text: block.text, parts: [] };

    case "reasoning":
      return part("other", "reasoning", countLines(block.content));

    case "tool_call":
      return part("tool", block.toolName, 0);

    case "file_change":
      return part("file_change", block.filePath, 0);

    case "command":
      return part("command", block.command, 0);

    case "subagent":
      return part("tool", block.name ?? block.agentType ?? "subagent", 0);

    case "approval":
      return part("other", `approval: ${block.toolName ?? "action"}`, 0);

    case "todo":
      return part("other", `todo · ${String(block.items.length)} items`, 0);

    case "plan":
      return part("other", `plan: ${block.title ?? block.planId}`, 0);

    case "error":
      return part("error", block.message, 0);

    case "compaction":
      return part("other", "compacted", 0);

    case "autonomous_resume":
      return part("other", "autonomous resume", 0);

    case "steer":
      // A steer IS something a person said, so it keeps its prose — through
      // the same canonical serializer as a user row, never a hand-rolled
      // extractor.
      return {
        text: jsonContentToMarkdown(block.content, MARKDOWN_OPTS),
        parts: [],
      };

    case "interview":
      return part("other", `interview: ${block.title ?? "questions"}`, 0);

    case "artifact_operation":
      return part("other", `artifact: ${block.title ?? block.artifactId}`, 0);
  }
}

/**
 * `mentionFormat: "user"` renders mentions in their human-facing form
 * (`@name`) rather than the LLM-facing `@agent:id`. Matches what the mobile
 * client does, so the same message reads identically on both surfaces.
 */
const MARKDOWN_OPTS = { mentionFormat: "user", platform: "POSIX" } as const;

export function projectMessage(message: Message): TranscriptMessage {
  if (message.role === "user") {
    const author =
      message.sender.type === "agent"
        ? (message.sender.displayName ?? message.sender.agentId)
        : null;
    return {
      messageId: message.messageId,
      role: "user",
      author,
      timestamp: message.timestamp,
      // Both payload kinds carry a ProseMirror doc, not a string — an
      // agent-authored user row is still a rich document. Same serializer
      // either way; the distinction is provenance, handled by `author`.
      text: jsonContentToMarkdown(message.message.content, MARKDOWN_OPTS),
      parts: [],
    };
  }

  const projected = message.blocks.map(projectBlock);
  return {
    messageId: message.messageId,
    role: "assistant",
    author: message.sender.displayName ?? message.sender.agentId,
    timestamp: message.timestamp,
    text: projected
      .map((p) => p.text)
      .filter((t) => t.trim().length > 0)
      .join("\n\n"),
    parts: projected.flatMap((p) => p.parts),
  };
}

/**
 * Takes the newest-first window `[offset, offset + limit)` counted from the
 * recent end, and returns it OLDEST-FIRST within the window.
 *
 * The two orderings coexisting is the part that invites an off-by-one, so it
 * is stated once here rather than re-derived at each call site: the WINDOW is
 * selected from the end, the CONTENTS are in natural order, and the card
 * decides how to display them.
 */
export function selectWindow(
  messages: readonly Message[],
  offset: number,
  limit: number,
): readonly Message[] {
  const end = Math.max(0, messages.length - offset);
  const start = Math.max(0, end - limit);
  return messages.slice(start, end);
}
