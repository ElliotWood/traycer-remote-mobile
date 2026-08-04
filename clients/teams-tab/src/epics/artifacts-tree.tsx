/**
 * The artifacts in an epic: a real, collapsible tree.
 *
 * ON THE `tree` ROLE — decided BEFORE the markup, not after.
 *
 * This surface genuinely nests and genuinely collapses, so `role="tree"` /
 * `role="treeitem"` would describe what it is. It is NOT taken here, because
 * the role also promises arrow-key navigation — up/down through visible rows,
 * left/right to collapse and expand — and that is not implemented. A role
 * that describes the structure while lying about the interaction is the
 * `aria-level` mistake with a bigger blast radius: a screen-reader user would
 * be told this is a tree and then find the keys do nothing.
 *
 * So each row is a plain button whose accessible NAME carries its kind,
 * status and parentage, and the expand control is a separate button with its
 * own label. Honest, if less rich.
 *
 * IF SOMEONE LATER ADDS THE ROLE: take the keyboard behaviour with it. Adding
 * `role="tree"` alone would make the linter happier and the experience worse,
 * and that is exactly how the previous false claim got introduced — as
 * somebody's improvement.
 */
import type { ReactElement } from "react";
import { useState } from "react";
import {
  Body1,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  ClipboardTaskListLtrRegular,
  CommentMultipleRegular,
  DocumentBulletListRegular,
} from "@fluentui/react-icons";
import {
  flattenArtifactTree,
  type ArtifactKind,
  type ArtifactStatus,
  type ArtifactTree,
  type EpicArtifactEntry,
} from "@traycer-clients/shared/epic/epic-doc-artifacts";
import { terseTime } from "../fleet/fleet-grid";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column" },
  rowWrap: {
    display: "flex",
    alignItems: "center",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  twisty: {
    flexShrink: 0,
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: tokens.colorNeutralForeground3,
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  /** Occupies the twisty's width on leaf rows so titles stay aligned. */
  twistySpacer: { flexShrink: 0, width: "24px" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexGrow: 1,
    minWidth: 0,
    textAlign: "left",
    background: "none",
    border: "none",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXS}`,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  title: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
    // A BORDER as well as a fill: high contrast forces backgrounds flat, so a
    // fill-only dot can vanish entirely. The border survives, and the word
    // beside it carries the meaning regardless.
    border: `1px solid ${tokens.colorNeutralForeground3}`,
  },
  when: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    minWidth: "34px",
    textAlign: "right",
  },
  rail: {
    flexShrink: 0,
    alignSelf: "stretch",
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * A distinct glyph per kind — and they must actually be distinguishable.
 *
 * If spec / ticket / story / review do not read as different at 380px, these
 * are decoration costing a row's width, and the honest move is to drop them.
 * That is checkable only in an image with all four present, which is why the
 * fixture carries all four.
 */
function KindIcon({ kind }: { kind: ArtifactKind }): ReactElement {
  switch (kind) {
    case "spec":
      return <DocumentBulletListRegular fontSize={18} />;
    case "ticket":
      return <ClipboardTaskListLtrRegular fontSize={18} />;
    case "story":
      return <BookOpenRegular fontSize={18} />;
    case "review":
      return <CommentMultipleRegular fontSize={18} />;
  }
}

const STATUS_WORDS: Readonly<Record<ArtifactStatus, string>> = {
  0: "To do",
  1: "In progress",
  2: "Done",
};

/**
 * Status as dot AND word, never dot alone.
 *
 * The desktop uses a bare coloured dot. Teams high contrast strips fills
 * entirely — proven on the fleet badges — so a colour-only dot says nothing
 * there. The word carries the meaning; the dot makes the column scannable.
 *
 * Absent, not grey, for kinds that have no status: specs and reviews do not
 * carry one, and a neutral dot would imply a lifecycle they are not in.
 */
function StatusTag({ status }: { status: ArtifactStatus }): ReactElement {
  const styles = useStyles();
  return (
    <Caption1 className={styles.status}>
      <span aria-hidden className={styles.dot} />
      {STATUS_WORDS[status]}
    </Caption1>
  );
}

/** Never a bare id — same rule as epics and agents, third surface. */
function artifactName(entry: EpicArtifactEntry): string {
  const title = entry.title.trim();
  if (title.length > 0) return title;
  return `Untitled ${entry.kind} (${entry.id.slice(0, 8)})`;
}

const INDENT_STEP_PX = 16;
const MAX_INDENT_DEPTH = 3;

export interface ArtifactsTreeProps {
  readonly tree: ArtifactTree;
  readonly now: number;
  readonly onOpen: (entry: EpicArtifactEntry) => void;
}

export function ArtifactsTree({
  tree,
  now,
  onOpen,
}: ArtifactsTreeProps): ReactElement {
  const styles = useStyles();
  /**
   * Expansion is a CLIENT concern and stays out of the shared projection.
   *
   * Default expanded: an epic's artifacts are the thing the user came to see,
   * and a tree that opens collapsed makes them click to discover that
   * anything exists at all.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = flattenArtifactTree(tree, (id) => !collapsed.has(id));

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <Body1>No artifacts in this epic yet.</Body1>
      </div>
    );
  }

  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={styles.list}>
      {rows.map(({ entry, depth, hasChildren }) => {
        const isCollapsed = collapsed.has(entry.id);
        const name = artifactName(entry);
        return (
          <div
            key={entry.id}
            className={styles.rowWrap}
            style={{
              paddingLeft: `${String(Math.min(depth, MAX_INDENT_DEPTH) * INDENT_STEP_PX)}px`,
            }}
          >
            {depth > 0 ? <span aria-hidden className={styles.rail} /> : null}
            {hasChildren ? (
              <button
                type="button"
                className={styles.twisty}
                // An icon-only control MUST carry a name. "button" announced
                // with no name is the blank-tab failure in audio.
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
                aria-expanded={!isCollapsed}
                onClick={() => {
                  toggle(entry.id);
                }}
              >
                {isCollapsed ? (
                  <ChevronRightRegular fontSize={16} />
                ) : (
                  <ChevronDownRegular fontSize={16} />
                )}
              </button>
            ) : (
              <span className={styles.twistySpacer} />
            )}
            <button
              type="button"
              className={styles.row}
              // Kind, status and depth in the NAME, because none of the icon,
              // the dot or the indent reaches a screen reader.
              aria-label={[
                `${entry.kind}: ${name}`,
                entry.status === null ? null : STATUS_WORDS[entry.status],
                depth === 0 ? null : "nested",
              ]
                .filter((part) => part !== null)
                .join(", ")}
              onClick={() => {
                onOpen(entry);
              }}
            >
              <span aria-hidden className={styles.icon}>
                <KindIcon kind={entry.kind} />
              </span>
              <Body1 className={styles.title}>{name}</Body1>
              {entry.status === null ? null : (
                <StatusTag status={entry.status} />
              )}
              <Caption1 className={styles.when}>
                {terseTime(entry.updatedAt, now)}
              </Caption1>
            </button>
          </div>
        );
      })}
    </div>
  );
}
