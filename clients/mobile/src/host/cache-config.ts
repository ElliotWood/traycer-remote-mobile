/**
 * Shared constants for the client-side persistence layer (P0): the TanStack
 * Query persister (`app-root.tsx`), the epic-tree projection seed
 * (`use-epic-doc.ts`), and the chat transcript cache (`use-chat.ts`) all key
 * off the same schema version and max-age so a shape change in one is easy to
 * bust everywhere at once.
 *
 * `CACHE_SCHEMA_VERSION` is bumped by hand whenever a persisted shape changes
 * (a field added/removed/renamed in what gets written) — there is no
 * build-time app version to key off (`package.json` stays at `"0.0.0"`), so
 * this constant IS the cache buster.
 */
export const CACHE_SCHEMA_VERSION = "1";

/**
 * How long persisted data is trusted before being discarded outright. Also
 * the floor for the QueryClient's `gcTime` (TanStack v5 gotcha: `gcTime` must
 * be >= the persister's `maxAge`, or a just-restored query is already
 * eligible for garbage collection before any component observes it).
 */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
