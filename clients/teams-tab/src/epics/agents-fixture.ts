/**
 * Fixture agents for the epic-detail screenshots.
 *
 * SHAPED from the real distribution, INVENTED in content — same rule as the
 * other fixtures, and `oss-hygiene.sh` cannot catch a regression here because
 * every pattern in it is a shape and an internal work title has none.
 *
 * The shape that matters:
 *   - a MIX of localities, including `unknown`. Two of the three states are
 *     unreachable from a friendly fixture, and an unshot state is one that
 *     ships broken.
 *   - one untitled agent, exercising the never-a-bare-id rule.
 *   - one title long enough to ellipsise at 380px.
 *   - parent/child ids populated, so the ordering is exercised before the
 *     indentation that will consume it exists.
 */
import type { EpicChatEntry } from "@traycer-clients/shared/epic/epic-doc-chats";
import type { EpicArtifactEntry } from "@traycer-clients/shared/epic/epic-doc-artifacts";

/** Matches the fixture host id the preview configures, so rows read "On this host". */
export const AGENTS_FIXTURE_HOST = "h-alpha";
const OTHER_HOST = "h-beta";

export const AGENTS_FIXTURE_NOW = 1_800_000_000_000;
const T = AGENTS_FIXTURE_NOW;

export const AGENTS_FIXTURE: readonly EpicChatEntry[] = [
  {
    chatId: "c1000000-0000-4000-8000-000000000001",
    title: "Investigate flaky integration suite",
    parentId: null,
    createdAt: T - 6 * 3_600_000,
    updatedAt: T - 90_000,
    hostId: AGENTS_FIXTURE_HOST,
  },
  {
    chatId: "c1000000-0000-4000-8000-000000000002",
    // Long on purpose: the title is the only unbounded field on the row.
    title:
      "Migrate the config loader to zod, including the streaming transport and its reconnect path",
    parentId: "c1000000-0000-4000-8000-000000000001",
    createdAt: T - 5 * 3_600_000,
    updatedAt: T - 20 * 60_000,
    hostId: AGENTS_FIXTURE_HOST,
  },
  {
    chatId: "c1000000-0000-4000-8000-000000000003",
    title: "Review: streaming reconnect logic",
    parentId: null,
    createdAt: T - 30 * 3_600_000,
    updatedAt: T - 4 * 3_600_000,
    hostId: OTHER_HOST,
  },
  {
    chatId: "c1000000-0000-4000-8000-000000000004",
    // UNTITLED — the never-a-bare-id rule.
    title: "",
    parentId: null,
    createdAt: T - 48 * 3_600_000,
    updatedAt: T - 26 * 3_600_000,
    hostId: OTHER_HOST,
  },
  {
    chatId: "c1000000-0000-4000-8000-000000000005",
    title: "Audit: dependency licence report",
    parentId: null,
    createdAt: T - 72 * 3_600_000,
    // `hostId: null` — not replicated yet. Renders "Host not known yet",
    // never "runs elsewhere": a gap in our data is not a fact about the agent.
    updatedAt: T - 50 * 3_600_000,
    hostId: null,
  },
];

/**
 * A DEEP chain — five levels — which the friendly fixture cannot produce.
 *
 * Depth is the case that breaks this surface: indentation eats the title, and
 * at 320px there is nothing left. Truncation has returned twice on this
 * project at exactly that width, both times because the fixture had no example
 * of the shape that causes it.
 *
 * Level 4 and 5 exist specifically to exercise the indent CAP: past
 * `MAX_INDENT_DEPTH` rows must stop moving right, and a shot of a
 * five-deep chain at 380px is the only thing that shows whether they do.
 */
