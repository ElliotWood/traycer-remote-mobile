/**
 * The canvas as a screen: one epic's tile layout, at its own URL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS COMMIT DOES AND DOES NOT DO — read this before concluding the
 * canvas works
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This makes the canvas REACHABLE. It does not make it useful, and the
 * distinction is the whole reason it is one commit and not three.
 *
 * The layout engine underneath is eleven commits old and fully tested:
 * splits, tab strips, preview tabs, activation history, resize with a pixel
 * floor, sanitize-on-read persistence. **Nothing in the UI can open a tab.**
 * There is no "+" on a strip, no split gesture, and `splitPane` — which
 * exists, is correct and is covered — is called by no component. So the only
 * state this screen can currently be in is empty, and it says so on screen
 * rather than rendering a blank rectangle.
 *
 * That is deliberate sequencing, not an oversight: the entry point is the
 * next step and it is where the questions live (what opens, from where, and
 * what "open" means when a chat already has its own route). Shipping the
 * route first means the plumbing is proven against a real URL before any of
 * that is decided.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IN-MEMORY STATE, ON PURPOSE, FOR EXACTLY ONE MORE COMMIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `loadCanvas`/`saveCanvas` and `browserCanvasStorage(epicId)` all exist and
 * are not called here yet. Wiring them is the step after the entry point, and
 * it has a hazard worth arriving at deliberately: the storage key is
 * per-epic, so a `useState` initialiser — which runs once per component
 * lifetime, while epic A → epic B is a PROP change and not a remount — would
 * show A's layout under B and then save it to B's key. Persisting nothing is
 * the honest state until that is handled and tested.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SUBSCRIPTION INVARIANT, WHICH A CANVAS MAKES EASY TO BREAK
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The tab derives every agent, chat and artifact in an epic from ONE
 * `epic.subscribe` Y.Doc, read through `readChatsFromEpicDoc(doc)` — one
 * subscription, already in memory, opened above this screen.
 *
 * **A tile that opens its own subscription breaks that**, and a canvas is
 * precisely the thing that encourages many tiles at once. The mobile client
 * opens a socket per chat and it takes a phone-sized browser down at around
 * sixty. `tile-canvas.tsx` already holds half the defence by mounting only
 * the active tab of each pane; the other half is that tile bodies must read
 * from the epic doc passed down, and must not dial anything themselves.
 */
import type { ReactElement, ReactNode } from "react";
import {
  Body1,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { v4 as uuidv4 } from "uuid";
import { TileCanvas } from "./tile-canvas";
import { makeBlankTile } from "./opener";
import { tileTitle, type TileRef } from "./tile-ref";
import { openTile, type CanvasState, type IdSource } from "./canvas-state";

const useStyles = makeStyles({
  screen: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    // The containment pair. Without it the canvas grows to its content
    // instead of filling the frame, and a pane's tab strip leaves the screen
    // on a long transcript — the defect the shell contract exists to prevent,
    // arriving through a new screen that never read it.
    minHeight: 0,
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    boxSizing: "border-box",
  },
  canvasHost: {
    flexGrow: 1,
    minHeight: 0,
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalL,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

export interface CanvasScreenProps {
  readonly epicId: string;
  /** The epic's name when known. `null` on a deep link, as everywhere else. */
  readonly epicName: string | null;
  readonly state: CanvasState;
  readonly onChange: (next: CanvasState) => void;
  readonly onBack: () => void;
  /** Bound onto every tile this screen mints, and carried for life. */
  readonly hostId: string;
  /**
   * Pane and group ids. Injected so a test can supply a counter and assert on
   * the tree it produced; `uuidIds` is what the app passes.
   */
  readonly ids: IdSource;
}

/**
 * Real ids for the running app.
 *
 * Separate from the component so the injection has one obvious production
 * value rather than a default parameter — the package's lint bans those, and
 * the reason applies here: a defaulted `IdSource` is one a test can forget to
 * override while believing it did.
 */
export const uuidIds: IdSource = {
  paneId: () => uuidv4(),
  groupId: () => uuidv4(),
};

/**
 * One tile's body.
 *
 * UNIFORM, not a switch over the six kinds, and that is a claim about what is
 * known rather than a shortcut. No tile can be created yet and nothing
 * persists a layout, so every kind is equally unrenderable today; six
 * branches that each say "not yet" in slightly different words would be
 * structure standing in for capability — the shape that reads as coverage in
 * a diff and is not.
 *
 * The exhaustive switch appears in the commit that gives the branches
 * something to return, where `never` will be load-bearing instead of
 * decorative.
 */
function TilePlaceholder({ tile }: { readonly tile: TileRef }): ReactElement {
  // A COMPONENT, not a helper that calls `useStyles()` and returns JSX. The
  // first draft was the latter, invoked from `renderTile` as a plain function
  // — a hook call outside a render, which React permits right up until it
  // does not and which the strip's own `react-hooks` rules would have caught
  // only after eslint ran.
  const styles = useStyles();
  return (
    <div className={styles.placeholder}>
      <Body1>{tileTitle(tile)}</Body1>
      <Caption1 className={styles.subtle}>
        This tab is a placeholder. Tile bodies arrive with the opener.
      </Caption1>
    </div>
  );
}

function renderTile(tile: TileRef): ReactNode {
  return <TilePlaceholder tile={tile} />;
}

export function CanvasScreen({
  epicId,
  epicName,
  state,
  onChange,
  onBack,
  hostId,
  ids,
}: CanvasScreenProps): ReactElement {
  const styles = useStyles();
  const title = epicName ?? `Epic ${epicId.slice(0, 8)}`;

  return (
    <div className={styles.screen}>
      {/*
        Breadcrumb rather than browser back, matching the epic detail screen:
        a Teams tab is chrome inside chrome and the browser's back control is
        not where a Teams user looks. Back still works.
      */}
      <Breadcrumb aria-label="Location">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={onBack}>{title}</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>Canvas</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.canvasHost}>
        <TileCanvas
          state={state}
          onChange={onChange}
          renderTile={renderTile}
          ids={ids}
          hostId={hostId}
          // Names WHY it is empty rather than that it is. "Nothing open" is
          // true and tells a user who just navigated here that the screen is
          // working as intended, which is the opposite of what they need to
          // know.
          emptyLabel="Nothing open yet — opening epic content in a pane lands next."
          onOpenFirst={() => {
            onChange(
              openTile({
                state,
                tile: makeBlankTile(hostId),
                preview: false,
                ids,
              }),
            );
          }}
        />
      </div>
    </div>
  );
}
