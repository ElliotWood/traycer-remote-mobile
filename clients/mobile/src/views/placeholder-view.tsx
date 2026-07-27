/**
 * Route slot for a drilldown level whose real view lands in a later ticket
 * (epic detail → T5, chat detail → T6). It is a HONEST placeholder: it names
 * the level and the id reached, and offers a working Back — it never fabricates
 * epic/chat content. T5/T6 replace the corresponding `case` in `AppShell` with
 * their view.
 */
import type { ReactElement } from "react";
import { colors, screen, secondaryButton } from "./ui";

interface PlaceholderViewProps {
  readonly title: string;
  readonly subtitle: string;
  readonly note: string;
  readonly onBack: () => void;
}

export function PlaceholderView({
  title,
  subtitle,
  note,
  onBack,
}: PlaceholderViewProps): ReactElement {
  return (
    <main style={screen}>
      <button
        type="button"
        style={{ ...secondaryButton, marginBottom: 16 }}
        onClick={onBack}
      >
        ← Back
      </button>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>{title}</h1>
      <p style={{ color: colors.muted, marginTop: 0, wordBreak: "break-all" }}>
        {subtitle}
      </p>
      <p style={{ color: colors.muted }}>{note}</p>
    </main>
  );
}
