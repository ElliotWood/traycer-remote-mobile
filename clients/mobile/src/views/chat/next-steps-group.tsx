/**
 * Renders a `<TRAYCER_NEXT_STEPS>` block as tappable rows instead of the raw
 * `- [] some text` markdown the user was seeing.
 *
 * Parsing is NOT reimplemented here — it comes from
 * `@traycer-clients/shared/markdown/traycer-next-steps`, the same module
 * gui-app uses. Two parsers for one grammar would drift and the phone and
 * desktop would disagree about what counts as an option for the identical
 * assistant message.
 */
import { memo, type CSSProperties, type ReactElement } from "react";
import type { TraycerNextStepOption } from "@traycer-clients/shared/markdown/traycer-next-steps";
import { MobileMarkdown } from "../markdown/mobile-markdown";
import { colors } from "../ui";
import { useNextSteps } from "./next-steps-context";

export const NextStepsGroup = memo(function NextStepsGroup({
  prose,
  options,
  complete,
}: {
  readonly prose: string;
  readonly options: ReadonlyArray<TraycerNextStepOption>;
  /** False while the block is still streaming in — suppresses the affordance. */
  readonly complete: boolean;
}): ReactElement {
  const nextSteps = useNextSteps();
  // No provider (artifact previews, tests) or still streaming ⇒ the rows are
  // not actionable. Render them as static rows rather than dead buttons: a
  // button that does nothing when tapped is worse than obviously-inert text.
  const actionable = nextSteps !== null && complete;

  return (
    <div data-testid="next-steps-group" style={groupStyle}>
      {prose.length > 0 ? <MobileMarkdown>{prose}</MobileMarkdown> : null}
      <div style={listStyle}>
        {options.map((option) =>
          actionable ? (
            <button
              key={option.id}
              type="button"
              data-testid="next-step-option"
              style={rowStyle}
              onClick={() => nextSteps.insertPrompt(option.prompt)}
            >
              <span style={textStyle}>{option.prompt}</span>
              <span aria-hidden="true" style={arrowStyle}>
                ↗
              </span>
            </button>
          ) : (
            <div key={option.id} data-testid="next-step-option-inert" style={inertRowStyle}>
              <span style={textStyle}>{option.prompt}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
});

const groupStyle: CSSProperties = { marginTop: 4 };

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 8,
};

const baseRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  // >=44px is Apple's minimum touch target; these are full-width rows on a
  // phone so an accidental neighbouring tap is the main risk, not a miss.
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: 10,
  textAlign: "left",
  fontSize: 14,
  lineHeight: 1.35,
  fontFamily: "inherit",
};

const rowStyle: CSSProperties = {
  ...baseRowStyle,
  border: `1px solid ${colors.accent}`,
  background: "transparent",
  color: colors.text,
  cursor: "pointer",
};

const inertRowStyle: CSSProperties = {
  ...baseRowStyle,
  border: `1px dashed ${colors.border}`,
  background: "transparent",
  color: colors.muted,
};

const textStyle: CSSProperties = { flex: 1, minWidth: 0 };

const arrowStyle: CSSProperties = {
  flexShrink: 0,
  color: colors.accent,
  fontSize: 16,
  lineHeight: 1,
};
