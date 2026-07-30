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
  /** Actively executing a turn right now. */
  readonly active: boolean;
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
export type FleetStatus = "blocked" | "running" | "idle";

export function fleetStatus(agent: FleetAgent): FleetStatus {
  if (agent.pendingApprovals > 0 || agent.pendingInterviews > 0) {
    return "blocked";
  }
  return agent.active ? "running" : "idle";
}

/** Blocked first, then running, then idle; stable by title within a group. */
export function byUrgency(a: FleetAgent, b: FleetAgent): number {
  const rank: Record<FleetStatus, number> = { blocked: 0, running: 1, idle: 2 };
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
