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
