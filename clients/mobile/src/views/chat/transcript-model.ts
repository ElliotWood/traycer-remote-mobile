/**
 * MOVED to `@traycer-clients/shared/epic/transcript-tree` when the Teams tab
 * needed the same block→tree projection. Re-exported so no call site moved.
 *
 * The tab could not reach transcript parity without it: its own data layer
 * (`shared/epic/transcript.ts`) reduces every non-prose block to a label
 * string, so a renderer downstream of it has nothing left to draw. The
 * suppression rules matter as much as the nesting — without them a turn that
 * edits a file renders the `tool_call` AND the `file_change` it produced.
 */
export * from "@traycer-clients/shared/epic/transcript-tree";
