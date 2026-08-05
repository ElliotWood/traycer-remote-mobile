/**
 * M3 — the `/` suggestion sheet.
 *
 * A bottom sheet rather than a popover anchored to the caret: on a phone the
 * caret rect and the on-screen keyboard occupy the same space and fight each
 * other, so the sheet takes the bottom of the screen where the keyboard
 * already is.
 *
 * `kind` is shown as a visible badge, not a colour or an icon alone —
 * `slash-command` and `skill` behave differently when run, and the host does
 * distinguish them (measured: 35 vs 31 on this host's Claude catalogue).
 *
 * ## Three empty states, and why the sheet opens on all of them
 *
 * This took `phase` rather than a `loading` boolean only after the boolean
 * shipped: `useGuiCommands` distinguishes `error` from `loaded`, the composer
 * collapsed that to `phase === "loading"`, and the ERROR arm was discarded on
 * the way in. The mount was also gated on there being at least one row — so
 * every state below was unreachable, including the one whose comment argued
 * it had to be told apart from the others. **A `/` on a cold or broken
 * catalogue rendered nothing at all**, which the user cannot tell from "this
 * app has no slash commands".
 *
 * The `@` sheet hides itself when there are no roots, and that IS honest —
 * with nothing to search there is no subject. It does not generalise here:
 * the catalogue is harness-scoped and **always exists**, so hiding is not
 * honesty, it is silence about a state this component can name.
 */
import type { ReactElement } from "react";
import { Slash, Sparkles } from "lucide-react";
import type { GuiAgentCommandOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { GuiCommandsPhase } from "@/host/use-gui-commands";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";

export interface CommandSheetProps {
  readonly commands: readonly GuiAgentCommandOption[];
  /**
   * The catalogue's own three-valued state, passed through rather than
   * reduced. An empty list means something different under each of them, and
   * a boolean cannot carry the difference.
   */
  readonly phase: GuiCommandsPhase;
  readonly onPick: (command: GuiAgentCommandOption) => void;
  readonly onClose: () => void;
}

/**
 * Each verdict gets its own testid, so a test asserts WHICH state rendered
 * rather than that zero rows did. All three render zero rows; the count is
 * exactly the thing that cannot tell them apart.
 */
const EMPTY_COPY: Record<"loading" | "no-matches" | "undetermined", string> = {
  loading: "Loading commands…",
  "no-matches": "No matching commands.",
  // Not "no commands": we do not know that, and saying so would be the
  // confident wrong answer this arm exists to avoid.
  undetermined: "Can't load commands right now.",
};

export function CommandSheet({
  commands,
  phase,
  onPick,
  onClose,
}: CommandSheetProps): ReactElement {
  const verdict =
    phase === "loading" ? "loading" : phase === "error" ? "undetermined" : "no-matches";
  return (
    <BottomSheet title="Commands" onClose={onClose}>
      {commands.length === 0 ? (
        <p
          data-testid={`command-empty-${verdict}`}
          style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 8px" }}
        >
          {EMPTY_COPY[verdict]}
        </p>
      ) : (
        commands.map((command) => (
          <button
            key={`${command.kind}:${command.name}`}
            type="button"
            onClick={() => onPick(command)}
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
              {command.kind === "skill" ? (
                <Sparkles size={14} aria-hidden="true" />
              ) : (
                <Slash size={14} aria-hidden="true" />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...type.bodySm, display: "block", color: theme.text }}>
                /{command.name}
                {command.argumentHint !== null && (
                  <span style={{ color: theme.mutedText }}> {command.argumentHint}</span>
                )}
              </span>
              {command.description !== "" && (
                <span
                  style={{
                    ...type.bodyXs,
                    color: theme.mutedText,
                    // Descriptions run to several hundred characters on real
                    // skills (measured: this host's `ponytail` is ~500), so
                    // unclamped a single row fills the sheet.
                    display: "-webkit-box",
                    overflow: "hidden",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {command.description}
                </span>
              )}
            </span>
            <span
              style={{
                ...type.bodyXs,
                flexShrink: 0,
                color: theme.mutedText,
                border: `1px solid ${theme.borderHairline}`,
                borderRadius: radius.sm,
                padding: "1px 5px",
              }}
            >
              {command.kind === "skill" ? "Skill" : "Command"}
            </span>
          </button>
        ))
      )}
    </BottomSheet>
  );
}
