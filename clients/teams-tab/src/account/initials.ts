/**
 * The two letters shown when a user has no avatar image.
 *
 * Pure and separate from the menu so the awkward cases are testable without a
 * render: this is the only part of the account surface with real branching,
 * and it is the part that produces something a user reads as their own name.
 *
 * Matches `clients/mobile/src/views/toolbar/account-sheet.tsx`'s
 * `computeInitials` behaviour deliberately — the same person should not get
 * different initials in the PWA and in Teams.
 *
 * `"?"` rather than `""` for the empty case: a blank circle reads as a
 * rendering failure, and the whole point of the fallback is to look
 * deliberate when the avatar is missing.
 */
export function computeInitials(
  name: string | null,
  email: string | null,
): string {
  const source = (name ?? email ?? "").trim();
  if (source.length === 0) return "?";
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  const second = parts[1];
  if (first !== undefined && second !== undefined) {
    return (first.slice(0, 1) + second.slice(0, 1)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/**
 * The line the account surface leads with.
 *
 * `"Signed in"` is the last resort and is a statement we can always make
 * truthfully — the menu only renders when the status is `signed-in`. Naming
 * the user is better; claiming a name we do not have is worse than saying
 * nothing.
 */
export function primaryIdentityLabel(
  name: string | null,
  email: string | null,
): string {
  return name ?? email ?? "Signed in";
}

/**
 * The subdued second line, or `null` when there is nothing to add.
 *
 * Returns `null` when the email IS the primary line, rather than printing it
 * twice — mobile makes the same call, and a row that repeats itself reads as
 * a bug in the identity plumbing rather than as a sparse profile.
 */
export function secondaryIdentityLabel(
  name: string | null,
  email: string | null,
): string | null {
  if (name === null) return null;
  return email;
}
