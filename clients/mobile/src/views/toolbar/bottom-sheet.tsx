/**
 * Minimal bottom-sheet shell shared by the account/usage sheets — a dimmed
 * backdrop (tap to dismiss) + a panel pinned to the bottom, capped height
 * with its own internal scroll (same `dvh` + scrollable-body pattern as
 * `PendingCardShell` in chat-view.tsx, for the same reason: content length
 * must never push the close affordance off-screen).
 */
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useDismissLayer } from "@/router/nav-host";
import { radius, theme, type } from "@/views/design-tokens";

export interface BottomSheetProps {
  readonly title: string;
  /**
   * Called when the sheet has been dismissed — by the ✕, a backdrop tap, OR the
   * OS back gesture, which all arrive here through the same path. Callers set
   * their `open` state false here; they should not treat this as the only
   * trigger and wire a second, history-bypassing close of their own.
   */
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function BottomSheet({ title, onClose, children }: BottomSheetProps): ReactElement {
  /**
   * Back-dismissal by construction: every bottom sheet in the app — present and
   * future — participates in back navigation for free, because callers already
   * mount this conditionally, so "mounted" IS "open" and `active` is constant.
   * Registering here rather than in each caller is the difference between a
   * model a new screen joins automatically and one that needs remembering.
   */
  const dismiss = useDismissLayer(true, onClose);
  return (
    <div
      role="presentation"
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "80dvh",
          display: "flex",
          flexDirection: "column",
          background: theme.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: theme.borderHairline,
          borderBottom: "none",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: `1px solid ${theme.borderHairline}`,
          }}
        >
          <h2 style={{ ...type.titleSm, margin: 0, color: theme.text }}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: "none",
              background: "transparent",
              color: theme.mutedText,
              cursor: "pointer",
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
