import { useCallback } from "react";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type {
  ProviderId,
  ProviderProfile,
} from "@traycer/protocol/host/provider-schemas";
import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type { ModelOption } from "@/components/home/data/landing-options";
import { type HostRpcRegistry } from "@/lib/host";
import { useProvidersListForClient } from "@/hooks/providers/use-providers-list-query";
import { useRateLimitSwitchPromptDismissalsStore } from "@/stores/rate-limits/rate-limit-switch-prompt-dismissals-store";
import { profileCommitId } from "@/components/providers/provider-profile-model";
import {
  assessProfileRateLimit,
  effectiveProfileRateLimitSeverity,
  limitedFamiliesForCopy,
  matchingRateLimitScopes,
  rateLimitSeverityTier,
  type ProfileRateLimitSeverity,
} from "@/lib/rate-limits/rate-limit-scope-match";
import { providerCliIdForHarness } from "@/lib/provider-ordering";

export type { ProfileRateLimitSeverity };

export interface ProfileRateLimitDestination {
  readonly profile: ProviderProfile;
  /** Normalized for composer-selection semantics: `null` is the ambient
   * profile even though its wire id is the literal ambient sentinel. */
  readonly profileId: string | null;
  readonly selectable: boolean;
}

interface HiddenProfileRateLimitPrompt {
  readonly kind: "hidden";
  readonly dismiss: () => void;
}

interface VisibleProfileRateLimitPrompt {
  readonly kind: "visible";
  readonly warningKey: string;
  readonly providerId: ProviderId;
  readonly severity: ProfileRateLimitSeverity;
  /** Model families named by the limits behind this warning, for copy like
   * "running low on Fable usage". Empty when any triggering limit is shared
   * (or per-scope data is unavailable) - the warning is then profile-wide and
   * the generic copy applies. */
  readonly limitedFamilies: ReadonlyArray<string>;
  readonly current: ProviderProfile;
  readonly profiles: ReadonlyArray<ProviderProfile>;
  /** Every other provider profile in the host's stable order. Rows that
   * are unavailable for switching stay here so the menu can explain why. */
  readonly destinations: ReadonlyArray<ProfileRateLimitDestination>;
  /** First selectable destination in provider order. Usage is never used
   * to rank this default action. */
  readonly primaryTarget: ProfileRateLimitDestination | null;
  /** Set only when `primaryTarget` is null: the first authenticated
   * destination with UNKNOWN rate-limit state, for the banner's single
   * automatic `ensureFresh` check. See `findProbeTarget`. */
  readonly probeTarget: ProfileRateLimitDestination | null;
  readonly dismiss: () => void;
}

export type ProfileRateLimitSwitchPrompt =
  HiddenProfileRateLimitPrompt | VisibleProfileRateLimitPrompt;

interface ProfileRateLimitWarningProjection {
  readonly warningKey: string;
  readonly providerId: ProviderId;
  readonly severity: ProfileRateLimitSeverity;
  readonly limitedFamilies: ReadonlyArray<string>;
  readonly current: ProviderProfile;
  readonly profiles: ReadonlyArray<ProviderProfile>;
  readonly destinations: ReadonlyArray<ProfileRateLimitDestination>;
  readonly primaryTarget: ProfileRateLimitDestination | null;
  readonly probeTarget: ProfileRateLimitDestination | null;
}

const NO_PROFILES: ReadonlyArray<ProviderProfile> = [];
function noop(): void {}

function hiddenPrompt(): HiddenProfileRateLimitPrompt {
  return { kind: "hidden", dismiss: noop };
}

function findLimitedProfile(
  profiles: ReadonlyArray<ProviderProfile>,
  profileId: string | null,
  selectedModel: ModelOption | null,
): {
  readonly current: ProviderProfile;
  readonly severity: ProfileRateLimitSeverity;
} | null {
  if (profiles.length < 2) return null;
  const current = profiles.find(
    (profile) => profileCommitId(profile) === profileId,
  );
  if (current === undefined) return null;
  const severity = effectiveProfileRateLimitSeverity(current, selectedModel);
  return severity === null ? null : { current, severity };
}

/**
 * A destination is worth suggesting only when its rate-limit state is KNOWN
 * and, for the selected model, sits in a strictly better tier than the
 * limited current profile (not limited < near_limit < hard_limit) -
 * same-or-worse is no escape. A destination that is limited only on a family
 * the selected model doesn't use stays selectable. Unknown (never read,
 * stale, or failed-probe gauge) is incomparable, NOT weakly healthy: absence
 * of evidence must never power the confident one-click switch, no matter how
 * limited the current profile is. Unknown candidates are instead surfaced
 * through `probeTarget` for a single automatic freshness check.
 */
function selectableDestination(
  profile: ProviderProfile,
  selectedModel: ModelOption | null,
  currentSeverity: ProfileRateLimitSeverity,
): boolean {
  const assessment = assessProfileRateLimit(profile, selectedModel);
  return (
    profile.auth.status === "authenticated" &&
    assessment.known &&
    rateLimitSeverityTier(assessment.severity) <
      rateLimitSeverityTier(currentSeverity)
  );
}

/**
 * The one destination worth spending an automatic usage check on: the first
 * authenticated profile whose rate-limit state is unknown, and only when no
 * known strictly-better destination already exists. The banner fires a
 * single non-forced (`ensureFresh`) check for it; a successful reading
 * lands in the gauge and the next `providers.list` snapshot promotes it to
 * `primaryTarget` through the normal projection. Never a cascade - one
 * candidate, one attempt.
 */