export const AGENTS_DEEP_FIXTURE: readonly EpicChatEntry[] = [
  {
    chatId: "d1000000-0000-4000-8000-000000000001",
    title: "Migrate config loader to zod",
    parentId: null,
    createdAt: T - 8 * 3_600_000,
    updatedAt: T - 30_000,
    hostId: AGENTS_FIXTURE_HOST,
  },
  {
    chatId: "d1000000-0000-4000-8000-000000000002",
    title: "Research: schema inference approaches",
    parentId: "d1000000-0000-4000-8000-000000000001",
    createdAt: T - 7 * 3_600_000,
    updatedAt: T - 15 * 60_000,
    hostId: AGENTS_FIXTURE_HOST,
  },
  {
    chatId: "d1000000-0000-4000-8000-000000000003",
    title: "Spike: runtime validation cost",
    parentId: "d1000000-0000-4000-8000-000000000002",
    createdAt: T - 6 * 3_600_000,
    updatedAt: T - 2 * 3_600_000,
    hostId: OTHER_HOST,
  },
  {
    chatId: "d1000000-0000-4000-8000-000000000004",
    // Long AND deep — the two failure modes at once, which is the combination
    // a fixture of short names or shallow trees never produces.
    title:
      "Benchmark the parser against the streaming transport under load and report",
    parentId: "d1000000-0000-4000-8000-000000000003",
    createdAt: T - 5 * 3_600_000,
    updatedAt: T - 5 * 3_600_000,
    hostId: OTHER_HOST,
  },
  {
    chatId: "d1000000-0000-4000-8000-000000000005",
    title: "",
    parentId: "d1000000-0000-4000-8000-000000000004",
    createdAt: T - 4 * 3_600_000,
    updatedAt: T - 20 * 3_600_000,
    hostId: null,
  },
  {
    chatId: "d1000000-0000-4000-8000-000000000006",
    title: "Audit: dependency licence report",
    parentId: null,
    createdAt: T - 40 * 3_600_000,
    updatedAt: T - 26 * 3_600_000,
    hostId: AGENTS_FIXTURE_HOST,
  },
];

/**
 * Artifacts, SHAPED from a real epic's tree: a spec with nested tickets, a
 * story with children, a review, and one untitled row.
 *
 * All four kinds appear, because the icons only earn their space if
 * spec/ticket/story/review read as different at 380px — and that is only
 * checkable with all four side by side.
 *
 * Statuses cover 0/1/2 AND null: tickets and stories carry one, specs and
 * reviews never do. A fixture where everything has a status would hide that
 * the dot must be absent rather than grey for the kinds that have none.
 */
export const ARTIFACTS_FIXTURE: readonly EpicArtifactEntry[] = [
  {
    id: "s1000000-0000-4000-8000-000000000001",
    kind: "spec",
    title: "Streaming transport reconnect",
    parentId: null,
    artifactRoomId: "r1",
    status: null,
    createdAt: T - 40 * 3_600_000,
    updatedAt: T - 60_000,
  },
  {
    id: "s1000000-0000-4000-8000-000000000002",
    kind: "ticket",
    title: "Re-dial with exponential backoff",
    parentId: "s1000000-0000-4000-8000-000000000001",
    artifactRoomId: "r2",
    status: 2,
    createdAt: T - 38 * 3_600_000,
    updatedAt: T - 30 * 60_000,
  },
  {
    id: "s1000000-0000-4000-8000-000000000003",
    kind: "ticket",
    // Long AND nested — the pair that broke the agents list.
    title:
      "Surface the reconnect state in the UI without claiming progress that has not happened",
    parentId: "s1000000-0000-4000-8000-000000000001",
    artifactRoomId: "r3",
    status: 1,
    createdAt: T - 36 * 3_600_000,
    updatedAt: T - 3 * 3_600_000,
  },
  {
    id: "s1000000-0000-4000-8000-000000000004",
    kind: "story",
    title: "A user reconnects after a laptop sleep",
    parentId: null,
    artifactRoomId: "r4",
    status: 0,
    createdAt: T - 20 * 3_600_000,
    updatedAt: T - 5 * 3_600_000,
  },
  {
    id: "s1000000-0000-4000-8000-000000000005",
    kind: "review",
    // Untitled: the never-a-bare-id rule, third surface.
    title: "",
    parentId: "s1000000-0000-4000-8000-000000000004",
    artifactRoomId: "r5",
    status: null,
    createdAt: T - 18 * 3_600_000,
    updatedAt: T - 26 * 3_600_000,
  },
  {
    id: "s1000000-0000-4000-8000-000000000006",
    kind: "review",
    title: "Critique: the staleness banner wording",
    parentId: null,
    artifactRoomId: "r6",
    status: null,
    createdAt: T - 50 * 3_600_000,
    updatedAt: T - 2 * 86_400_000,
  },
];
