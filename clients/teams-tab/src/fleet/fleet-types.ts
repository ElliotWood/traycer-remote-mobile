/**
 * The fleet row, as the TAB needs it.
 *
 * Deliberately not imported from the bot's `bridge-types`: that shape is what
 * the remote-bridge CLI happens to print, and the tab talks to the host
 * directly (decision 3) rather than through the bridge. Sharing it would
 * couple this UI to a transport it does not use.
 *
 * Per decision 6 — extract on demand, never duplicate — anything here that
 * turns out to be real shared logic moves to `clients/shared/` when a second
 * client needs it, rather than being copied now on the guess that it might.
 */
export interface FleetAgent {
  readonly agentId: string;
  readonly title: string | null;
  readonly harnessId: string | null;
  readonly surface: "gui" | "tui";
  /**
   * Actively executing right now — LOCAL-ONLY. The host activity tracker
   * does not replicate, so this is `false` for every row with
   * `isLocal: false` no matter what that agent is doing. Read it as
   * "executing ON THIS HOST", never as "executing".
   */
  readonly active: boolean;
  /** Whether this agent runs on the host we queried. Gates whether any status field means anything. */
  readonly isLocal: boolean;
  /** Which host it runs on, so the UI can name it rather than saying "elsewhere". */
  readonly hostId: string;
  /**
   * What this host can DO with the agent — a different question from whether
   * it can SEE it executing, and the two must not be conflated. Measured on
   * the live host: all 53 remote agents are `readTranscript: true,
   * sendMessage: false`, so "cannot see" and "cannot reach" are separate
   * facts that happen to coincide today.
   */
  readonly capabilities: {
    readonly readTranscript: boolean;
    readonly sendMessage: boolean;
  };
  /** Awaiting a human decision — the column that makes the grid worth reading. */
  readonly pendingApprovals: number;
  readonly pendingInterviews: number;
  readonly lastActivityAt: number | null;
}

/**
 * One derived status per row, because "active + 2 pending" is a state the
 * user acts on differently from either part alone.
 *
 * `blocked` outranks `running`: an agent waiting on you is the thing you came
 * to the fleet to find, and burying it under a green "running" badge is how
 * the card version originally hid the only actionable row on screen.
 */
export type FleetStatus = "blocked" | "running" | "idle" | "remote";

export function fleetStatus(agent: FleetAgent): FleetStatus {
  // Locality FIRST, and this ordering is the whole point.
  //
  // Measured against the real host: 53 of 56 agents in this epic run
  // elsewhere, and every one reports `active: false` — correctly, because
  // the activity tracker is local-only and does not replicate. Falling
  // through to the old `active ? "running" : "idle"` rendered all 53 as
  // "Idle", which is not a degraded answer, it is a FALSE one: the fleet
  // would calmly report that nothing was happening while agents ran.
  //
  // That is the fabricated status column arriving by a different route.
  // There is no dishonest line of code in it — just a field read as
  // answering a question it does not answer.
  // Derived from the CAPABILITY, not from locality — matching the bot, and
  // for the reason the bot records: the two agree on all 56 rows measured,
  // and that correlation is the trap. `isLocal` says whether this host can
  // SEE the agent execute; `sendMessage` says whether it can REACH it.
  // Nothing in the contract makes the second follow from the first.
  if (!agent.capabilities.sendMessage) return "remote";
  if (agent.pendingApprovals > 0 || agent.pendingInterviews > 0) {
    return "blocked";
  }
  return agent.active ? "running" : "idle";
}

/** Blocked first, then running, then idle; stable by title within a group. */
export function byUrgency(a: FleetAgent, b: FleetAgent): number {
  // Remote sorts last: it is the least actionable state, not a middling one.
  const rank: Record<FleetStatus, number> = {
    blocked: 0,
    running: 1,
    idle: 2,
    remote: 3,
  };
  const delta = rank[fleetStatus(a)] - rank[fleetStatus(b)];
  if (delta !== 0) return delta;
  return displayName(a).localeCompare(displayName(b));
}

/**
 * Never a bare UUID. Same rule the cards ended up at: a raw id is not a name,
 * and a reader who sees one has learned nothing.
 */
export function displayName(agent: FleetAgent): string {
  const title = agent.title?.trim() ?? "";
  if (title.length > 0) return title;
  const kind = agent.harnessId ?? agent.surface;
  return `Untitled ${kind} agent (${agent.agentId.slice(0, 8)})`;
}
