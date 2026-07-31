/**
 * The chats slice of an epic `Y.Doc`, projected — pure, no React, no storage.
 *
 * MOVED from `clients/mobile/src/host/use-epic-doc.ts` when the Teams tab
 * needed the same projection. What stayed behind is everything that is
 * genuinely the phone's: IndexedDB persistence, the localStorage projection
 * seed, and the artifact-room registry — offline concerns a Teams tab does
 * not have. What moved is the part that is just "what does this doc say".
 *
 * WHAT THE DOC DOES AND DOES NOT CARRY, because it decides a UI question:
 * a chat entry has `hostId` and nothing else about its runtime. There is no
 * `capabilities` and no `active` here — those live only on
 * `agentSummarySchema`, returned only by `agent.list`, which a signed-in
 * human cannot call (it takes a `senderAgentId`).
 *
 * That is not a gap to paper over. `capabilities` is RELATIONAL: the request
 * carries who is asking and the response answers for that caller, so
 * `sendMessage: false` means "the asking agent cannot send to this", not
 * "this cannot be sent to". A cached value from another caller would be a
 * true answer to a different question, rendered as though it were this
 * user's — the same shape as reading `active: false` on an unobservable row
 * as "idle".
 *
 * So a consumer of this module can honestly say WHERE an agent runs, and must
 * not claim whether it can be reached.
 */
import * as Y from "yjs";

/** One chat enumerated from the epic doc's `chats` Y.Map. */
export interface EpicChatEntry {
  readonly chatId: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * The host this chat is durably bound to (`chatSchema.hostId`).
   *
   * `null` only for a malformed or not-yet-replicated entry — never a
   * legitimate "no host". Consumers must treat `null` as UNKNOWN rather than
   * as foreign: rendering unknown as "runs elsewhere" is the same category
   * error as rendering unobservable as "idle".
   */
  readonly hostId: string | null;
}

function readMaybeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readChatsFromEpicDoc(doc: Y.Doc): readonly EpicChatEntry[] {
  const chatsValue = doc.getMap("epic").get("chats");
  if (!(chatsValue instanceof Y.Map)) {
    return [];
  }
  const out: EpicChatEntry[] = [];
  for (const [chatId, entry] of chatsValue.entries()) {
    // A well-formed chat record is a nested Y.Map. Anything else (a stray
    // primitive, a partially-replicated entry) is skipped rather than
    // crashing the whole list — exactly how `projectChatsSlice` guards each
    // entry.
    if (!(entry instanceof Y.Map)) {
      continue;
    }
    const rawTitle = entry.get("title");
    const rawParentId = entry.get("parentId");
    const rawHostId = entry.get("hostId");
    out.push({
      chatId,
      title: typeof rawTitle === "string" ? rawTitle : "",
      parentId: typeof rawParentId === "string" ? rawParentId : null,
      createdAt: readMaybeNumber(entry.get("createdAt"), 0),
      updatedAt: readMaybeNumber(entry.get("updatedAt"), 0),
      hostId: typeof rawHostId === "string" ? rawHostId : null,
    });
  }
  return out;
}

export interface ParentedNode {
  readonly parentId: string | null;
  readonly updatedAt: number;
}

/**
 * Sibling comparator mirroring desktop's `DEFAULT_SORT_MODE` (`updatedAt`
 * DESC, id ASC tie-break), scoped to the two fields this tree needs rather
 * than porting the full multi-field module.
 */
function compareParentedNodes(
  aId: string,
  a: ParentedNode,
  bId: string,
  b: ParentedNode,
): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

export interface ParentedTree<T> {
  readonly roots: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly byId: Readonly<Record<string, T>>;
}

/**
 * Nests entries by `parentId`.
 *
 * A `parentId` pointing at an id not present in `entries` (deleted parent,
 * stale reference) PROMOTES the child to root rather than dropping it. A
 * dropped row is invisible, and an agent that silently vanishes because its
 * parent was deleted is far worse than one that appears at the top level.
 *
 * Generic over chats and artifacts — both families nest by `parentId` within
 * their own map, never across families, so `keyOf` supplies each family's
 * identity field (`id` vs `chatId`).
 */
