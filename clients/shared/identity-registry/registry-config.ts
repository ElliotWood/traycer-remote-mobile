import { z } from "zod";
import { isCanonicalGuid } from "./guid";
import type {
  MappedAadObjectId,
  MappedTraycerUserId,
  TenantMapping,
} from "./types";

/**
 * `hostId` is this registry's stable, opaque public identifier for a
 * tenant — consumed downstream by A4's `<identity>/<chat-id>` branch
 * naming, via `resolveIdentity(hostId)` for the branch->tenant direction.
 * Deliberately NOT the `entraOid`: a Microsoft-issued, cross-system
 * identifier permanently encoded into a shared repository's branch history
 * is a wider correlation surface than an id with no meaning outside this
 * deployment, and it isn't guaranteed to fit a repo-safe character class in
 * the first place. Enforced at load, not by convention, so "safe to expose
 * in a git branch name" is structural rather than trusted to A1's
 * hostId-assignment scheme.
 *
 * LOCALE HAZARD FOR DOWNSTREAM SHELL CONSUMERS: this check is JavaScript's
 * `RegExp`, which is code-point-based — `[a-z]` matches ONLY lowercase
 * ASCII, always, regardless of environment. A shell-side re-check of the
 * same-looking pattern (bash `[[ =~ ]]`, POSIX `[[:lower:]]`) is glibc
 * COLLATION-based: under a UTF-8 locale (the normal case on the Linux
 * target), `[a-z]` interleaves case and matches `"ALICE"` as well as
 * `"alice"`. The two checks silently diverge exactly when someone tests an
 * uppercase value — both layers' own tests pass, and the disagreement is
 * invisible until then. Any shell consumer intending to re-verify (rather
 * than trust) this registry's guarantee MUST force `LC_ALL=C` first, or it
 * is enforcing a materially weaker rule while believing it matches this
 * one. This registry's own enforcement needs no change — because it never
 * ACCEPTS a non-lowercase `hostId` in the first place (refuse, not
 * normalize), a downstream consumer with a broken locale check is still
 * only ever handed an already-lowercase value: defense that doesn't depend
 * on the other layer getting it right.
 */
const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * On-disk config shape only — deliberately loose (`z.string()`, not a GUID
 * regex) at the schema layer, because every semantic rule below (canonical
 * shape, no whitespace, uniqueness) needs its own refusal reason and must
 * run in a fixed order so the FIRST violation found is always what's
 * reported, not whichever zod happened to flag.
 */
const rawTenantEntrySchema = z.object({
  home: z.string(),
  hostId: z.string(),
  entraOid: z.string().nullable().optional(),
  traycerUserId: z.string().nullable().optional(),
});

const rawRegistryConfigSchema = z.object({
  tenants: z.array(rawTenantEntrySchema),
});

export type RegistryLoadResult =
  | { readonly kind: "loaded"; readonly tenants: readonly TenantMapping[] }
  | { readonly kind: "refused"; readonly reason: string };

