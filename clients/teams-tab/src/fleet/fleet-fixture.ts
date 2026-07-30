/**
 * Fixture fleet for the pre-wiring screenshots.
 *
 * Shaped from the real fleet rather than invented: Elliot's epic has ~55
 * agents, most idle, a few blocked, titles long enough to need truncation,
 * and some untitled. A tidy 3-row fixture would make any layout look good —
 * which is precisely how the card version's fixtures hid its problems.
 */
import type { FleetAgent } from "./fleet-types";

const T = 1_800_000_000_000;

export const FLEET_FIXTURE: readonly FleetAgent[] = [
  {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "Migrate config loader to zod",
    harnessId: "claude",
    surface: "gui",
    active: true,
    pendingApprovals: 1,
    pendingInterviews: 0,
    lastActivityAt: T - 90_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000002",
    title: "Investigate flaky integration suite",
    harnessId: "claude",
    surface: "gui",
    active: true,
    pendingApprovals: 0,
    pendingInterviews: 0,
    lastActivityAt: T - 30_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000003",
    title:
      "Research: cache invalidation strategy and the chat.subscribe snapshot contract",
    harnessId: "claude",
    surface: "gui",
    active: false,
    pendingApprovals: 0,
    pendingInterviews: 2,
    lastActivityAt: T - 600_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000004",
    title: "Review: streaming reconnect logic",
    harnessId: "codex",
    surface: "tui",
    active: false,
    pendingApprovals: 0,
    pendingInterviews: 0,
    lastActivityAt: T - 3_600_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000005",
    title: null,
    harnessId: null,
    surface: "tui",
    active: false,
    pendingApprovals: 0,
    pendingInterviews: 0,
    lastActivityAt: null,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000006",
    title: "Prototype: offline draft sync",
    harnessId: "claude",
    surface: "gui",
    active: false,
    pendingApprovals: 3,
    pendingInterviews: 0,
    lastActivityAt: T - 240_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000007",
    title: "Refactor the notification queue",
    harnessId: "claude",
    surface: "gui",
    active: false,
    pendingApprovals: 0,
    pendingInterviews: 0,
    lastActivityAt: T - 86_400_000,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000008",
    title: "Audit: dependency licence report",
    harnessId: "codex",
    surface: "tui",
    active: true,
    pendingApprovals: 0,
    pendingInterviews: 0,
    lastActivityAt: T - 12_000,
  },
];

/** The clock the fixtures' "ago" labels are relative to, so shots are stable. */
export const FIXTURE_NOW = T;