export function buildParentedTree<T extends ParentedNode>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): ParentedTree<T> {
  const byId: Record<string, T> = {};
  for (const entry of entries) byId[keyOf(entry)] = entry;

  const rootsUnsorted: T[] = [];
  const childrenUnsorted: Record<string, T[]> = {};
  for (const entry of entries) {
    const effectiveParentId =
      entry.parentId !== null && Object.hasOwn(byId, entry.parentId)
        ? entry.parentId
        : null;
    if (effectiveParentId === null) {
      rootsUnsorted.push(entry);
      continue;
    }
    (childrenUnsorted[effectiveParentId] ??= []).push(entry);
  }

  const sortIds = (nodes: readonly T[]): readonly string[] =>
    [...nodes]
      .sort((a, b) => compareParentedNodes(keyOf(a), a, keyOf(b), b))
      .map(keyOf);

  const childrenByParent: Record<string, readonly string[]> = {};
  for (const [parentId, children] of Object.entries(childrenUnsorted)) {
    childrenByParent[parentId] = sortIds(children);
  }

  return { roots: sortIds(rootsUnsorted), childrenByParent, byId };
}

export type ChatTree = ParentedTree<EpicChatEntry>;

export function buildChatTree(entries: readonly EpicChatEntry[]): ChatTree {
  return buildParentedTree(entries, (e) => e.chatId);
}

/**
 * Where an agent runs, relative to the host this client is bound to.
 *
 * THREE values, not two, and the third is the point. `unknown` is a chat
 * whose `hostId` has not replicated yet — reporting that as "elsewhere" is a
 * guess presented as a fact, and this codebase has already shipped that bug
 * once by reading `active: false` on an unobservable row as "idle".
 */
export type AgentLocality = "this-host" | "other-host" | "unknown";

export function agentLocality(
  entry: EpicChatEntry,
  configuredHostId: string,
): AgentLocality {
  if (entry.hostId === null) return "unknown";
  // No configured host id means we cannot judge — not that everything is
  // local. Defaulting to "this-host" here would render every agent as
  // actionable on a misconfigured build.
  if (configuredHostId === "") return "unknown";
  return entry.hostId === configuredHostId ? "this-host" : "other-host";
}

/** A chat plus its depth in the tree, ready to render as an indented row. */
export interface FlatChatRow {
  readonly entry: EpicChatEntry;
  readonly depth: number;
  /** True when this row has children beneath it — the parent styling cue. */
  readonly hasChildren: boolean;
  /** True when this is the LAST child of its parent, so a guide rail can stop. */
  readonly isLastChild: boolean;
}

/**
 * Depth-first flatten of {@link ChatTree}: a parent immediately followed by its
 * descendants, siblings in tree order.
 *
 * Returned FLAT rather than nested because the row is the unit of interaction
 * — a real `<button>` per agent, keyboard-navigable in document order. Nesting
 * the DOM would put buttons inside buttons, which is invalid and which browsers
 * resolve by dropping one of them.
 *
 * `isLastChild` exists so a guide rail can stop at the final child instead of
 * running past it into whitespace, which reads as a broken line rather than a
 * deliberate one.
 */
export function flattenChatTree(tree: ChatTree): readonly FlatChatRow[] {
  const out: FlatChatRow[] = [];
  const visit = (ids: readonly string[], depth: number): void => {
    ids.forEach((id, index) => {
      const entry = tree.byId[id];
      if (entry === undefined) return;
      const children = tree.childrenByParent[id] ?? [];
      out.push({
        entry,
        depth,
        hasChildren: children.length > 0,
        isLastChild: index === ids.length - 1,
      });
      // Depth is unbounded in the DATA; the cap belongs to the renderer, which
      // has a width to respect. Truncating the structure here would silently
      // drop agents.
      visit(children, depth + 1);
    });
  };
  visit(tree.roots, 0);
  return out;
}
