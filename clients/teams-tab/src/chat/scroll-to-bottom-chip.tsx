/**
 * "Jump to latest" — ported from mobile's `ScrollToBottomChip`, restyled
 * with Fluent tokens for this client. Stays mounted (opacity/pointer-events
 * toggle) rather than unmount/remount so it never steals focus while
 * invisible.
 */
import type { ReactElement } from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ChevronDownRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  chip: {
    position: "absolute",
    bottom: tokens.spacingVerticalM,
    left: "50%",
    transform: "translateX(-50%)",
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow8,
    fontSize: tokens.fontSizeBase200,
    cursor: "pointer",
    transitionProperty: "opacity",
    transitionDuration: tokens.durationFast,
  },
  visible: { opacity: 1, pointerEvents: "auto" },
  hidden: { opacity: 0, pointerEvents: "none" },
});

export function ScrollToBottomChip({
  visible,
  onClick,
}: {
  readonly visible: boolean;
  readonly onClick: () => void;
}): ReactElement {
  const styles = useStyles();
  return (
    <button
      type="button"
      className={mergeClasses(styles.chip, visible ? styles.visible : styles.hidden)}
      onClick={onClick}
      aria-hidden={!visible}
    >
      <ChevronDownRegular fontSize={13} aria-hidden="true" />
      Jump to latest
    </button>
  );
}
