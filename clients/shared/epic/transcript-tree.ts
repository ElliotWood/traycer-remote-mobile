/**
 * Pure block→tree projection (Sprint 2 F1) — the "projector" half of the
 * chat transcript, shared by both the snapshot render path and the live
 * accumulator's overlay (both produce plain `ContentBlock[]`; this module
 * doesn't care which).
 *
 * ─── MOVED HERE FROM `mobile/src/views/chat/transcript-model.ts` ───────────
 *
 * Extract-on-demand, because the Teams tab needs it: the tab renders TWO
 * block kinds and names the other thirteen as chips, and it cannot do better
 * from where it stands. Its data layer is {@link ./transcript.ts}, which
 * projects every non-prose block down to a LABEL STRING before the renderer
 * sees it. The payload is gone by then. No amount of renderer work in the tab
 * reaches mobile's transcript through that pipe.
 *
 * So this is the prerequisite, not the feature. Mobile imports it back
 * through a shim and its own suites keep covering it.
 *
 * THERE ARE NOW THREE TRANSCRIPT PROJECTIONS AND THAT IS STILL DELIBERATE.
 * They answer different questions, and `transcript.ts` already records why
 * merging the first two would make one surface wrong:
 *
 *   transcript.ts       what a block is CALLED — vocabulary. Lossy on
 *                       purpose: a label is all a chip needs.
 *   THIS FILE           which blocks render, nested how, and which are
 *                       REPLACED by another — structure. Lossless: callers
 *                       get the `ContentBlock` itself.
 *   the bridge's        prose + flat markers, for a card — a scanning
 *                       surface, which excludes `reasoning` on purpose.
 *
 * The first two COMPOSE rather than compete: a renderer that draws each kind
 * takes its structure from here and its wording from there. That is the
 * distinction to preserve if these ever look mergeable — one is about shape,
 * the other about words.
 *
 * Mirrors two specific desktop behaviors, ported deliberately (they prevent
 * literal duplicate/confusing rows, not polish — see the Sprint 2 contract):
 *   - suppress a `tool_call` block that a `file_change` block's id is
 *     prefixed by (`${toolCallId}:...`) — the file_change card replaces it;
 *   - suppress a `tool_call` block that equals a `subagent`'s
 *     `spawnToolCallId` — the subagent card replaces it.
 * Both rules run over the COMBINED block set the caller passes in
 * (snapshot + live overlay together), so a spawn/edit pair straddling that
 * boundary within one in-progress turn still dedupes.
 *
 * Nesting: a block nests under a `subagent` block when its `parentBlockId`
 * names that subagent AND its own type is one of the nestable child kinds
 * (`tool_call | file_change | command | subagent` — matching desktop's
 * `isSubagentChildSegment`; plain `text`/`reasoning` are never subagent
 * children). A `parentBlockId` naming an unknown or non-subagent block is an
 * orphan fallback: the block renders top-level rather than vanishing.
 * `artifact_operation` is never nested, matching desktop exactly (it is not
 * in the nestable-kind list).
 */
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";

export interface RenderableBlock {
  readonly block: ContentBlock;
  readonly children: readonly RenderableBlock[];
}

const NESTABLE_CHILD_KINDS: ReadonlySet<ContentBlock["type"]> = new Set([
  "tool_call",
  "file_change",
  "command",
  "subagent",
]);

function isFileChangeBlock(
  block: ContentBlock,
): block is Extract<ContentBlock, { type: "file_change" }> {
  return block.type === "file_change";
}

function isSubAgentBlock(
  block: ContentBlock,
): block is Extract<ContentBlock, { type: "subagent" }> {
  return block.type === "subagent";
}

export type SuppressionReason = "edit-tool-call" | "spawn-tool-call";

function computeSuppressed(
  blocks: readonly ContentBlock[],
): ReadonlyMap<string, SuppressionReason> {
  const suppressed = new Map<string, SuppressionReason>();
  const fileChanges = blocks.filter(isFileChangeBlock);
  const subagents = blocks.filter(isSubAgentBlock);

  for (const block of blocks) {
    if (block.type !== "tool_call") continue;
    const prefix = `${block.blockId}:`;
    if (fileChanges.some((fc) => fc.blockId.startsWith(prefix))) {
      suppressed.set(block.blockId, "edit-tool-call");
      continue;
    }
    if (subagents.some((sa) => sa.spawnToolCallId === block.blockId)) {
      suppressed.set(block.blockId, "spawn-tool-call");
    }
  }
  return suppressed;
}

/**
 * Builds the top-level renderable tree: suppressed blocks and `steer`
 * blocks (routed to the caller's user-bubble path, never a card here) are
 * excluded; everything else nests under its subagent parent when eligible,
 * otherwise renders top-level.
 */
export function buildBlockTree(blocks: readonly ContentBlock[]): readonly RenderableBlock[] {
  const suppressed = computeSuppressed(blocks);
  const byId = new Map(blocks.map((b) => [b.blockId, b] as const));

  const isEligibleChild = (block: ContentBlock): boolean => {
    if (block.type === "steer") return false;
    if (suppressed.has(block.blockId)) return false;
    if (!NESTABLE_CHILD_KINDS.has(block.type)) return false;
    const parentId = block.parentBlockId;
    if (parentId === null || parentId === undefined) return false;
    const parent = byId.get(parentId);
    return parent !== undefined && parent.type === "subagent";
  };

  const buildNode = (block: ContentBlock): RenderableBlock => {
    const children = blocks
      .filter((b) => b.parentBlockId === block.blockId && isEligibleChild(b))
      .map(buildNode);
    return { block, children };
  };

  return blocks
    .filter((b) => b.type !== "steer" && !suppressed.has(b.blockId) && !isEligibleChild(b))
    .map(buildNode);
}

export interface PartitionResult {
  readonly rendered: readonly string[];
  readonly alternatePath: readonly string[];
  readonly suppressed: ReadonlyMap<string, SuppressionReason>;
  readonly dropped: readonly string[];
}

/**
 * The no-silent-drop invariant, as a partition rather than a subset check:
 * every source blockId lands in exactly one of {rendered, alternatePath,
 * suppressed} — anything left over is a genuine drop. `dropped` must be
 * empty for the transcript to be considered faithful (rubric §4).
 */
export function partitionBlocks(blocks: readonly ContentBlock[]): PartitionResult {
  const suppressedMap = computeSuppressed(blocks);
  const rendered: string[] = [];
  const alternatePath: string[] = [];
  const dropped: string[] = [];

  const tree = buildBlockTree(blocks);
  const renderedIds = new Set<string>();
  const collect = (nodes: readonly RenderableBlock[]): void => {
    for (const node of nodes) {
      renderedIds.add(node.block.blockId);
      collect(node.children);
    }
  };
  collect(tree);

  for (const block of blocks) {
    if (block.type === "steer") {
      alternatePath.push(block.blockId);
    } else if (suppressedMap.has(block.blockId)) {
      // Accounted for by a named suppression rule — not a drop.
      continue;
    } else if (renderedIds.has(block.blockId)) {
      rendered.push(block.blockId);
    } else {
      dropped.push(block.blockId);
    }
  }

  return { rendered, alternatePath, suppressed: suppressedMap, dropped };
}
