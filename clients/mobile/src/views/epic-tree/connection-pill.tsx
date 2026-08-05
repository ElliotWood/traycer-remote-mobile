/**
 * P1 — connection pill, desktop's 3-state copy (`epic-connection-pill.tsx`):
 * live -> "All changes synced", reconnecting -> "Reconnecting…",
 * disconnected -> "Offline". Pill-styled (not plain status text like the
 * pre-P1 `ConnectionIndicator`).
 */
import type { CSSProperties, ReactElement } from "react";
import type { StreamConnectionState } from "@/host/stream-connection";
import { radius, theme, type } from "@/views/design-tokens";

const COPY: Readonly<Record<StreamConnectionState, string>> = {
  live: "All changes synced",
  reconnecting: "Reconnecting…",
  disconnected: "Offline",
};

const DOT_COLOR: Readonly<Record<StreamConnectionState, string>> = {
  live: theme.success,
  reconnecting: theme.warning,
  disconnected: theme.danger,
};

export function ConnectionPill({ state }: { readonly state: StreamConnectionState }): ReactElement {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px 3px 8px",
    borderRadius: radius.xl,
    background: state === "live" ? "transparent" : theme.surface,
    border: `1px solid ${state === "live" ? "transparent" : theme.borderHairline}`,
    ...type.bodyXs,
    color: state === "live" ? theme.mutedText : theme.text,
    marginTop: 4,
  };
  return (
    <span role="status" style={style}>
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: DOT_COLOR[state],
          flexShrink: 0,
        }}
      />
      {COPY[state]}
    </span>
  );
}
