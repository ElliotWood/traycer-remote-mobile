/**
 * "Waiting on you": everything blocked on a human, across every epic.
 *
 * EMPTY IS THE GOOD STATE HERE, and that inverts the usual framing. On the
 * epics list, zero rows is unusual and slightly worrying. Here it is the
 * whole point of the screen — nothing needs you — so it reads as
 * reassurance, not as an error and not as a blank.
 *
 * It still must not be reachable by accident: "the feed loaded and there is
 * nothing" stays strictly distinct from "we could not load it" and from "we
 * have not asked yet". That distinction has caused three defects on this
 * project, and on this surface it is also the state most users will see most
 * often — which is why it was shot first rather than last.
 *
 * EVERY ROW NAMES ITS EPIC. This is the only surface whose rows come from
 * different epics, and an item with no epic context is the untitled-row
 * defect again: true content, insufficient context, and the reader fills the
 * gap wrongly. When the title join has not resolved the row shows a SHORT ID
 * LABELLED AS ONE — never an id sitting where a name goes.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Caption1,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  ChevronRightRegular,
  PersonQuestionMarkRegular,
  ShieldTaskRegular,
} from "@fluentui/react-icons";
import { attentionLabel, type AttentionItem } from "@traycer-clients/shared/epic/attention";
import { FleetError, FleetLoading } from "../fleet/fleet-state";
import { terseTime } from "../fleet/fleet-grid";
import type { AttentionState } from "./use-attention";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    width: "100%",
    textAlign: "left",
    background: "none",
    border: "none",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  main: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  what: {
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  where: {
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  when: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    minWidth: "34px",
    textAlign: "right",
  },
  /** The reassuring empty state — centred, calm, not an error treatment. */
  clear: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalS,
    minHeight: "220px",
    justifyContent: "center",
    textAlign: "center",
    padding: tokens.spacingVerticalXXL,
  },
  clearIcon: { color: tokens.colorPaletteGreenForeground1 },
  subtle: { color: tokens.colorNeutralForeground3, maxWidth: "44ch" },
});

function KindIcon({ kind }: { kind: AttentionItem["kind"] }): ReactElement {
  return kind === "interview.requested" ? (
    <PersonQuestionMarkRegular fontSize={20} />
  ) : (
    <ShieldTaskRegular fontSize={20} />
  );
}

/**
 * Where this item lives.
 *
 * A resolved title when the join has landed. Otherwise the phrase says
 * plainly that it is an id — "Epic 3f2a1b4c" — so nothing reads as a name
 * that is not one. That is the "Insufficient Credits" defect, avoided on its
 * fourth surface.
 */
function whereLabel(
  item: AttentionItem,
  epicTitles: Readonly<Record<string, string>>,
): string {
  if (item.epicId === null) return "Epic unknown";
  const title = epicTitles[item.epicId];
  if (title !== undefined && title.trim().length > 0) return title;
  return `Epic ${item.epicId.slice(0, 8)}`;
}

export interface AttentionViewProps {
  readonly state: AttentionState;
  readonly now: number;
  readonly onOpen: (item: AttentionItem) => void;
}

export function AttentionView({
  state,
  now,
  onOpen,
}: AttentionViewProps): ReactElement {
  const styles = useStyles();

  if (state.kind === "loading") {
    return <FleetLoading rows={3} slowAfterMs={2500} label="Checking…" />;
  }
  if (state.kind === "error") {
    return (
      <FleetError
        title="Couldn’t check what’s waiting"
        subject="what needs you"
        detail={state.detail}
      />
    );
  }

  if (state.items.length === 0) {
    return (
      // `role="status"` and not `alert`: this is good news, and an assertive
      // announcement would interrupt to deliver reassurance.
      <div className={styles.clear} role="status">
        <span aria-hidden className={styles.clearIcon}>
          <CheckmarkCircleRegular fontSize={32} />
        </span>
        <Subtitle2>Nothing is waiting on you</Subtitle2>
        <Body1 className={styles.subtle}>
          Your agents will appear here when they need an approval or an answer.
        </Body1>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {state.items.map((item) => {
        const what = attentionLabel(item.kind);
        const where = whereLabel(item, state.epicTitles);
        return (
          <button
            key={item.id}
            type="button"
            className={styles.row}
            aria-label={`${what}, in ${where}`}
            onClick={() => {
              onOpen(item);
            }}
          >
            <span aria-hidden className={styles.icon}>
              <KindIcon kind={item.kind} />
            </span>
            <span className={styles.main}>
              <Body1 className={styles.what}>{what}</Body1>
              <Caption1 className={styles.where}>{where}</Caption1>
            </span>
            <Caption1 className={styles.when}>
              {terseTime(item.updatedAt, now)}
            </Caption1>
            <span aria-hidden className={styles.icon}>
              <ChevronRightRegular fontSize={16} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
