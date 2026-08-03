/**
 * M3 item 3 — the `@` suggestion sheet.
 *
 * A bottom sheet for the same reason as `command-sheet.tsx`: a caret-anchored
 * popover and the on-screen keyboard occupy the same strip of a phone screen.
 *
 * The empty states are the substance of this component, not decoration. The
 * host cannot distinguish a no-match from an unreadable root (see
 * `mention-model.ts`), so what is rendered here IS the client's verdict, and
 * the three states have to stay distinct:
 *
 * - **loading** — nothing is known yet; saying "no matches" here would be a
 *   claim the client has not earned.
 * - **no matches** — the canary passed, so the workspace is readable and the
 *   query genuinely matched nothing. Keep typing.
 * - **unavailable** — every root failed its canary. Worded as *"No files
 *   available from this workspace"* rather than *"Workspace unavailable"*
 *   because the canary reads "unreadable OR empty" and a readable-but-empty
 *   directory answers 0 to it. When two states cannot be told apart, say the
 *   thing that is true of both.
 *
 * The partial-failure footnote has no equivalent in the ticket's design: it
 * exists because a binding with one good and one bogus root returns a full,
 * healthy-looking list (measured), so the only way that user ever learns a
 * repository is missing from their results is if the client says so.
 */
import type { ReactElement } from "react";
import { File as FileIcon, Folder, TriangleAlert } from "lucide-react";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import {
  mentionEmptyState,
  partiallyUnavailableRoots,
  type MentionRootStatus,
  type MentionSuggestion,
} from "@/views/chat/mention-model";
import { pathBasename } from "@/host/path-basename";
import { radius, theme, type } from "@/views/design-tokens";

export interface MentionSheetProps {
  readonly suggestions: readonly MentionSuggestion[];
  readonly loading: boolean;
  /** False when there is no host client. Ignorance, not a verdict about a root. */
  readonly connected: boolean;
  readonly rootStatuses: readonly MentionRootStatus[];
  readonly onPick: (suggestion: MentionSuggestion) => void;
  readonly onClose: () => void;
}

const EMPTY_COPY: Record<"loading" | "no-matches" | "unavailable" | "undetermined", string> = {
  loading: "Searching…",
  "no-matches": "No matching files or folders.",
  unavailable: "No files available from this workspace.",
  // Says what is true — that the client could not check — instead of
  // converting ignorance into a claim about the user's workspace.
  undetermined: "Can't check this workspace right now.",
};

export function MentionSheet({
  suggestions,
  loading,
  connected,
  rootStatuses,
  onPick,
  onClose,
}: MentionSheetProps): ReactElement {
  const empty = mentionEmptyState({
    connected,
    loading,
    suggestions,
    statuses: rootStatuses,
  });
  const degraded = partiallyUnavailableRoots(rootStatuses);

  return (
    <BottomSheet title="Files" onClose={onClose}>
      {degraded.length > 0 && (
        <p
          data-testid="mention-degraded"
          style={{
            ...type.bodyXs,
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            color: theme.mutedText,
            margin: "0 8px 6px",
          }}
        >
          <TriangleAlert size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {degraded.length === 1
              ? `Couldn't read ${pathBasename(degraded[0])} — its files are missing from these results.`
              : `Couldn't read ${String(degraded.length)} of this chat's folders — their files are missing from these results.`}
          </span>
        </p>
      )}
      {empty !== null ? (
        <p
          data-testid={`mention-empty-${empty}`}
          style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 8px" }}
        >
          {EMPTY_COPY[empty]}
        </p>
      ) : (
        suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            onClick={() => onPick(suggestion)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              width: "100%",
              textAlign: "left",
              padding: "10px 8px",
              border: "none",
              borderRadius: radius.md,
              background: "transparent",
              color: theme.text,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 16, flexShrink: 0, paddingTop: 2, color: theme.mutedText }}>
              {suggestion.kind === "folder" ? (
                <Folder size={14} aria-hidden="true" />
              ) : (
                <FileIcon size={14} aria-hidden="true" />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...type.bodySm, display: "block", color: theme.text }}>
                {suggestion.label}
              </span>
              {/* The relPath, not the label, is what gets inserted and what the
                  agent resolves — so it has to be visible before the tap. Two
                  files with the same basename in different directories are
                  otherwise indistinguishable rows. */}
              {/* `direction: rtl` is here to ellipsize a long path at the
                  START, keeping the filename end visible. It also reorders the
                  string's BIDI-NEUTRAL characters, and a path is mostly
                  neutrals: measured live, `.github/` rendered as `/github.` and
                  every folder row showed its trailing slash at the front.
                  The inner isolate keeps the text's own direction LTR — so the
                  path reads correctly — while the outer box stays RTL and goes
                  on truncating from the left. Both properties are load-bearing;
                  `unicode-bidi: plaintext` on one element would fix the order
                  by flipping the base direction, and lose the truncation side
                  with it. */}
              <span
                style={{
                  ...type.bodyXs,
                  display: "block",
                  color: theme.mutedText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  direction: "rtl",
                  textAlign: "left",
                }}
              >
                <bdi data-testid="mention-relpath" style={{ direction: "ltr", unicodeBidi: "isolate" }}>
                  {suggestion.relPath}
                </bdi>
              </span>
            </span>
          </button>
        ))
      )}
    </BottomSheet>
  );
}
