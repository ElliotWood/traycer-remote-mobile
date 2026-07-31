/**
 * Fixture epics for the pre-wiring screenshots.
 *
 * SHAPED from the real list, INVENTED in content — the same rule the fleet
 * fixtures carry, and for the same two reasons. Shape must match reality or
 * the images answer the wrong question; content must not, because this URL is
 * served unauthenticated and anything here is public.
 *
 * The shape that matters, taken from the real four rows:
 *   - counts in the HUNDREDS, not single digits. The metadata line is the
 *     part most likely to wrap or smear, and small numbers never test it.
 *   - one row with NO title and no counts, which is the case that produced a
 *     blank name on screen.
 *   - one title long enough to ellipsise.
 *   - timestamps spanning minutes to weeks, so the relative-time column is
 *     exercised at both ends.
 *
 * `oss-hygiene.sh` cannot catch a regression here: every pattern in it is a
 * SHAPE, and an internal work title has no shape distinguishing it from an
 * invented one. This docblock is the control, which is weaker than a gate and
 * is written down so nobody mistakes it for one.
 */
import type { FleetEpic } from "@traycer-clients/shared/epic/epic-list";

/** The clock the fixtures' "ago" labels are relative to, so shots are stable. */
export const EPICS_FIXTURE_NOW = 1_800_000_000_000;

const T = EPICS_FIXTURE_NOW;

export const EPICS_FIXTURE: readonly FleetEpic[] = [
  {
    id: "e1000000-0000-4000-8000-000000000001",
    title: "Streaming Transport Reconnect",
    ticketCount: 39,
    specCount: 64,
    storyCount: 9,
    reviewCount: 31,
    status: "in progress",
    createdAt: T - 30 * 86_400_000,
    updatedAt: T - 23 * 60_000,
    pinned: false,
  },
  {
    id: "e1000000-0000-4000-8000-000000000002",
    // Long on purpose: the title is the only unbounded field on the row.
    title:
      "Offline Draft Sync and Conflict Resolution Across Devices",
    ticketCount: 114,
    specCount: 114,
    storyCount: 33,
    reviewCount: 41,
    status: "todo",
    createdAt: T - 60 * 86_400_000,
    updatedAt: T - 4 * 86_400_000,
    pinned: false,
  },
  {
    id: "e1000000-0000-4000-8000-000000000003",
    title: "Dependency Licence Audit",
    ticketCount: 0,
    specCount: 53,
    storyCount: 1,
    reviewCount: 24,
    status: "todo",
    createdAt: T - 40 * 86_400_000,
    updatedAt: T - 6 * 86_400_000,
    pinned: false,
  },
  {
    id: "e1000000-0000-4000-8000-000000000004",
    // UNTITLED, with a status and no counts — the exact row that rendered
    // with a blank name, where the status line was the only visible text and
    // therefore read as the title.
    title: "",
    ticketCount: 0,
    specCount: 0,
    storyCount: 0,
    reviewCount: 0,
    status: "Insufficient Credits",
    createdAt: T - 21 * 86_400_000,
    updatedAt: T - 21 * 86_400_000,
    pinned: false,
  },
];
