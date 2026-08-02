/**
 * A line diff for a `file_change` / `artifact_operation` body.
 *
 * The same minimal client-side approach mobile takes — `diffLines` from the
 * `diff` package, plain coloured rows — deliberately not a diff component
 * library. What a reader needs inside a transcript card is which lines moved,
 * not a review tool.
 *
 * THE `reason` IS THE CONTENT when it is not `snapshot`. A binary file, an
 * evicted blob and a denied edit are three different facts, and rendering any
 * of them as an empty diff would say "nothing changed" — which is false for
 * two of the three. Each gets its own sentence.
 */
import { useMemo, type ReactElement } from "react";
import { diffLines } from "diff";
import { Body1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { FileEditReason } from "@traycer/protocol/persistence/epic/content-blocks";

const REASON_COPY: Readonly<Record<FileEditReason, string>> = {
  snapshot: "",
  binary: "Binary file — no text diff available.",
  too_large: "File too large to diff.",
  blob_missing: "Snapshot content is no longer available on this host.",
  capture_failed: "The change’s before/after content could not be captured.",
  not_intercepted: "This change predates diff capture — no content to show.",
  denied: "The edit was denied — the file was never changed.",
};

const useStyles = makeStyles({
  note: { color: tokens.colorNeutralForeground3, margin: 0 },
  diff: {
    margin: 0,
    overflowX: "auto",
    maxWidth: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  row: { whiteSpace: "pre" },
  added: { color: tokens.colorPaletteGreenForeground1 },
  removed: { color: tokens.colorPaletteRedForeground1 },
  context: { color: tokens.colorNeutralForeground3 },
});

export interface DiffViewProps {
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly reason: FileEditReason;
}

export function DiffView({
  beforeContent,
  afterContent,
  reason,
}: DiffViewProps): ReactElement {
  const styles = useStyles();
  const parts = useMemo(
    () =>
      reason === "snapshot"
        ? diffLines(beforeContent ?? "", afterContent ?? "")
        : null,
    [beforeContent, afterContent, reason],
  );

  if (parts === null) {
    return <Body1 className={styles.note}>{REASON_COPY[reason]}</Body1>;
  }

  return (
    <pre data-testid="diff-view" className={styles.diff}>
      {parts.flatMap((part, partIndex) => {
        const tone = part.added
          ? styles.added
          : part.removed
            ? styles.removed
            : styles.context;
        const prefix = part.added ? "+" : part.removed ? "-" : " ";
        return part.value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, lineIndex) => (
            <div
              key={`${String(partIndex)}-${String(lineIndex)}`}
              className={mergeClasses(styles.row, tone)}
            >
              {prefix} {line}
            </div>
          ));
      })}
    </pre>
  );
}
