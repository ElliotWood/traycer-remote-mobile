/**
 * Top-level chat transcript (Sprint 2) — renders the projector's output
 * (persisted `chat.messages`, user bubbles + assistant block trees) followed
 * by the accumulator's live overlay (`liveBlocks`), through the SAME
 * renderers regardless of source.
 *
 * Perf fix: `React.memo` here (default shallow prop compare) plus on
 * `AssistantTurn`/`UserMessageBubble` below means a re-render of `ChatView`
 * that leaves `messages`/`liveBlocks` referentially unchanged (now the
 * common case — `use-chat.ts` memoizes both) skips this whole subtree
 * entirely; when a NEW message genuinely arrives, only the new/changed
 * message re-renders — every prior message object is preserved by
 * reference (the reducer only ever appends, never recreates old entries),
 * so its per-message `React.memo` bails out for everything but the delta.
 * On a long chat (hundreds of blocks) this is the difference between one
 * new card mounting and the whole transcript re-rendering.
 */
import { memo, type ReactElement } from "react";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import type { Message } from "@traycer/protocol/persistence/epic/messages";
import { BlockList } from "./block-list";
import { buildBlockTree } from "./transcript-model";
import { UserMessageBubble } from "./user-message-bubble";

export interface TranscriptViewProps {
  readonly messages: readonly Message[];
  readonly liveBlocks: readonly ContentBlock[];
  readonly epicId: string;
  readonly chatId: string;
}

function TranscriptViewImpl({
  messages,
  liveBlocks,
  epicId,
  chatId,
}: TranscriptViewProps): ReactElement {
  return (
    <div data-testid="transcript-view">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserMessageBubble
            key={message.messageId}
            content={message.message.content}
            sender={message.sender}
          />
        ) : (
          <AssistantTurn
            key={message.messageId}
            blocks={message.blocks}
            epicId={epicId}
            chatId={chatId}
          />
        ),
      )}
      {liveBlocks.length > 0 && (
        <AssistantTurn blocks={liveBlocks} epicId={epicId} chatId={chatId} />
      )}
    </div>
  );
}

export const TranscriptView = memo(TranscriptViewImpl);

/**
 * Renders one assistant turn's blocks in their original relative order,
 * interleaving `steer` blocks as user bubbles at their original position
 * (never a card) with the rest of the turn's nested/suppressed block tree
 * (computed once over the WHOLE turn, not fragmented per contiguous run, so
 * a suppression pair separated by an interleaved steer still dedupes).
 */
function AssistantTurnImpl({
  blocks,
  epicId,
  chatId,
}: {
  readonly blocks: readonly ContentBlock[];
  readonly epicId: string;
  readonly chatId: string;
}): ReactElement {
  const tree = buildBlockTree(blocks);
  const topLevelById = new Map(tree.map((node) => [node.block.blockId, node] as const));

  return (
    <>
      {blocks.map((block) => {
        if (block.type === "steer") {
          return (
            <UserMessageBubble
              key={block.blockId}
              content={block.content}
              sender={block.sender}
              steered
            />
          );
        }
        const node = topLevelById.get(block.blockId);
        // `undefined` here means the block is either a nested child (already
        // rendered inside its subagent parent) or suppressed by a named rule
        // — never a silent drop, see `transcript-model.ts`'s `partitionBlocks`.
        if (node === undefined) return null;
        return <BlockList key={block.blockId} nodes={[node]} epicId={epicId} chatId={chatId} />;
      })}
    </>
  );
}

/** Perf fix: memoized for the same reason as `UserMessageBubble` — an unrelated new message shouldn't re-render every prior assistant turn. */
const AssistantTurn = memo(AssistantTurnImpl);