function findProbeTarget(
  destinations: ReadonlyArray<ProfileRateLimitDestination>,
  selectedModel: ModelOption | null,
): ProfileRateLimitDestination | null {
  return (
    destinations.find(
      (destination) =>
        destination.profile.auth.status === "authenticated" &&
        !assessProfileRateLimit(destination.profile, selectedModel).known,
    ) ?? null
  );
}

function destinationsForLimitedProfile(
  profiles: ReadonlyArray<ProviderProfile>,
  current: ProviderProfile,
  selectedModel: ModelOption | null,
  currentSeverity: ProfileRateLimitSeverity,
): ReadonlyArray<ProfileRateLimitDestination> {
  return profiles
    .filter((profile) => profile.profileId !== current.profileId)
    .map((profile) => ({
      profile,
      profileId: profileCommitId(profile),
      selectable: selectableDestination(
        profile,
        selectedModel,
        currentSeverity,
      ),
    }));
}

/**
 * `limitedFamiliesForCopy` used to live here. It MOVED to
 * `clients/shared/rate-limits/` alongside the severity rules it belongs with:
 * mobile re-derived these two rules by hand and got both wrong, which is the
 * drift the M2 item 5 relocation exists to prevent — the rule had simply been
 * left behind when its neighbours moved. Imported below; nothing renamed.
 */

function warningProjection(input: {
  readonly harnessId: GuiHarnessId;
  readonly providerId: ProviderId | null;
  readonly profiles: ReadonlyArray<ProviderProfile>;
  readonly profileId: string | null;
  readonly selectedModel: ModelOption | null;
}): ProfileRateLimitWarningProjection | null {
  if (input.providerId === null) return null;
  const limited = findLimitedProfile(
    input.profiles,
    input.profileId,
    input.selectedModel,
  );
  if (limited === null) return null;
  const destinations = destinationsForLimitedProfile(
    input.profiles,
    limited.current,
    input.selectedModel,
    limited.severity,
  );
  const primaryTarget =
    destinations.find((destination) => destination.selectable) ?? null;
  const probeTarget =
    primaryTarget === null
      ? findProbeTarget(destinations, input.selectedModel)
      : null;
  const matchingScopes = matchingRateLimitScopes(
    limited.current,
    input.selectedModel,
  );
  return {
    warningKey: JSON.stringify([
      input.harnessId,
      limited.current.profileId,
      limited.severity,
      // Scope identity: dismissing a "Fable is running low" warning must not
      // suppress a later shared-window warning (and vice versa), moving the
      // composer to a model gated by different scopes re-evaluates the
      // dismissal, and each scope carries its severity so a hard limit moving
      // between the same families resurfaces too. `null` = no per-scope data
      // (profile-level fallback).
      matchingScopes === null
        ? null
        : matchingScopes
            .map((scope) => `${scope.family ?? ""}\u0000${scope.severity}`)
            .toSorted(),
      destinations
        .filter((destination) => destination.selectable)
        .map((destination) => destination.profile.profileId)
        .toSorted(),
    ]),
    providerId: input.providerId,
    severity: limited.severity,
    limitedFamilies: limitedFamiliesForCopy(
      limited.current,
      input.selectedModel,
      limited.severity,
    ),
    current: limited.current,
    profiles: input.profiles,
    destinations,
    primaryTarget,
    probeTarget,
  };
}

/**
 * Composer-facing rate-limit warning projection. Its eligibility comes only
 * from the subscribed `providers.list` snapshot of `client`'s host; detailed
 * usage is a separate, cache-only presentation concern in the banner.
 * Eligibility is scoped to the composer's selected model: a limit that only
 * gates another model family (per `rateLimitLimitedScopes`) neither shows the
 * warning nor disqualifies a destination. When per-scope data is unavailable
 * (old host, never-read gauge, unresolved model) it falls back to the
 * profile-level enum - every uncertain path shows the warning rather than
 * hiding a real one. The visible state deliberately remains representable
 * with no selectable alternative so the user can inspect profile limits
 * instead of losing the warning entirely.
 *
 * `client` is caller-resolved rather than looked up internally, so each
 * surface can scope the read to the host it actually cares about (e.g. the
 * chat composer's tab host vs. a future landing composer's default host) -
 * mirrors `useResolvedSeededProfileId`'s identical `client` parameter.
 */
export function useProfileRateLimitSwitchPrompt(input: {
  readonly harnessId: GuiHarnessId;
  readonly profileId: string | null;
  readonly selectedModel: ModelOption | null;
  readonly active: boolean;
  readonly client: HostClient<HostRpcRegistry> | null;
}): ProfileRateLimitSwitchPrompt {
  const { harnessId, profileId, selectedModel, active, client } = input;
  const dismissPromptKey = useRateLimitSwitchPromptDismissalsStore(
    (state) => state.dismiss,
  );
  const providerId = providerCliIdForHarness(harnessId);
  const enabled = active && providerId !== null;
  const query = useProvidersListForClient(client, {
    enabled,
    subscribed: enabled,
  });
  const profiles: ReadonlyArray<ProviderProfile> =
    query.data?.providers.find((provider) => provider.providerId === providerId)
      ?.profiles ?? NO_PROFILES;
  const projection = warningProjection({
    harnessId,
    providerId,
    profiles,
    profileId,
    selectedModel,
  });
  const dismissed = useRateLimitSwitchPromptDismissalsStore(
    (state) =>
      projection !== null && state.dismissedKeys.has(projection.warningKey),
  );
  const dismiss = useCallback((): void => {
    if (projection !== null) dismissPromptKey(projection.warningKey);
  }, [dismissPromptKey, projection]);

  if (projection === null || dismissed) return hiddenPrompt();

  return {
    kind: "visible",
    ...projection,
    dismiss,
  };
}
