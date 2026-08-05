/**
 * M2 item 2 — which account this chat's turns spend.
 *
 * The composer committed `profileId: null` unconditionally, so a user with two
 * subscriptions on one provider had no way to say which one a turn should run
 * under, and no way to see which one it did.
 *
 * ## The ambient sentinel, and why this is the only thing guarding it
 *
 * `providers.list` keys its ambient row by the literal string `"ambient"`.
 * `ChatRunSettings.profileId` is a bare `z.string().nullable()` — **no
 * `.refine()`, no rejection** — so committing `profile.profileId` verbatim
 * would send that reserved sentinel as a real profile id and the protocol
 * would accept it silently. (The M2 ticket claimed a schema refine catches
 * this; the refine it names is on `agent.create`'s `profileSelection`, a
 * different path.)
 *
 * So every commit goes through `profileCommitId()` — ambient becomes `null`,
 * managed profiles keep their id. It is shared with gui-app rather than
 * reimplemented precisely because there is no backstop to catch a divergence.
 *
 * ## Which provider's profiles
 *
 * Follows the composer's selected harness via `guiHarnessIdToProviderId`. A
 * harness with no provider-CLI concept (`traycer`) maps to `null` and the chip
 * renders nothing rather than guessing.
 *
 * ## Not in this component
 *
 * The rate-limit banner, switch-to prompt and "no other profile available"
 * terminal state are item 3. This deliberately does NOT rank profiles by
 * health: ranking requires `assessProfileRateLimit` (where unknown is
 * incomparable), and using the warning-side read for it is the confidently-
 * wrong failure M2 exists to fix.
 */
import { useMemo, useState, type ReactElement } from "react";
import { Check, ChevronDown, UserRound } from "lucide-react";
import type { GuiHarnessId } from "@traycer/protocol/host/agent/shared";
import type { ProviderProfile } from "@traycer/protocol/host/provider-schemas";
import {
  orderProfiles,
  profileCommitId,
  profileDisplayLabel,
  profileRowStatusSuffix,
} from "@traycer-clients/shared/providers/provider-profile-model";
import { guiHarnessIdToProviderId } from "@traycer-clients/shared/providers/provider-ordering";
import type { MobileHostClient } from "@/host/host-client-context";
import { useProviders } from "@/host/use-provider-usage";
import { BottomSheet } from "@/views/toolbar/bottom-sheet";
import { chipStyle } from "@/views/chat/run-settings-controls";
import { radius, theme, type } from "@/views/design-tokens";

/**
 * The profile whose commit id is `selected`.
 *
 * Compared on the COMMIT id, not `profileId`: the committed value for ambient
 * is `null`, so matching on the wire id would never find the ambient row and
 * the chip would show nothing selected on the default.
 */
function findByCommitId(
  profiles: readonly ProviderProfile[],
  selected: string | null,
): ProviderProfile | null {
  return profiles.find((p) => profileCommitId(p) === selected) ?? null;
}

export function ProfileChip({
  client,
  harnessId,
  value,
  unknown,
  onChange,
  disabled,
}: {
  readonly client: MobileHostClient | null;
  readonly harnessId: GuiHarnessId;
  /** The committed `ChatRunSettings.profileId`: `null` is ambient, never the sentinel. */
  readonly value: string | null;
  /**
   * The chat's settings have not arrived. A SEPARATE flag rather than a null
   * `value`, because null already means AMBIENT here — collapsing the two would
   * make "we haven't been told" indistinguishable from a deliberate choice.
   */
  readonly unknown: boolean;
  readonly onChange: (profileId: string | null) => void;
  readonly disabled: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const { providers } = useProviders(client);
  const providerId = guiHarnessIdToProviderId(harnessId);

  const profiles = useMemo(() => {
    if (providerId === null) return [];
    const provider = providers.find((p) => p.providerId === providerId);
    return provider === undefined ? [] : orderProfiles(provider.profiles);
  }, [providers, providerId]);

  // Nothing at all while the chat's settings are unknown: the profile set is
  // scoped by `harnessId`, which pre-snapshot is the composer's DEFAULT rather
  // than this chat's — so both the account shown AND whether this control
  // should exist are guesses. It already hides itself below two profiles, so a
  // suppressed-value chip here could appear and then vanish.
  if (unknown) return null;

  // One profile is not a choice — showing a picker with a single row implies
  // an alternative exists. Zero means the provider has no profile concept.
  if (profiles.length < 2) return null;

  const selected = findByCommitId(profiles, value);

  return (
    <>
      <button
        type="button"
        aria-label="Account"
        disabled={disabled}
        onClick={() => setOpen(true)}
        style={chipStyle(disabled)}
      >
        <UserRound size={13} aria-hidden="true" />
        {selected === null ? "Account" : profileDisplayLabel(selected)}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <BottomSheet title="Account" onClose={() => setOpen(false)}>
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 8px" }}>
            Which subscription this agent&rsquo;s turns run on.
          </p>
          {profiles.map((profile) => {
            const commitId = profileCommitId(profile);
            const statusSuffix = profileRowStatusSuffix(profile);
            return (
              <button
                key={profile.profileId}
                type="button"
                aria-current={commitId === value}
                onClick={() => {
                  // `commitId`, NOT `profile.profileId` — see this module's
                  // docblock. Nothing downstream would reject the sentinel.
                  onChange(commitId);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 8px",
                  border: "none",
                  borderRadius: radius.md,
                  background: commitId === value ? theme.background : "transparent",
                  color: theme.text,
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>
                  {commitId === value && <Check size={14} aria-hidden="true" />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...type.bodySm, display: "block", color: theme.text }}>
                    {profileDisplayLabel(profile)}
                  </span>
                  {profile.kind === "ambient" && (
                    <span style={{ ...type.bodyXs, display: "block", color: theme.mutedText }}>
                      Signed in on this machine
                    </span>
                  )}
                  {statusSuffix !== null && (
                    <span style={{ ...type.bodyXs, display: "block", color: theme.danger }}>
                      {statusSuffix}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </BottomSheet>
      )}
    </>
  );
}