/** No trimming anywhere in the identity path — a value that needs trimming is refused, not silently corrected. */
function isCleanNonEmpty(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

/**
 * Fail-closed, load-time validation for the identity registry's config.
 * Every branch below refuses rather than tolerates: this file only ever
 * returns `"loaded"` for a config that is internally consistent AND
 * unambiguous. An empty registry, a malformed shape, a duplicate alias, or
 * a non-canonical GUID all refuse — there is no partial-load, no
 * skip-the-bad-entry-and-continue, and no first-configured-tenant
 * fallback. See `registry.ts`'s module doc for why a human is represented
 * by exactly one `TenantMapping`, never one row per alias.
 */
export function loadRegistryConfig(raw: unknown): RegistryLoadResult {
  const parsed = rawRegistryConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "refused",
      reason: `config does not match the expected shape: ${parsed.error.message}`,
    };
  }

  const rawTenants = parsed.data.tenants;
  if (rawTenants.length === 0) {
    return {
      kind: "refused",
      reason:
        "registry is empty — refusing to load rather than let every principal through unmapped",
    };
  }

  /**
   * `home` uniqueness is checked CASE-INSENSITIVELY, unlike every other
   * alias in this file — deliberate asymmetry, not an inconsistency to
   * "fix". Identities are compared exactly because they're strings; `home`
   * is a filesystem path, and NTFS (and default macOS) resolve
   * `/srv/traycer/alice` and `/srv/traycer/Alice` to the SAME directory —
   * one credentials file, one owner binding, two tenants silently sharing
   * it. Rejecting the collision fails closed on every platform. Target
   * deployment is Linux, where the two paths genuinely would be distinct,
   * so this guards against a config typo and against a `USERPROFILE`
   * (Windows) path A1 may one day set, not a claim about today's
   * production filesystem.
   */
  const seenHomeLowercase = new Set<string>();
  const seenHostId = new Set<string>();
  const seenEntraOid = new Set<string>();
  const seenTraycerUserId = new Set<string>();
  const tenants: TenantMapping[] = [];

  for (let index = 0; index < rawTenants.length; index += 1) {
    const entry = rawTenants[index];
    const { home, hostId } = entry;
    const entraOid = entry.entraOid ?? null;
    const traycerUserId = entry.traycerUserId ?? null;

    if (!isCleanNonEmpty(home)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].home is empty or has leading/trailing whitespace`,
      };
    }
    if (!isCleanNonEmpty(hostId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].hostId is empty or has leading/trailing whitespace`,
      };
    }
    if (!HOST_ID_PATTERN.test(hostId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].hostId must match ${HOST_ID_PATTERN.source} — it is exposed downstream as a git branch name segment`,
      };
    }
    if (entraOid !== null && !isCleanNonEmpty(entraOid)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].entraOid is empty or has leading/trailing whitespace`,
      };
    }
    if (traycerUserId !== null && !isCleanNonEmpty(traycerUserId)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].traycerUserId is empty or has leading/trailing whitespace`,
      };
    }
    if (entraOid === null && traycerUserId === null) {
      return {
        kind: "refused",
        reason: `tenant[${index}] has neither entraOid nor traycerUserId — an entry must carry at least one alias`,
      };
    }
    if (entraOid !== null && !isCanonicalGuid(entraOid)) {
      return {
        kind: "refused",
        reason: `tenant[${index}].entraOid is not a canonical lowercase GUID`,
      };
    }

    if (seenHomeLowercase.has(home.toLowerCase())) {
      return {
        kind: "refused",
        reason: `duplicate home at tenant[${index}] (case-insensitive match) — refusing rather than silently merging two tenants onto one directory`,
      };
    }
    if (seenHostId.has(hostId)) {
      return {
        kind: "refused",
        reason: `duplicate hostId at tenant[${index}]`,
      };
    }
    if (entraOid !== null && seenEntraOid.has(entraOid)) {
      return {
        kind: "refused",
        reason: `duplicate entraOid at tenant[${index}] — the same alias cannot resolve to two tenants`,
      };
    }
    if (traycerUserId !== null && seenTraycerUserId.has(traycerUserId)) {
      return {
        kind: "refused",
        reason: `duplicate traycerUserId at tenant[${index}] — the same alias cannot resolve to two tenants`,
      };
    }

    seenHomeLowercase.add(home.toLowerCase());
    seenHostId.add(hostId);
    if (entraOid !== null) seenEntraOid.add(entraOid);
    if (traycerUserId !== null) seenTraycerUserId.add(traycerUserId);

    tenants.push({
      home,
      hostId,
      entraOid: entraOid === null ? null : (entraOid as MappedAadObjectId),
      traycerUserId:
        traycerUserId === null ? null : (traycerUserId as MappedTraycerUserId),
    });
  }

  return { kind: "loaded", tenants };
}
