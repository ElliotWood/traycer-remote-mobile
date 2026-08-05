/**
 * The usage windows under a provider row — the parity contract's last 🔴,
 * "Usage / rate limits", against mobile's `toolbar/usage-sheet`.
 *
 * ## The blocker this row carried was real, and it was not the one on the label
 *
 * `settings-screen.tsx` deferred this row on the grounds that the arm
 * normalisation "has ALREADY been generalised into `clients/shared/rate-limits/`"
 * and only needed `traycer/mobile-v2-desktop-companion` to merge. That branch
 * has now merged, and it does NOT contain the function this row needs. What
 * moved to shared is gui-app's ENVELOPE projection (`projectProfileUsage`),
 * whose input is a `ProviderRateLimitEnvelope` — a structure nothing in
 * `clients/shared` can build, because the builder stayed in `clients/gui-app`
 * with the react-query cache it converges, deliberately and in writing.
 * Mobile's `extractUsageWindows` had never left `clients/mobile` at all.
 *
 * So the merge was necessary and not sufficient, and the extraction the tab
 * plan's decision 6 actually calls for is the one that has now happened:
 * `extractUsageWindows` moved to `@traycer-clients/shared/rate-limits/usage-windows`,
 * mobile re-exports it from its old path, and both clients render from one
 * copy. Recorded because "waiting on a branch" is a blocker that expires
 * silently — nothing would have told the next reader it had.
 *
 * ## Why per-profile, and why that is not a choice this screen gets to make
 *
 * One block PER PROFILE, never one for a guessed "active" one. Mobile's
 * `usage-sheet.tsx` carries the full argument (M2 item 1); the short version is
 * that `providerProfileSchema` has no `isActive`/`lastUsed` field, this surface
 * has no chat to read a committed selection from, and picking index 0 reports
 * another account's limits under this provider's name with no way to tell.
 * "The active profile" is not merely unknown on a provider-global screen — it
 * is undefined.
 *
 * ## Fluent, not mobile's markup
 *
 * Decision 1 of the tab plan: controls come from the host's design system, so
 * light/dark/high-contrast are correct by construction. `ProgressBar` is
 * Fluent's own meter and carries the `progressbar` role, its bounds and its
 * theming — mobile hand-builds the same thing from two divs because it has no
 * design system to ask. The SEMANTICS are mobile's, which is where parity
 * lives: same labels, same severity threshold, same reset phrasing, same
 * distinction between "no window concept" and "no live windows".
 */
import { useState, type ReactElement } from "react";
import {
  Caption1,
  ProgressBar,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ProviderId } from "@traycer/protocol/host/provider-schemas";
import {
  extractUsageWindows,
  formatResetLine,
  type UsageWindowRow,
} from "@traycer-clients/shared/rate-limits/usage-windows";
import {
  useRateLimitUsage,
  usageProfileId,
  type ProviderSummary,
  type RateLimitUsageState,
  type SettingsClient,
} from "./use-settings";

/**
 * The percentage at which a window is rendered as a problem rather than a
 * reading. Mobile's threshold, carried across as a named constant so the two
 * clients can be shown to agree by grep rather than by reading two renderers.
 */
export const SEVERE_USED_PERCENT = 90;

