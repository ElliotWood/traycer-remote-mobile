/**
 * `epic.listTasks` — request building and row projection, with no UI in it.
 *
 * Extracted from `clients/mobile/src/host/use-epic-list.ts` when the Teams tab
 * needed the same list. MOVED, not copied: the request shape is deliberately
 * byte-identical to gui-app's `LIST_CLOUD_TASKS_REQUEST` so every client hits
 * one proven host path, and a second hand-maintained copy of that shape is how
 * clients quietly drift onto different host behaviour.
 *
 * What stayed behind in mobile is the TanStack `useInfiniteQuery` wrapper —
 * genuinely mobile's, and not something to force on a client that has no query
 * cache. What moved is everything that is just protocol: the request, the
 * cursor rule, the projection, the metadata line.
 *
 * NOTE ON WHY THIS IS THE TAB'S FIRST REAL DATA. `agent.list` — the obvious
 * source for a fleet of AGENTS — takes `{ epicId, senderAgentId }` and answers
 * as a caller that is itself an agent. A signed-in human has neither, which is
 * why the bot could call it (it runs as the fenced demo agent inside one epic)
 * and a user-facing tab cannot. `epic.listTasks` is user-scoped and needs no
 * agent identity, so it is the surface a signed-in person can actually be
 * shown.
 */
import type { HostRequester } from "../host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import type {
  ListTaskLight,
  ListTasksRequest,
  ListTasksSort,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import { CURRENT_EPIC_VERSION, CURRENT_PHASE_VERSION } from "./epic-version";

/** Page size. Matches gui-app's `PAGE_LIMIT` for the same board query. */
export const PAGE_LIMIT = 20;

/** Only `request` is needed to fetch a page; kept narrow so tests inject a fake. */
export type EpicListClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * The sort options the small clients expose — desktop's set minus
 * `"relevance"`, which is only meaningful mid-search-ranking on a larger
 * surface.
 */
export type FleetSort = Exclude<ListTasksSort, "relevance">;
export const DEFAULT_FLEET_SORT: FleetSort = "recent";

export interface EpicListOptions {
  /**
   * Free-text search, sent as `filters.query` — SERVER-side, the same
   * `epic.listTasks` param desktop's search uses. An empty string sends
   * `filters: null` rather than an empty query, which are different requests.
   */
  readonly query?: string;
  readonly sort?: FleetSort;
}

/** The cursor-less base request, mirroring gui-app's `LIST_CLOUD_TASKS_REQUEST`. */
function buildBaseRequest(
  options: EpicListOptions,
): Omit<ListTasksRequest, "cursor"> {
  const trimmedQuery = (options.query ?? "").trim();
  return {
    limit: PAGE_LIMIT,
    filters: trimmedQuery.length > 0 ? { query: trimmedQuery } : null,
    sort: options.sort ?? DEFAULT_FLEET_SORT,
    extensionPhaseVersion: String(CURRENT_PHASE_VERSION),
    extensionEpicVersion: String(CURRENT_EPIC_VERSION),
  };
}

/** The default (no search/sort) request shape existing callers and tests rely on. */
export const EPIC_LIST_REQUEST: Omit<ListTasksRequest, "cursor"> =
  buildBaseRequest({});

export function buildEpicListRequest(
  cursor: string | undefined,
  options: EpicListOptions = {},
): ListTasksRequest {
  const base = buildBaseRequest(options);
  return cursor === undefined ? { ...base } : { ...base, cursor };
}

export function fetchEpicListPage(
  client: EpicListClient,
  cursor: string | undefined,
  options: EpicListOptions = {},
): Promise<ListTasksResponse> {
  return client.request(
    "epic.listTasks",
    buildEpicListRequest(cursor, options),
  );
}

/**
 * The cursor for the next page, or `undefined` when there is none.
 *
 * A response with `hasMore` but a missing/empty `nextCursor` is treated as
 * TERMINAL rather than re-requesting the same page — a paginator that loops on
 * a malformed response looks like a hang, and the host is the thing at fault.
 */
export function epicListNextCursor(
  page: ListTasksResponse,
): string | undefined {
  if (!page.hasMore) return undefined;
  return typeof page.nextCursor === "string" && page.nextCursor.length > 0
    ? page.nextCursor
    : undefined;
}

