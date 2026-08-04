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
