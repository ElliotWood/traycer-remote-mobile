/**
 * MOVED to `clients/shared/providers/provider-profile-model.ts` (M2 item 2).
 *
 * Relocated rather than forked because `profileCommitId()` is the ONLY thing
 * standing between a client and silently committing the reserved `"ambient"`
 * sentinel as a real profile id: `ChatRunSettings.profileId` is a bare
 * `z.string().nullable()` with no `.refine()`, so there is no schema rejection
 * to catch a mistake on that path. A fork of a guard whose backstop does not
 * exist diverges silently, on the wire, into a field that accepts anything.
 *
 * Re-exported here so gui-app's seventeen consumers are untouched.
 */
export * from "@traycer-clients/shared/providers/provider-profile-model";

/**
 * NOT moved with the rest of this module (M2 item 2): nothing in
 * `clients/shared` reads or produces an admission verdict, only gui-app's
 * dropdown/picker surfaces do. Left here rather than forced into shared for
 * symmetry with the exports above.
 *
 * A row-level admission verdict overlaid onto a profile row by a caller that
 * has its own reason to forbid picking a particular profile (e.g. the TUI
 * continue-under-another-profile dialog's bulk fork-admission preflight).
 * Independent of a profile's own auth status - `profileRowStatusSuffix`
 * still renders "Signed out"/"Unavailable" alongside a `disabled` row.
 */
export interface ProfileRowAdmission {
  readonly disabled: boolean;
  readonly reason: string | null;
}
