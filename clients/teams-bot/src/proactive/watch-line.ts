/**
 * One line of `bridge watch`'s stdout, validated at the boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A LOCAL MIRROR AND NOT AN IMPORT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `clients/remote-bridge` declares these same shapes in
 * `src/adapters/watch-events.ts`. This bot does not import them, for the
 * reason `read-surface/bridge-types.ts` already states about the action
 * surface: **the bridge is consumed as a spawned binary, never as source.**
 * Its stdout is an external boundary like any other, so it is parsed and
 * validated rather than trusted, and the schemas are hand-kept in sync with
 * its JSON output.
 *
 * That is a deliberate architecture, not an oversight — `package.json` holds
 * no `remote-bridge` dependency and the eslint config bans reaching for the
 * protocol. A type imported across that line would compile away and leave
 * the runtime validation this file exists to perform undone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A DROPPED LINE IS A MISSED NOTIFICATION, SO "WHY" IS PART OF THE ANSWER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The obvious signature is `parse(line): WatchEvent | null`. It is wrong
 * here. `null` collapses two cases with opposite significance:
 *
 *   a BLANK line is normal — line-buffered stdout produces them, and
 *   ignoring one costs nothing;
 *
 *   a MALFORMED line means the bridge emitted something this bot cannot
 *   read, and **somebody is blocked and will never be told**. That is the
 *   silent-failure shape this epic keeps finding, and it deserves a journal
 *   entry rather than a quiet `continue`.
 *
 * So the result names which happened and the caller decides. The caller
 * cannot accidentally treat "the bridge is speaking a dialect we don't
 * understand" as "nothing to do this tick".
 */
import { z } from "zod";

/**
 * The kinds that actually wait on a person, in the host feed's own
 * vocabulary. The union cannot express a non-blocking kind — the filter is
 * applied at the producer, so re-applying `BLOCKING_KINDS` here would be a
 * second copy of one decision and a divergence risk.
 */
export const watchEventKindSchema = z.union([
  z.literal("approval.requested"),
  z.literal("interview.requested"),
]);

const eventCommon = {
  /**
   * Stable across ticks AND across a bridge restart, because it is derived
   * (`approval.requested:<chatId>:<approvalId>`) rather than minted. That
   * property is what makes this bot's own de-duplication survive a restart
   * of either process — see `proactive-store.ts`.
   */
  eventId: z.string().min(1),
  epicId: z.string().min(1),
  chatId: z.string().min(1),
};

export const approvalAppearedSchema = z.object({
  ...eventCommon,
  type: z.literal("appeared"),
  kind: z.literal("approval.requested"),
  chatTitle: z.string().nullable(),
  approvalId: z.string().min(1),
  toolName: z.string(),
  description: z.string(),
  requestedAt: z.number(),
});

export const interviewAppearedSchema = z.object({
  ...eventCommon,
  type: z.literal("appeared"),
  kind: z.literal("interview.requested"),
  chatTitle: z.string().nullable(),
  blockId: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  requestedAt: z.number(),
});

/**
 * A `resolved` event carries no payload beyond identity, by design: the
 * bridge is saying "this stopped being pending", and nothing about the thing
 * itself has changed or is worth re-reading.
 */
export const resolvedSchema = z.object({
  ...eventCommon,
  type: z.literal("resolved"),
  kind: watchEventKindSchema,
});

export const watchEventSchema = z.union([
  approvalAppearedSchema,
  interviewAppearedSchema,
  resolvedSchema,
]);

export type ApprovalAppeared = z.infer<typeof approvalAppearedSchema>;
export type InterviewAppeared = z.infer<typeof interviewAppearedSchema>;
export type WatchEvent = z.infer<typeof watchEventSchema>;
/** The two `appeared` members — the ones that can produce a notification. */
export type AppearedEvent = ApprovalAppeared | InterviewAppeared;

export type WatchLineResult =
  | { readonly kind: "event"; readonly event: WatchEvent }
  /** Whitespace only. Routine; ignore it. */
  | { readonly kind: "blank" }
  /**
   * The bridge said something we cannot read. **Not routine** — log it. A
   * notification that should have been sent will not be.
   */
  | { readonly kind: "malformed"; readonly detail: string };

export function parseWatchLine(line: string): WatchLineResult {
  if (line.trim() === "") return { kind: "blank" };

  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (error) {
    return {
      kind: "malformed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const parsed = watchEventSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "malformed", detail: parsed.error.message };
  }
  return { kind: "event", event: parsed.data };
}
