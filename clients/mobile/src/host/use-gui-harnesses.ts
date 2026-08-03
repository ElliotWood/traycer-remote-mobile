/**
 * M1 — the harness catalogue behind the composer's harness picker, replacing
 * the `DEFAULT_HARNESS = "claude"` constant the composer used to hard-code.
 *
 * ## Why this re-fetches
 *
 * `availabilityPending` is true while the host's background availability probe
 * (a cold interactive-shell PATH probe) is still running, and the schema says
 * "the client re-fetches until it flips false" (`unary-schemas.ts:59-64`).
 *
 * Measured against a real host rather than assumed, because the schema's other
 * sentence turned out not to hold. It also claims "a pending row ALWAYS carries
 * `available: false`". On a cold read this host returned all 17 rows with
 * `availabilityPending: true` while several ALSO carried `available: true` —
 * the two are not mutually exclusive in practice. A subsequent call returned
 * every row settled (`pending: false`), so the state is genuinely transient and
 * re-fetching is the right response.
 *
 * The consequence for this hook, and the reason it does not simply trust the
 * documented invariant: availability is gated on `available && !pending`
 * EXPLICITLY. Relying on "pending implies not available" would show harnesses
 * as usable during the probe window on a host that behaves the way this one
 * actually does.
 *
 * Taking the ticket's "never shown as available" wording literally — hiding
 * every pending row — would leave the picker empty for the whole cold window,
 * which is why this reports the pending state to the caller instead of
 * silently rendering nothing.
 */
import { useEffect, useState } from "react";
import type { GuiHarnessOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { MobileHostClient } from "@/host/host-client-context";

export type GuiHarnessesPhase = "loading" | "loaded" | "error";

export interface UseGuiHarnessesResult {
  readonly phase: GuiHarnessesPhase;
  readonly harnesses: readonly GuiHarnessOption[];
  /** True while any row's availability probe is still running — the picker shows a "still checking" note rather than an empty list. */
  readonly probing: boolean;
}

/** How long to wait before re-asking while any row is still pending. */
const PENDING_REFETCH_MS = 2_000;
/**
 * Cap on re-fetches. A host whose probe never settles would otherwise poll for
 * the lifetime of the composer; after this the list is shown as-is and the
 * caller stops claiming a probe is in flight.
 */
const MAX_PENDING_REFETCHES = 8;

export function useGuiHarnesses(
  client: MobileHostClient | null,
): UseGuiHarnessesResult {
  const [phase, setPhase] = useState<GuiHarnessesPhase>("loading");
  const [harnesses, setHarnesses] = useState<readonly GuiHarnessOption[]>([]);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (client === null) {
      setPhase("error");
      return;
    }
    let cancelled = false;
    // `window.setTimeout` (not the bare global) so the handle is a plain
    // `number` rather than Node's `Timeout` object — same convention as
    // `first-turn-fallback.ts`.
    let timer: number | null = null;
    setPhase("loading");

    const fetchOnce = async (attempt: number): Promise<void> => {
      try {
        const response = await client.request("agent.gui.listHarnesses", {});
        if (cancelled) return;
        setHarnesses(response.harnesses);
        setPhase("loaded");
        const stillPending = response.harnesses.some(
          (h) => h.availabilityPending,
        );
        setProbing(stillPending && attempt < MAX_PENDING_REFETCHES);
        if (stillPending && attempt < MAX_PENDING_REFETCHES) {
          timer = window.setTimeout(() => {
            void fetchOnce(attempt + 1);
          }, PENDING_REFETCH_MS);
        }
      } catch {
        if (cancelled) return;
        setProbing(false);
        setPhase("error");
      }
    };

    void fetchOnce(0);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [client]);

  return { phase, harnesses, probing };
}

/**
 * The harnesses worth offering: enabled, probe finished, and actually
 * available.
 *
 * `available && !availabilityPending` is asserted explicitly rather than
 * leaning on the schema's claim that a pending row always reports
 * `available: false` — observed live to be untrue on a cold read. See this
 * module's docblock.
 */
export function selectableHarnesses(
  harnesses: readonly GuiHarnessOption[],
): readonly GuiHarnessOption[] {
  return harnesses.filter(
    (h) =>
      h.enabled &&
      h.available &&
      !h.availabilityPending &&
      h.modes.includes("gui"),
  );
}
