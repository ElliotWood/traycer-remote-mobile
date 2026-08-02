/**
 * The card shell every activity block sits in, and the status pill in its
 * header.
 *
 * COLLAPSED BY DEFAULT IS NOT A STYLE CHOICE. A real chat runs to hundreds of
 * activity blocks; mobile's Sprint 2 rubric made collapsed-by-default
 * mandatory for `tool_call`/`file_change`/`subagent` because that is what
 * keeps a transcript scannable. The same reasoning applies here and the same
 * default is used, so the two surfaces do not disagree about what a
 * transcript looks like.
 *
 * The body only MOUNTS while open. That is the lazy-fetch gate: a child that
 * fetches on mount (the diff panel) fires when the reader asks for it and not
 * once per block on load.
 *
 * Fluent by inheritance, not imitation — `tokens.*` throughout, so light,
 * dark and high-contrast arrive from the Teams host rather than from a
 * hand-matched copy of mobile's palette.
 */
import {
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

/** Status as the action-carrying blocks report it. */
export type ActionBlockStatus =
  | "streaming"
  | "completed"
  | "errored"
  | "interrupted"
  | "superseded";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: tokens.spacingVerticalS,
    overflow: "hidden",
  },
  accent: { borderLeft: `3px solid ${tokens.colorBrandStroke1}` },
  danger: { borderLeft: `3px solid ${tokens.colorPaletteRedBorder2}` },
  summary: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    width: "100%",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    background: "transparent",
    border: 0,
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
    overflowX: "auto",
    maxWidth: "100%",
  },
  static: {
    padding: tokens.spacingVerticalM,
    overflowX: "auto",
    maxWidth: "100%",
  },
  badge: {
    fontWeight: tokens.fontWeightSemibold,
    borderRadius: tokens.borderRadiusCircular,
    padding: `1px ${tokens.spacingHorizontalS}`,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  badgeRunning: {
    color: tokens.colorBrandForeground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  badgeError: {
    color: tokens.colorPaletteRedForeground1,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
  },
  badgeNeutral: {
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

const STATUS_LABELS: Readonly<Record<ActionBlockStatus, string>> = {
  streaming: "Running",
  completed: "Done",
  errored: "Error",
  interrupted: "Stopped",
  superseded: "Superseded",
};

/**
 * `completed` renders NOTHING.
 *
 * A transcript is mostly finished work, so a "Done" pill on every row is
 * noise that crowds out the two states a reader is actually scanning for.
 * `interrupted`/`superseded` are neutral rather than red — they are not
 * failures, and colouring them as failures would report a stopped turn as a
 * broken one.
 */
export function StatusBadge({
  status,
}: {
  readonly status: ActionBlockStatus;
}): ReactElement | null {
  const styles = useStyles();
  if (status === "completed") return null;
  const tone =
    status === "errored"
      ? styles.badgeError
      : status === "streaming"
        ? styles.badgeRunning
        : styles.badgeNeutral;
  return (
    <Caption1 role="status" className={mergeClasses(styles.badge, tone)}>
      {STATUS_LABELS[status]}
    </Caption1>
  );
}

export interface BlockCardProps {
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly accent?: "brand" | "danger";
  /** Accessible name for the disclosure control. */
  readonly label: string;
}

export function CollapsibleCard({
  header,
  children,
  defaultOpen = false,
  accent,
  label,
}: BlockCardProps): ReactElement {
  const styles = useStyles();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={mergeClasses(
        styles.card,
        accent === "brand" ? styles.accent : undefined,
        accent === "danger" ? styles.danger : undefined,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        className={styles.summary}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {header}
      </button>
      {open ? <div className={styles.body}>{children}</div> : null}
    </div>
  );
}

export function StaticCard({
  children,
  accent,
}: {
  readonly children: ReactNode;
  readonly accent?: "brand" | "danger";
}): ReactElement {
  const styles = useStyles();
  return (
    <div
      className={mergeClasses(
        styles.card,
        styles.static,
        accent === "brand" ? styles.accent : undefined,
        accent === "danger" ? styles.danger : undefined,
      )}
    >
      {children}
    </div>
  );
}
