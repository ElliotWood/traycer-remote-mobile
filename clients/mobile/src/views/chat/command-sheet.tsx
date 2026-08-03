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
 */
import type { ReactElement } from "react";
import { Slash, Sparkles } from "lucide-react";
import type { GuiAgentCommandOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { radius, theme, type } from "@/views/design-tokens";

export interface CommandSheetProps {
  readonly commands: readonly GuiAgentCommandOption[];
  /** True while the catalogue is in flight — an empty list then is not "no matches". */
  readonly loading: boolean;
  readonly onPick: (command: GuiAgentCommandOption) => void;
  readonly onClose: () => void;
}

export function CommandSheet({
  commands,
  loading,
  onPick,
  onClose,
}: CommandSheetProps): ReactElement {
  return (
    <BottomSheet title="Commands" onClose={onClose}>
      {loading && commands.length === 0 ? (
        // Distinguished from "no matches" deliberately: they look identical on
        // screen and mean opposite things about whether to keep typing.
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 8px" }}>
          Loading commands&hellip;
        </p>
      ) : commands.length === 0 ? (
        <p style={{ ...type.bodySm, color: theme.mutedText, margin: "4px 8px" }}>
          No matching commands.
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
