/**
 * Shared collapsed-by-default card shell for chat blocks (Sprint 2). Mandatory
 * for `reasoning`/`tool_call`/`file_change`/`subagent` — with a real chat
 * running to hundreds of activity blocks, collapsed-by-default is what keeps
 * the transcript scannable (rubric §2), not an optional per-block style.
 */
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { colors } from "../ui";

export interface CollapsibleCardProps {
  readonly header: ReactNode;
  /**
   * The body only ever MOUNTS while `open` — that's the lazy-fetch gate a
   * child needs (a `useQuery` inside it fires on mount, not on every render),
   * so no separate `open`-prop plumbing is needed here.
   */
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly accentColor?: string;
}

const MIN_TOUCH_TARGET = 44;

export function CollapsibleCard({
  header,
  children,
  defaultOpen = false,
  accentColor,
}: CollapsibleCardProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  const cardStyle: CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderLeft: accentColor ? `3px solid ${accentColor}` : `1px solid ${colors.border}`,
    borderRadius: 8,
    marginBottom: 8,
    overflow: "hidden",
  };

  return (
    <div style={cardStyle}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: MIN_TOUCH_TARGET,
          padding: "8px 12px",
          background: "transparent",
          border: 0,
          color: colors.text,
          textAlign: "left",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        {header}
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px", overflowX: "auto", maxWidth: "100%" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function StaticCard({
  children,
  accentColor,
}: {
  readonly children: ReactNode;
  readonly accentColor?: string;
}): ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderLeft: accentColor ? `3px solid ${accentColor}` : `1px solid ${colors.border}`,
        borderRadius: 8,
        marginBottom: 8,
        padding: 12,
        overflowX: "auto",
        maxWidth: "100%",
      }}
    >
      {children}
    </div>
  );
}
