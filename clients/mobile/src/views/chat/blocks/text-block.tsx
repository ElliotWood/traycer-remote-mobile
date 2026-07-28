/**
 * `text` block (Sprint 2). Reuses S1's `MobileMarkdown`, no bubble chrome.
 * When `providerNotice` is set, renders as a compact info/warning divider
 * instead of plain prose — `text` is still the fallback if it were somehow
 * empty, so the notice metadata is never silently dropped.
 */
import { memo, useMemo, type ReactElement } from "react";
import type { TextBlock as TextBlockType } from "@traycer/protocol/persistence/epic/content-blocks";
import { parseTraycerNextStepsMarkdown } from "@traycer-clients/shared/markdown/traycer-next-steps";
import { MobileMarkdown } from "../../markdown/mobile-markdown";
import { NextStepsGroup } from "../next-steps-group";
import { colors } from "../../ui";

/** Perf batch 2 (B2-3): memoized — see `approval-block.tsx`'s note. */
export const TextBlock = memo(function TextBlock({ block }: { readonly block: TextBlockType }): ReactElement {
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
  return <TextBody text={block.text} />;
});

/**
 * Splits assistant prose around any `<TRAYCER_NEXT_STEPS>` block so the
 * options render as tappable rows. Without this the raw `- [] some text`
 * markup leaked through verbatim, which is what the user saw.
 *
 * `isStreaming: false` is correct here: this component only ever renders a
 * PERSISTED text block. The live turn renders through its own path, and the
 * parser's incomplete-block handling exists for that case — passing `true`
 * here would leave a finished block's options permanently inert.
 */
function TextBody({ text }: { readonly text: string }): ReactElement {
  const parts = useMemo(() => parseTraycerNextStepsMarkdown(text, false), [text]);

  // Fast path: no next-steps block (the overwhelming majority of messages).
  // The parser already returns a single markdown part here, but skipping the
  // wrapper keeps the DOM identical to before for every unaffected message.
  if (parts.length === 1 && parts[0].kind === "markdown") {
    return <MobileMarkdown>{parts[0].markdown}</MobileMarkdown>;
  }

  return (
    <>
      {parts.map((part) =>
        part.kind === "markdown" ? (
          <MobileMarkdown key={part.id}>{part.markdown}</MobileMarkdown>
        ) : (
          <NextStepsGroup
            key={part.id}
            prose={part.prose}
            options={part.options}
            complete={part.complete}
          />
        ),
      )}
    </>
  );
}
