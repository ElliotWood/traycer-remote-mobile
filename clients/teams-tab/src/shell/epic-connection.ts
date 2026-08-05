/**
 * `EpicAgentsState` → what the status strip should say.
 *
 * A pure function, split out of `app.tsx` where this mapping lived as a
 * ternary chain, for one reason: **the mapping had a hole and nothing could
 * see it.** `EpicConnectionState` has four members and the chain produced
 * three. `stale` — the only one carrying an age, and the one the strip
 * already renders with the age — was never constructed by anybody.
 *
 * So the strip had a `stale` branch, with a comment explaining that the age
 * is the whole decision, that could not appear on screen. A correct renderer
 * for a state that does not exist.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY STALENESS IS "DISCONNECTED", NOT "OLD"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A live epic that nobody has touched for an hour is NOT stale — nothing
 * changed, and the rows on screen are current. A disconnected epic is stale
 * the instant it disconnects, however recent the last update.
 *
 * So the trigger is `connected === false`, and the AGE is the payload rather
 * than the trigger. Getting this backwards puts a warning banner on a healthy
 * idle epic, which trains people to ignore the banner — and a warning
 * everyone ignores is worse than no warning, because it still looks like
 * coverage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE AGE IS NEVER OMITTED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Disconnected" alone asks the user to judge whether what they can see is
 * still true, while withholding the only fact that decides it. Eight seconds
 * and eight hours produce identical banners and opposite correct actions.
 *
 * This matters most where it is least visible: an approval. Approving against
 * a view that is minutes old is usually fine; approving against one that is
 * hours old may be acting on a question that has already been answered.
 */
import type { EpicAgentsState } from "@/epics/use-epic-agents";
import { relativeTime } from "@/fleet/fleet-grid";
import type { EpicConnectionState } from "./epic-status-row";

export interface EpicConnectionInput {
  readonly agents: EpicAgentsState;
  /** Injected, never `Date.now()` — the mapping must be testable at a fixed instant. */
  readonly now: number;
}

export function toEpicConnectionState(
  input: EpicConnectionInput,
): EpicConnectionState {
  const { agents, now } = input;
  if (agents.kind === "loading") return { kind: "loading" };
  if (agents.kind === "error") return { kind: "error" };
  if (agents.connected) return { kind: "live" };
  return { kind: "stale", ageLabel: relativeTime(agents.updatedAt, now) };
}
