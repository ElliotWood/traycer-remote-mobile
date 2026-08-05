/** `error` block (Sprint 2) — static, non-collapsible. */
import { memo, type ReactElement } from "react";
import type { ErrorBlock as ErrorBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { colors } from "../../ui";

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const ErrorBlock = memo(function ErrorBlock({ block }: { readonly block: ErrorBlockType }): ReactElement {
  return (
    <div
      role="alert"
      style={{
        border: `1px solid ${colors.danger}`,
        background: colors.dangerBg,
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 600, color: colors.danger, fontSize: 13 }}>
        Error{block.code !== null ? ` · ${block.code}` : ""}
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 13, wordBreak: "break-word" }}>{block.message}</p>
    </div>
  );
});
