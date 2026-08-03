/**
 * Reasoning-effort and service-tier selection rules for a GUI agent model.
 *
 * These are pure functions over PROTOCOL types (`GuiAgentModelOption` and its
 * option rows) — no React, no store, no client-specific state — and both the
 * desktop GUI and the mobile composer have to agree about them exactly. They
 * lived in `clients/gui-app/src/components/home/data/landing-options.ts` and
 * were moved here, unchanged, when the mobile composer gained the same
 * controls (M1). `landing-options.ts` re-exports them, so every existing
 * desktop consumer and its tests are unaffected.
 *
 * MOVED RATHER THAN COPIED, deliberately. The rule these encode is "what may
 * this model actually be sent" — if the two clients ever disagree about it,
 * one of them emits a value the host will not honour and records a setting the
 * turn never ran under. A fork guarantees that drift eventually; a shared
 * module makes it impossible. (Same reasoning the M2 ticket gives for the
 * rate-limit helpers, applied to the same class of problem.)
 *
 * Allowed dependencies: `@traycer/protocol` types only — browser-safe, and
 * imported by a React Native-free mobile bundle as well as Electron.
 */
import type {
  AgentReasoningEffortOption,
  AgentServiceTierOption,
  GuiAgentModelOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";

/**
 * Both of these are plain `string`, not unions: the option ids are supplied by
 * the HOST per model (`supportedReasoningEfforts[].id`), so there is no
 * closed set the client can enumerate ahead of time. `""` means "no selection"
 * — which is also what a model with no options normalizes to.
 */
export type ReasoningLevel = string;
export type ServiceTier = string;

const NO_REASONING_OPTIONS: ReadonlyArray<AgentReasoningEffortOption> = [];

export function findReasoningOptionsForModel(
  model: GuiAgentModelOption | null,
): ReadonlyArray<AgentReasoningEffortOption> {
  return model?.supportedReasoningEfforts ?? NO_REASONING_OPTIONS;
}

/**
 * Clamp a carried-over reasoning level to what THIS model supports.
 *
 * Order matters, and each branch is load-bearing:
 *   - `model === null` (catalog still resolving) passes the value through, so
 *     first paint never clobbers a sticky selection.
 *   - no options at all → `""`, which is how the caller knows to HIDE the
 *     control rather than show a stale value.
 *   - the value is still supported → keep it.
 *   - otherwise fall back to the model's declared default, but ONLY when that
 *     default is itself one of the options. Observed live: every Claude model
 *     on a real host reports `defaultReasoningEffort: null`, so this branch
 *     does not fire and the one below is what actually runs. A version of this
 *     that trusted the default unconditionally would emit `null`.
 *   - last resort, the first supported option.
 */
export function normalizeReasoningForModel(
  value: ReasoningLevel,
  model: GuiAgentModelOption | null,
): ReasoningLevel {
  if (model === null) return value;
  const options = findReasoningOptionsForModel(model);
  if (options.length === 0) return "";
  if (options.some((option) => option.id === value)) return value;
  const defaultReasoningEffort = model.defaultReasoningEffort;
  if (
    defaultReasoningEffort !== null &&
    options.some((option) => option.id === defaultReasoningEffort)
  ) {
    return defaultReasoningEffort;
  }
  return options[0]?.id ?? value;
}

export function findReasoningLabel(
  level: ReasoningLevel,
  options: ReadonlyArray<AgentReasoningEffortOption>,
): string {
  return options.find((option) => option.id === level)?.label ?? level;
}

/**
 * The model's UPGRADE tier — the one a "faster" toggle turns on.
 *
 * NOT `supportedServiceTiers[0]`. The upgrade is the first option that is not
 * the model's declared default; only when no default is declared does the
 * first option stand in. Assuming index 0 would record "Fast mode on" for a
 * model whose index 0 IS the ordinary tier.
 */
export function findUpgradeServiceTierForModel(
  model: GuiAgentModelOption | null,
): AgentServiceTierOption | null {
  if (model === null) return null;
  const options = model.supportedServiceTiers;
  if (options.length === 0) return null;
  const defaultId = model.defaultServiceTier;
  if (defaultId !== null) {
    const upgrade = options.find((option) => option.id !== defaultId);
    if (upgrade !== undefined) return upgrade;
  }
  return options[0] ?? null;
}

/**
 * The service-tier analogue of {@link normalizeReasoningForModel}: a tier
 * carried over from another model (Codex's `"priority"`, say) must never leak
 * onto a model whose only upgrade is different (Claude's `"fast"`), which
 * would otherwise record the wrong tier on the turn and persist one the model
 * never honoured.
 */
export function normalizeServiceTierForModel(
  value: ServiceTier,
  model: GuiAgentModelOption | null,
): ServiceTier {
  if (model === null) return value;
  const upgrade = findUpgradeServiceTierForModel(model);
  if (upgrade === null) return "";
  return value.trim() === upgrade.id ? upgrade.id : "";
}
