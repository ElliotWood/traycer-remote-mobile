/**
 * P2 — "Jump to latest" chip (`ScrollToBottomChip` on desktop), exact copy
 * + icon. Stays mounted (opacity/pointer-events toggle) rather than
 * unmount/remount so it never steals focus while invisible.
 */
import type { CSSProperties, ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import { radius, theme, type } from "@/views/design-tokens";

export function ScrollToBottomChip({
  visible,
  onClick,
}: {
  readonly visible: boolean;
  readonly onClick: () => void;
}): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    minHeight: 32,
    borderRadius: radius.xl,
    border: `1px solid ${theme.borderHairline}`,
    background: theme.surface,
    color: theme.text,
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
    ...type.bodyXs,
    cursor: "pointer",
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? "auto" : "none",
    transition: "opacity 150ms ease",
  };
  return (
    <button type="button" style={style} onClick={onClick} aria-hidden={!visible}>
      <ChevronDown size={13} aria-hidden="true" />
      Jump to latest
    </button>
  );
}
