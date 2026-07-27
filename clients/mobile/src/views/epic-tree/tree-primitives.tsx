/**
 * Shared row-layout primitives for the P1 Epic tree (Agents + Artifacts
 * sections) — mirrors desktop's `epic-sidebar-tree-shared.ts` constants
 * (`INDENT_PX`/`BASE_PAD_LEFT`) and `epic-sidebar-tree-guide.tsx`'s
 * `TreeGroupGuide`, bumped from desktop's 28px mouse rows to a 44px touch
 * minimum (desktop has no touch-target convention at all — mobile invents
 * one, per the P1 contract).
 */
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { radius, theme } from "@/views/design-tokens";

export const INDENT_PX = 16;
export const BASE_PAD_LEFT = 8;
export const GUIDE_OFFSET_PX = 7;
export const ROW_MIN_HEIGHT = 44;
const HIT_SIZE = 44;

export function rowIndentStyle(depth: number): CSSProperties {
  return { paddingLeft: depth * INDENT_PX + BASE_PAD_LEFT };
}

/**
 * One vertical guide line per ancestor level, mirroring `TreeGroupGuide`: a
 * nested row shows N parallel rails, one per expanded ancestor group.
 */
export function GuideRails({ depth }: { readonly depth: number }): ReactElement | null {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: level * INDENT_PX + BASE_PAD_LEFT + GUIDE_OFFSET_PX,
            width: 1,
            background: theme.border,
          }}
        />
      ))}
    </>
  );
}

export function TreeChevron({
  hasChildren,
  expanded,
  onToggle,
  depth,
}: {
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly depth: number;
}): ReactElement {
  const hitStyle: CSSProperties = {
    width: HIT_SIZE,
    minHeight: HIT_SIZE,
    marginLeft: depth * INDENT_PX,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.mutedText,
  };
  if (!hasChildren) {
    return <span aria-hidden="true" style={hitStyle} />;
  }
  return (
    <button
      type="button"
      aria-label={expanded ? "Collapse" : "Expand"}
      style={{ ...hitStyle, border: "none", background: "transparent", cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
    </button>
  );
}

/** The always-visible "⋯" row-action trigger — hover-reveal isn't a mobile affordance, so this stays visible (P1 contract). */
export function RowActionsButton({
  label,
  onOpen,
}: {
  readonly label: string;
  readonly onOpen: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        width: HIT_SIZE,
        minHeight: HIT_SIZE,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: theme.mutedText,
        cursor: "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
  );
}

export const rowShellStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "stretch",
};

export function rowOpenButtonStyle(): CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: ROW_MIN_HEIGHT,
    padding: "0 4px",
    border: "none",
    background: "transparent",
    color: theme.textRow,
    fontSize: 14,
    textAlign: "left",
    cursor: "pointer",
    borderRadius: radius.sm,
  };
}

export const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 4px",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  width: "100%",
  textAlign: "left",
};

export const sectionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: theme.mutedText,
};
