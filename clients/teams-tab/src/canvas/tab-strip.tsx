/**
 * One pane's tab strip.
 *
 * ─── Preview has to be SEEN, not just modelled ───
 *
 * The state layer replaces preview tabs correctly, and a user who cannot tell
 * which tab is the preview experiences that as tabs randomly disappearing.
 * So the preview tab is italic — the same signal VS Code uses, and the one
 * users already read without being taught. Italic alone is not enough for
 * everyone, so the accessible name carries it too: "Preview: <title>".
 *
 * ─── Every affordance has a keyboard path ───
 *
 * The canvas ships without drag-and-drop deliberately, so the strip is not
 * "mouse plus a fallback" — for split and close there is no drag at all. The
 * strip is a `tablist` with roving semantics: arrows move, Enter/Space
 * activate, Delete closes, and the close button is a real button rather than
 * an icon with a click handler.
 *
 * Middle-click closes, because it is the one mouse gesture users bring with
 * them from every browser and its absence reads as broken.
 *
 * ─── Double-click promotes ───
 *
 * The gesture that turns a preview into a kept tab. It is also what a user
 * does by accident when a single click was slow, which is harmless: promoting
 * an already-permanent tab is a no-op by construction in `promotePreview`.
 */
import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import {
  Button,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { TilePane } from "./tile-tree";
import { tileTitle, type TileRef } from "./tile-ref";

const useStyles = makeStyles({
  strip: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    minWidth: 0,
    overflowX: "auto",
    // Teams' own chrome has no visible scrollbar here and one inside a pane
    // header reads as a rendering fault. The strip still scrolls.
    scrollbarWidth: "none",
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    flexShrink: 0,
    maxWidth: "180px",
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalXXS,
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
    border: "none",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    ":hover": { backgroundColor: tokens.colorNeutralBackground3Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  active: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    // The accent sits on the ACTIVE tab of the ACTIVE pane only — see
    // `paneFocused`. Two accents in two panes says two things are focused,
    // which is never true.
  },
  accent: { boxShadow: `inset 0 2px 0 0 ${tokens.colorBrandStroke1}` },
  preview: { fontStyle: "italic" },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  close: { minWidth: "20px", maxWidth: "20px", height: "20px" },
});

export interface TabStripProps {
  readonly pane: TilePane;
  readonly tiles: Readonly<Record<string, TileRef | undefined>>;
  /** True when this pane holds canvas focus. Drives the accent, nothing else. */
  readonly paneFocused: boolean;
  readonly onActivate: (instanceId: string) => void;
  readonly onPromote: (instanceId: string) => void;
  readonly onClose: (instanceId: string) => void;
}

export function TabStrip(props: TabStripProps) {
  const { pane, tiles, paneFocused, onActivate, onPromote, onClose } = props;
  const styles = useStyles();

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, instanceId: string) => {
      const index = pane.tabInstanceIds.indexOf(instanceId);
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onClose(instanceId);
        return;
      }
      const step =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      // Clamped, NOT wrapped. Wrapping at the ends means a held arrow key
      // silently cycles, and a user scanning a strip loses their place.
      const target =
        pane.tabInstanceIds[
          Math.min(Math.max(index + step, 0), pane.tabInstanceIds.length - 1)
        ];
      if (target !== undefined) onActivate(target);
    },
    [pane.tabInstanceIds, onActivate, onClose],
  );

  return (
    <div role="tablist" aria-label="Open tabs" className={styles.strip}>
      {pane.tabInstanceIds.map((instanceId) => {
        const tile = tiles[instanceId];
        // A tab with no payload violates I1 and cannot be rendered or closed
        // meaningfully. Skipping is right: `reconcile` removes it, and drawing
        // a nameless tab in the meantime invites a click that does nothing.
        if (tile === undefined) return null;

        const isActive = pane.activeTabId === instanceId;
        const isPreview = pane.previewTabId === instanceId;
        const title = tileTitle(tile);

        return (
          <div
            key={instanceId}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            data-testid="canvas-tab"
            data-instance-id={instanceId}
            data-preview={isPreview ? "true" : undefined}
            // The name carries the preview state, because italic is not
            // available to a screen reader and "why did that tab vanish" is
            // the same confusion whether or not you can see the slant.
            aria-label={isPreview ? `Preview: ${title}` : title}
            className={mergeClasses(
              styles.tab,
              isActive && styles.active,
              isActive && paneFocused && styles.accent,
              isPreview && styles.preview,
            )}
            onClick={() => {
              onActivate(instanceId);
            }}
            onDoubleClick={() => {
              onPromote(instanceId);
            }}
            onAuxClick={(event: MouseEvent<HTMLDivElement>) => {
              if (event.button !== 1) return;
              event.preventDefault();
              onClose(instanceId);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, instanceId);
            }}
          >
            <span className={styles.title}>{title}</span>
            <Button
              appearance="subtle"
              size="small"
              className={styles.close}
              icon={<DismissRegular fontSize={12} />}
              aria-label={`Close ${title}`}
              onClick={(event) => {
                // Without this the click also reaches the tab and activates
                // what is about to be closed — harmless in isolation, and it
                // makes the focus rule fire on a tab that no longer exists.
                event.stopPropagation();
                onClose(instanceId);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