const useStyles = makeStyles({
  profileBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  profileLabel: { color: tokens.colorNeutralForeground3 },
  meter: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    paddingTop: tokens.spacingVerticalXXS,
  },
  meterHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

/**
 * Every profile's usage for one provider.
 *
 * A provider reporting NO profiles still gets one block, read with a `null`
 * profile — that is the pre-profile host shape, not an empty account list, and
 * skipping it would silently drop usage for exactly the older hosts most likely
 * to need reading.
 */
export function ProviderUsage({
  client,
  provider,
}: {
  readonly client: SettingsClient | null;
  readonly provider: ProviderSummary;
}): ReactElement {
  if (provider.profiles.length === 0) {
    return (
      <ProfileUsage
        client={client}
        providerId={provider.providerId}
        profileId={null}
        label={null}
      />
    );
  }
  return (
    <>
      {provider.profiles.map((profile) => (
        <ProfileUsage
          key={profile.profileId}
          client={client}
          providerId={provider.providerId}
          profileId={usageProfileId(profile)}
          // Labelled only when there is something to distinguish. A lone
          // profile needs no name; two or more always do, or a reading is
          // unattributable.
          label={
            provider.profiles.length > 1
              ? profile.kind === "ambient"
                ? `${profile.label} · signed in on this machine`
                : profile.label
              : null
          }
        />
      ))}
    </>
  );
}

/**
 * One profile's usage. Its own component because `useRateLimitUsage` is a hook
 * — the per-profile fetch cannot be looped inside the parent.
 */
function ProfileUsage({
  client,
  providerId,
  profileId,
  label,
}: {
  readonly client: SettingsClient | null;
  readonly providerId: ProviderId;
  readonly profileId: string | null;
  readonly label: string | null;
}): ReactElement {
  const styles = useStyles();
  const state = useRateLimitUsage(client, providerId, profileId);
  return (
    <div className={styles.profileBlock}>
      {label === null ? null : (
        <Caption1 className={styles.profileLabel}>{label}</Caption1>
      )}
      <UsageBody state={state} />
    </div>
  );
}

function UsageBody({
  state,
}: {
  readonly state: RateLimitUsageState;
}): ReactElement {
  const styles = useStyles();
  if (state.kind === "loading") {
    return <Caption1 className={styles.muted}>Loading usage…</Caption1>;
  }
  if (state.kind === "error") {
    return <Caption1 className={styles.muted}>{state.detail}</Caption1>;
  }
  const { rateLimits } = state;
  if (!rateLimits.available) {
    // The host's own reason token, de-snaked. Mobile shows the same string;
    // inventing prose for each member would drift the moment the protocol adds
    // one, and the tokens are self-describing ("cli_not_found").
    return (
      <Caption1 className={styles.muted}>
        {rateLimits.reason.replace(/_/g, " ")}
      </Caption1>
    );
  }

  const windows = extractUsageWindows(rateLimits);
  if (windows === null) {
    /*
     * THE DISTINCTION THIS BRANCH EXISTS FOR. `null` means the arm has no
     * window concept at all (openrouter, kilocode report credit balances), so
     * there is nothing here that a percentage would be true of. `[]` below
     * means the arm HAS windows and none are currently live. Rendering both as
     * "no usage windows" would tell a credits user their windows had emptied.
     */
    return (
      <Caption1 className={styles.muted}>
        No usage-window data for this provider.
      </Caption1>
    );
  }
  if (windows.length === 0) {
    return <Caption1 className={styles.muted}>No active usage windows.</Caption1>;
  }
  return (
    <>
      {windows.map((row, index) => (
        <UsageWindowMeter key={`${row.label}:${index}`} row={row} />
      ))}
    </>
  );
}

function UsageWindowMeter({
  row,
}: {
  readonly row: UsageWindowRow;
}): ReactElement {
  const styles = useStyles();
  /*
   * The clock is read ONCE per mount, in a lazy initialiser, not during
   * render — `react-hooks/purity` correctly flags `Date.now()` called
   * directly in the render body, since a "Resets in 42m" label recomputed on
   * every incidental re-render is unstable output. Mirrors mobile's
   * `UsageWindowMeter` (`views/toolbar/usage-sheet.tsx`), which hit the same
   * rule for the same reason.
   */
  const [now] = useState(() => Date.now());
  const percent = Math.max(0, Math.min(100, Math.round(row.window.usedPercent)));
  const reset = formatResetLine(row.window.resetsAt, now);
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <Caption1>{row.label}</Caption1>
        <Caption1>
          {percent}% used
          {reset === "" ? "" : ` · ${reset}`}
        </Caption1>
      </div>
      {/*
        `value` is 0–1, not 0–100 — Fluent's own scale. The accessible name
        carries the WINDOW, because a screen-reader user meeting four bars in a
        row gets "75%" four times otherwise, with nothing to attach it to.
      */}
      <ProgressBar
        value={percent / 100}
        thickness="medium"
        color={percent >= SEVERE_USED_PERCENT ? "error" : "brand"}
        aria-label={`${row.label}: ${percent}% used`}
      />
    </div>
  );
}
