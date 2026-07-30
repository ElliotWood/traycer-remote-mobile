/**
 * Fixture fleets for the pre-wiring screenshots.
 *
 * SHAPED from the real fleet, INVENTED in content. Those are different
 * things and the distinction is the point of this docblock.
 *
 * Shape matters: ~56 agents, most idle, titles long enough to truncate,
 * some untitled, and the real 53/3 local/remote split. A tidy 3-row fixture
 * makes any layout look good, which is exactly how the card version's
 * fixtures hid its problems, and a friendly distribution hid an inverted
 * collapse until the real one was rendered.
 *
 * Content must NOT be real. The first version used the epic's actual agent
 * names, the real machine name and the company name, on the reasoning that a
 * fixture reading like the real fleet makes the screenshots honest. It does
 * — and it also put internal work names into a public repo. "The screenshot
 * must be honest" and "the fixture must not disclose" are separate goals,
 * and invented names of realistic shape satisfy both. The layout does not
 * care whose work it names.
 */
import type { FleetAgent } from "./fleet-types";

const T = 1_800_000_000_000;

/** Synthetic host ids. Never a real machine name. */
const LOCAL_HOST = "h-alpha";
const REMOTE_HOST = "h-beta";

/** Invented, of realistic shape and length. */
const TITLES = [
  "Investigate flaky integration suite",
  "Migrate config loader to zod",
  "Review: streaming reconnect logic",
  "Research: cache invalidation strategy",
  "Spike: incremental build cache",
  "Refactor the notification queue",
  "Audit: dependency licence report",
  "Prototype: offline draft sync",
];

const local = (over: Partial<FleetAgent>): FleetAgent => ({
  agentId: "a1000000-0000-4000-8000-000000000000",
  title: null,
  harnessId: "claude",
  surface: "gui",
  active: false,
  isLocal: true,
  hostId: LOCAL_HOST,
  capabilities: { readTranscript: true, sendMessage: true },
  pendingApprovals: 0,
  pendingInterviews: 0,
  lastActivityAt: null,
  ...over,
});

/**
 * The lively fixture: blocked and running rows, so the status column and the
 * urgency sort have something to show. Does NOT reflect the real fleet, which
 * has neither — see {@link REAL_FLEET_FIXTURE}.
 */
export const FLEET_FIXTURE: readonly FleetAgent[] = [
  local({
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: TITLES[0],
    active: true,
    pendingApprovals: 1,
    lastActivityAt: T - 90_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000002",
    title: TITLES[1],
    active: true,
    lastActivityAt: T - 30_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000003",
    // Long on purpose: the name column's truncation behaviour is the thing
    // most likely to look wrong, and a fixture of short names never tests it.
    title: `${TITLES[3]} across the streaming and unary transports`,
    pendingInterviews: 2,
    lastActivityAt: T - 600_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000004",
    title: TITLES[2],
    harnessId: "codex",
    surface: "tui",
    lastActivityAt: T - 3_600_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000005",
    // Untitled: exercises the never-render-a-bare-UUID rule.
    title: null,
    harnessId: null,
    surface: "tui",
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000006",
    title: TITLES[4],
    pendingApprovals: 3,
    lastActivityAt: T - 240_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000007",
    title: TITLES[5],
    lastActivityAt: T - 86_400_000,
  }),
  local({
    agentId: "a1000000-0000-4000-8000-000000000008",
    title: TITLES[6],
    harnessId: "codex",
    surface: "tui",
    active: true,
    lastActivityAt: T - 12_000,
  }),
];

/** The clock the fixtures' "ago" labels are relative to, so shots are stable. */
export const FIXTURE_NOW = T;

/**
 * The REAL distribution — 53 remote, 3 local, every one idle.
 *
 * Deliberately no blocked and no running rows. The temptation is to sprinkle
 * one in so the screenshot looks livelier; that would be designing against a
 * situation that does not exist, and it is precisely what hid the inverted
 * collapse — the friendly fixture had no remote rows at all, so the bug was
 * unreachable until this existed.
 */
export const REAL_FLEET_FIXTURE: readonly FleetAgent[] = [
  ...Array.from({ length: 3 }, (_, i): FleetAgent =>
    local({
      agentId: `a1000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
      title: `${TITLES[i]} (local)`,
      lastActivityAt: T - (i + 1) * 7_200_000,
    }),
  ),
  ...Array.from({ length: 53 }, (_, i): FleetAgent =>
    local({
      agentId: `b1000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      // Distinct titles. Cycling a fixed list produced six identical rows
      // in the render, which reads as a rendering bug rather than a fixture
      // artefact — a screenshot that misleads its reviewer is worse than no
      // screenshot.
      title:
        i % 9 === 0 ? null : `${TITLES[i % TITLES.length]} #${String(i + 1)}`,
      harnessId: i % 4 === 0 ? "codex" : "claude",
      surface: i % 4 === 0 ? "tui" : "gui",
      isLocal: false,
      hostId: REMOTE_HOST,
      capabilities: { readTranscript: true, sendMessage: false },
      lastActivityAt: T - (i + 1) * 1_800_000,
    }),
  ),
];
