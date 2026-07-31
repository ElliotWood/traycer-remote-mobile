/**
 * The artifacts slice of an epic `Y.Doc`, projected — pure, no UI.
 *
 * MOVED from `clients/mobile/src/host/use-epic-doc.ts` when the Teams tab
 * needed the same tree.
 *
 * THE UNTANGLE THIS REQUIRED. The mobile version imported `CardKind` and
 * `ArtifactStatus` from `@/views/kind-tokens` — a data module depending on one
 * client's view layer, which is why it could not simply be moved. A shared
 * module that imports a client's presentation types is not shared.
 *
 * The split is on what each thing IS, not on where it happened to live:
 *
 *   DATA (here)          which kinds exist; which status values exist
 *   PRESENTATION (client) what colour a status dot is; what icon a kind gets;
 *                         what word a status is called
 *
 * `ArtifactStatus` is `0 | 1 | 2` because that is what the document stores.
 * Calling those "todo/in-progress/done" is a rendering decision, and two
 * clients are entitled to word them differently; neither is entitled to a
 * different set of integers.
 */
import * as Y from "yjs";
import { buildParentedTree, type ParentedTree } from "./epic-doc-chats";

/**
 * The artifact kinds an epic document contains.
 *
 * A closed set, and a DATA fact: an unrecognised kind is a document this
 * client cannot render, not a styling gap.
 */
export type ArtifactKind = "spec" | "ticket" | "story" | "review";

/**
 * Lifecycle status as STORED: 0 todo, 1 in progress, 2 complete.
 *
 * Deliberately the raw integers rather than a friendly union. The names are
 * presentation — `STATUS_LABELS` in a client's view layer — and encoding them
 * here would make every client that disagrees about wording fork the type.
 */
export type ArtifactStatus = 0 | 1 | 2;

export interface EpicArtifactEntry {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly parentId: string | null;
  readonly artifactRoomId: string;
  /** `null` for spec/review — they never carry a status. */
  readonly status: ArtifactStatus | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  "spec",
  "ticket",
  "story",
  "review",
]);

function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && ARTIFACT_KINDS.has(value);
}

function readMaybeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readMaybeStatus(value: unknown): ArtifactStatus | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

/**
 * Pure projection of the artifacts slice, mirroring `readChatsFromEpicDoc`.
 *
 * Tolerant of malformed entries — a stray primitive, an unrecognised `kind`,
 * or a partially-replicated record is skipped rather than crashing the whole
 * tree. One bad row must not cost the user the other two hundred.
 */
export function readArtifactsFromEpicDoc(
  doc: Y.Doc,
): readonly EpicArtifactEntry[] {
  const artifactsValue = doc.getMap("epic").get("artifacts");
  if (!(artifactsValue instanceof Y.Map)) {
    return [];
  }
  const out: EpicArtifactEntry[] = [];
  for (const [id, entry] of artifactsValue.entries()) {
    if (!(entry instanceof Y.Map)) continue;
    const kind = entry.get("kind");
    if (!isArtifactKind(kind)) continue;
    const rawTitle = entry.get("title");
    const rawParentId = entry.get("parentId");
    const rawArtifactRoomId = entry.get("artifactRoomId");
    out.push({
      id,
      kind,
      title: typeof rawTitle === "string" ? rawTitle : "",
      parentId: typeof rawParentId === "string" ? rawParentId : null,
      artifactRoomId:
        typeof rawArtifactRoomId === "string" ? rawArtifactRoomId : "",
      // Only tickets and stories carry one. Reading a status off a spec would
      // invent a lifecycle the document does not track for it.
      status:
        kind === "ticket" || kind === "story"
          ? readMaybeStatus(entry.get("status"))
          : null,
      createdAt: readMaybeNumber(entry.get("createdAt"), 0),
      updatedAt: readMaybeNumber(entry.get("updatedAt"), 0),
    });
  }
  return out;
}

export type ArtifactTree = ParentedTree<EpicArtifactEntry>;

export function buildArtifactTree(
  entries: readonly EpicArtifactEntry[],
): ArtifactTree {
  return buildParentedTree(entries, (e) => e.id);
}

/** A row plus its depth, ready to render indented. Mirrors `FlatChatRow`. */
export interface FlatArtifactRow {
  readonly entry: EpicArtifactEntry;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isLastChild: boolean;
}

/**
 * Depth-first flatten, parent immediately followed by its descendants.
 *
 * Takes an `isExpanded` predicate because an artifact tree is genuinely
 * collapsible — unlike the agents list, where every row is always shown. A
 * collapsed branch's descendants are omitted from the output entirely rather
 * than rendered hidden, so keyboard order and the row count both match what
 * is on screen.
 */
export function flattenArtifactTree(
  tree: ArtifactTree,
  isExpanded: (id: string) => boolean,
): readonly FlatArtifactRow[] {
  const out: FlatArtifactRow[] = [];
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
      if (children.length > 0 && isExpanded(id)) visit(children, depth + 1);
    });
  };
  visit(tree.roots, 0);
  return out;
}
