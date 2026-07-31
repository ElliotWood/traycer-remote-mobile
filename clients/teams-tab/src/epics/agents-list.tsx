/**
 * The agents inside an epic.
 *
 * ONE STATUS AXIS, AND IT IS LOCALITY. The epic doc carries `hostId` and
 * nothing else about an agent's runtime — no `capabilities`, no `active`.
 * Those live only on `agentSummarySchema`, returned only by `agent.list`,
 * which takes a `senderAgentId` and therefore cannot be called by a
 * signed-in human at all.
 *
 * And borrowing the bot's answer would not help, which is the part worth
 * writing down: `capabilities` is RELATIONAL. The request carries who is
 * asking; the response answers for that caller. `sendMessage: false` from the
 * bridge means "the bridge's agent cannot send to this", not "this cannot be
 * sent to". Rendering that to Elliot as a fact about HIS reach would be a
 * true value about one subject displayed as a fact about another — the same
 * shape as reading `active: false` on an unobservable row as "idle".
 *
 * So this surface says WHERE an agent runs, which it can observe, and makes
 * no claim about whether it can be reached, which it cannot. The tab is less
 * capable than the bot on that axis; saying so beats manufacturing parity.
 */
import type { ReactElement } from "react";
import {
  Body1,
  Caption1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ChevronRightRegular,
  DesktopRegular,
  PersonRegular,
  QuestionCircleRegular,
} from "@fluentui/react-icons";
import {
  agentLocality,
  type AgentLocality,
  type EpicChatEntry,
} from "@traycer-clients/shared/epic/epic-doc-chats";
import { FleetError, FleetLoading } from "../fleet/fleet-state";
import { LOAD_PHASE_LABELS, type EpicAgentsState } from "./use-epic-agents";
import { relativeTime } from "../fleet/fleet-grid";

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
    ":active": { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  icon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  main: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: tokens.colorNeutralForeground3,
  },
  when: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * Locality as icon AND words. Never colour alone, never glyph alone — high
 * contrast strips one and unfamiliarity defeats the other.
 *
 * The wording is chosen to state only what is known. "Runs on another host"
 * is an observation. It deliberately does NOT say "read-only" or
 * "unreachable", which would be claims about reach that nothing here can
 * support.
 */
function LocalityTag({ locality }: { locality: AgentLocality }): ReactElement {
  const styles = useStyles();
  const { icon, label } =
    locality === "this-host"
      ? { icon: <PersonRegular fontSize={14} />, label: "On this host" }
      : locality === "other-host"
        ? { icon: <DesktopRegular fontSize={14} />, label: "Runs on another host" }
        : {
            // Not replicated yet. Saying "elsewhere" here would turn a gap in
            // our data into a statement about the agent.
            icon: <QuestionCircleRegular fontSize={14} />,
            label: "Host not known yet",
          };
  return (
    <Caption1 className={styles.meta}>
      <span aria-hidden className={styles.icon}>
        {icon}
      </span>
      {label}
    </Caption1>
  );
}

/** Never a bare id, same rule as agents and epics. */
function agentDisplayName(entry: EpicChatEntry): string {
  const title = entry.title.trim();
  if (title.length > 0) return title;
  return `Untitled agent (${entry.chatId.slice(0, 8)})`;
}

export interface AgentsListProps {
  readonly state: EpicAgentsState;
  readonly now: number;
  /**
   * The host this client is bound to, passed in rather than imported.
   *
   * Keeps the component renderable from a fixture at a chosen host id — the
   * three locality states are otherwise unreachable in a screenshot, and an
   * unshot state is one that ships broken.
   */
  readonly configuredHostId: string;
  readonly onOpen: (chatId: string) => void;
}

export function AgentsList({
  state,
  now,
  configuredHostId,
  onOpen,
}: AgentsListProps): ReactElement {
  const styles = useStyles();

  if (state.kind === "loading") {
    return (
      <FleetLoading
        rows={4}
        slowAfterMs={2500}
        label={LOAD_PHASE_LABELS[state.phase]}
      />
    );
  }
  if (state.kind === "error") return <FleetError detail={state.detail} />;
  if (state.chats.length === 0) {
    // A CONFIRMED empty epic — the snapshot arrived and had no chats. Distinct
    // from `loading`, which is why the decode taking ~8s does not render this.
    return (
      <div className={styles.empty}>
        <Body1>No agents in this epic yet.</Body1>
      </div>
    );
  }

  // Tree order (parents before their children, newest first within a level),
  // flattened. Nesting is rendered later; the ORDER is worth having now so
  // the list does not reshuffle when indentation arrives.
  const ordered = [...state.chats].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.chatId.localeCompare(b.chatId),
  );

  return (
    <div className={styles.list}>
      {ordered.map((entry) => (
        <button
          key={entry.chatId}
          type="button"
          className={styles.row}
          onClick={() => {
            onOpen(entry.chatId);
          }}
        >
          <span aria-hidden className={styles.icon}>
            <PersonRegular fontSize={20} />
          </span>
          <span className={styles.main}>
            <Body1 className={styles.title}>{agentDisplayName(entry)}</Body1>
            <LocalityTag locality={agentLocality(entry, configuredHostId)} />
          </span>
          <Caption1 className={styles.when}>
            {relativeTime(entry.updatedAt, now)}
          </Caption1>
          <span aria-hidden className={styles.icon}>
            <ChevronRightRegular fontSize={16} />
          </span>
        </button>
      ))}
    </div>
  );
}
