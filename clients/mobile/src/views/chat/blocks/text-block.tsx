/**
 * `text` block (Sprint 2). Reuses S1's `MobileMarkdown`, no bubble chrome.
 * When `providerNotice` is set, renders as a compact info/warning divider
 * instead of plain prose — `text` is still the fallback if it were somehow
 * empty, so the notice metadata is never silently dropped.
 */
import type { ReactElement } from "react";
import type { TextBlock as TextBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { MobileMarkdown } from "../../markdown/mobile-markdown";
import { colors } from "../../ui";

export function TextBlock({ block }: { readonly block: TextBlockType }): ReactElement {
  if (block.providerNotice !== null) {
    const notice = block.providerNotice;
    const tone = notice.tone === "warning" ? colors.danger : colors.accent;
    return (
      <div
        data-testid="provider-notice"
        style={{
          border: `1px solid ${tone}`,
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 8,
          fontSize: 13,
          color: colors.text,
        }}
      >
        <div style={{ fontWeight: 600, color: tone }}>{notice.title}</div>
        <div style={{ color: colors.muted }}>{notice.message ?? block.text}</div>
      </div>
    );
  }
  return <MobileMarkdown>{block.text}</MobileMarkdown>;
}
