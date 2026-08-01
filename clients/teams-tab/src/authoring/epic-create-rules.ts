/**
 * The two decisions in an epic create that are worth stating away from React:
 * WHETHER TO SEND, and WHAT TO SAY WHEN IT DOESN'T COME BACK.
 *
 * Both live here rather than as `if`s inside a hook callback because this
 * package tests decisions, not rendering (`vitest.config.ts` runs in `node`
 * with no DOM). A gate inside a promise callback is reachable only by driving
 * a component, so in this package it is effectively untested — and both of
 * these fail silently when wrong: a skipped gate produces a durable wrong
 * record, and the wrong retry word produces a duplicate epic.
 */
import type { RetrySafety } from "./create-phase";

/**
 * Why a create was not sent, or `null` to send.
 *
 * Modelled as a reason rather than a boolean so a caller can tell the
 * refusals apart, and so a test names which gate it is exercising.
 */
export type EpicCreateRefusal =
  /** No bound host client — the tab is not connected. */
  | "no-client"
  /** No configured host id. The folded chat's `hostId` is stamped for life. */
  | "no-host"
  /** Identity not resolved. `createdBy` drives the ownership filter. */
  | "no-user"
  /** No usable first line, which would title the epic "" forever. */
  | "no-title"
  /** A create is already in flight; a second would race onto the same phase. */
  | "in-flight";

export interface EpicCreateGateInput {
  readonly hasClient: boolean;
  readonly configuredHostId: string;
  readonly userId: string;
  /** `titleFromInstruction`'s answer — `null` when there is no usable line. */
  readonly title: string | null;
  readonly inFlight: boolean;
}

/**
 * Ordered deliberately: the checks that describe a broken DEPLOYMENT
 * (`no-client`, `no-host`, `no-user`) come before the ones that describe this
 * ATTEMPT (`in-flight`, `no-title`), so the caller surfaces the durable
 * problem rather than telling someone whose tab has no host configured to type
 * something first — a loop that cannot terminate from the user's side.
 *
 * Only that grouping is load-bearing, and only it is pinned by a test. The
 * order WITHIN each group is arbitrary: no caller reads the reason yet (the
 * hook treats a non-null as "don't send"), so a test fixing it would assert a
 * property nothing depends on. Established rather than assumed — the mutation
 * probe's first attempt at this entry swapped two attempt faults, survived,
 * and was correct to.
 */
export function epicCreateRefusal(
  input: EpicCreateGateInput,
): EpicCreateRefusal | null {
  if (!input.hasClient) return "no-client";
  if (input.configuredHostId.trim().length === 0) return "no-host";
  if (input.userId.trim().length === 0) return "no-user";
  if (input.inFlight) return "in-flight";
  if (input.title === null) return "no-title";
  return null;
}

/**
 * The retry advice for `epic.create`, and the reason it is not the neighbouring
 * create's.
 *
 * `use-create-agent` uses `"idempotent"` because `createChatRequestSchema`
 * says, at the field: "Client-supplied. The host resolver is idempotent on
 * this id." `epicLightSchema.id` says nothing of the kind. `create-phase.ts`
 * gives the rule — "DEFAULT TO 'verify' … only claim retry-safety when the
 * schema says so" — so the silence decides this, not a judgement about how
 * likely a duplicate is.
 *
 * A constant rather than a literal at the call site because the two hooks are
 * otherwise near-identical, and this is the one line a copy-paste would carry
 * across without looking wrong.
 */
export const EPIC_CREATE_RETRY: RetrySafety = "may-duplicate";
