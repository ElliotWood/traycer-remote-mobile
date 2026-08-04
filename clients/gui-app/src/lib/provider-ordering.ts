/**
 * MOVED to `clients/shared/providers/provider-ordering.ts` (M2 item 2).
 *
 * Moved WHOLE rather than split. The split that was first planned would have
 * cut a seam the code does not have: all three mapping functions read
 * `ORDERED_PROVIDERS`, so the table has to travel with them, and gui-app would
 * have been left holding two sort helpers importing that table back from
 * shared. The file is 170 lines with three imports, all `@traycer/protocol` —
 * one concern (which harness corresponds to which provider, and in what
 * order), no impure half to leave behind.
 *
 * Contrast `rate-limit-envelope.ts`, which WAS split: there `@tanstack/react-
 * query` drew a real boundary in the code.
 *
 * Re-exported here so gui-app's twenty-one consumers are untouched.
 */
export * from "@traycer-clients/shared/providers/provider-ordering";