/** One epic row: title, artifact counts, freeform status, activity time, pin state. */
export interface FleetEpic {
  readonly id: string;
  readonly title: string;
  readonly ticketCount: number;
  readonly specCount: number;
  readonly storyCount: number;
  readonly reviewCount: number;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * `ListTaskLight.pinned` is `optional()` on the wire (an older host omits
   * it) — defaulted to `false`, never `undefined`, so no caller needs an extra
   * null-check to render a row.
   */
  readonly pinned: boolean;
}

/**
 * Projects list rows to epics: keeps rows carrying an `epic.light` (dropping
 * phase rows, and rows whose light is null — deleted or not permitted), and
 * de-dupes by id so an id repeated across a page boundary never renders twice.
 *
 * Pinned rows sort first WITHIN the tasks passed in, stably. This is a bounded
 * simplification versus desktop's cross-all-pages pin reconciliation, which
 * needs a full accumulation store these clients deliberately don't carry: a
 * pinned epic sorts to the top of whichever pages are currently loaded, not
 * necessarily the top of the whole list once later pages arrive. Usually
 * invisible, because pinned epics tend to be recently touched and therefore on
 * page 1 anyway. Flagged rather than silent.
 */
/**
 * One `epicLight` → one row.
 *
 * Factored out because `epic.subscribe`'s `earlyMeta` frame carries the SAME
 * `epicLightSchema` as `epic.listTasks`, and that frame arrives in ~540ms
 * against ~47s for the full snapshot. Reusing this mapping means the epic
 * header rendered from the fast path and the row rendered from the list
 * cannot disagree about the same epic — a second hand-written projection is
 * how two surfaces start showing different counts for one thing.
 */
export function fleetEpicFromLight(
  light: {
    readonly id: string;
    readonly title: string;
    readonly ticketCount: number;
    readonly specCount: number;
    readonly storyCount: number;
    readonly reviewCount: number;
    readonly status: string;
    readonly createdAt: number;
    readonly updatedAt: number;
  },
  pinned = false,
): FleetEpic {
  return {
    id: light.id,
    title: light.title,
    ticketCount: light.ticketCount,
    specCount: light.specCount,
    storyCount: light.storyCount,
    reviewCount: light.reviewCount,
    status: light.status,
    createdAt: light.createdAt,
    updatedAt: light.updatedAt,
    pinned,
  };
}

export function toFleetEpics(
  tasks: readonly ListTaskLight[],
): readonly FleetEpic[] {
  const seen = new Set<string>();
  const epics: FleetEpic[] = [];
  for (const task of tasks) {
    const light = task.epic?.light;
    if (light === undefined || light === null) continue;
    if (seen.has(light.id)) continue;
    seen.add(light.id);
    epics.push(fleetEpicFromLight(light, task.pinned === true));
  }
  return [...epics.filter((e) => e.pinned), ...epics.filter((e) => !e.pinned)];
}

/**
 * Never an empty name, and never a bare id.
 *
 * Same rule the agent rows settled on: a row with no name teaches the reader
 * nothing, and a raw UUID is not a name. An untitled epic gets a humane label
 * plus a short id so two untitled epics are still distinguishable.
 *
 * The id is truncated, not shown whole — enough to tell rows apart, not so
 * much that it reads as the epic's identity.
 */
export function epicDisplayName(epic: FleetEpic): string {
  const title = epic.title.trim();
  if (title.length > 0) return title;
  return `Untitled epic (${epic.id.slice(0, 8)})`;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * The row's metadata line: non-zero artifact counts then the freeform status,
 * joined with " · ". Zero counts and an empty status are omitted, so an empty
 * epic yields "" rather than a line of zeroes that reads as real information.
 */
export function formatEpicMeta(epic: FleetEpic): string {
  const parts: string[] = [];
  if (epic.ticketCount > 0) parts.push(pluralize(epic.ticketCount, "ticket"));
  if (epic.specCount > 0) parts.push(pluralize(epic.specCount, "spec"));
  if (epic.storyCount > 0)
    parts.push(pluralize(epic.storyCount, "story", "stories"));
  if (epic.reviewCount > 0) parts.push(pluralize(epic.reviewCount, "review"));
  const status = epic.status.trim();
  if (status.length > 0) parts.push(status);
  return parts.join(" · ");
}
