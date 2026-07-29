/**
 * Canonical form accepted everywhere in the identity path (load, mint,
 * lookup): lowercase, hyphenated, RFC 4122 8-4-4-4-12. A value outside this
 * shape is refused, never transformed — normalizing at any boundary (e.g.
 * lowercasing at mint time) would reintroduce the case-collapse hazard this
 * registry's uniqueness rules are built to reject at load instead.
 */
const CANONICAL_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalGuid(value: string): boolean {
  return CANONICAL_GUID_PATTERN.test(value);
}
