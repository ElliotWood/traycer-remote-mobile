/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed. Sibling of
 * `vite.config.web.ts`; same scope and same caveat.
 *
 * The phone's list of hosts it may talk to, in `localStorage`.
 *
 * Why localStorage and not a registry: there is no local host on a phone,
 * and `GET /api/v3/hosts` (the upstream registry route the desktop uses)
 * 404s in this deployment - the host responder is unbuilt. A user-entered
 * list is therefore the only real source, not a placeholder for one.
 *
 * ## Why the user must supply a host id
 *
 * This is the ugly part, and it is ugly for a measured reason rather than
 * an unexamined one. Nothing lets a client LEARN a host's id:
 *   - `openAck` carries `manifest` only - no identity.
 *   - `host.status` (the only floor method that reports anything about the
 *     box) returns `{ready, hostVersion, protocolVersion}` - no id.
 *   - the host serves no identity side-channel: `/activity` answers
 *     `{"busy":true}` and everything else 404s.
 *
 * And the id is not cosmetic - it keys `selectById`, and epic records carry
 * a `hostId` that must match a directory entry or the owning host cannot be
 * resolved. So a synthesised id would produce chats that no other client
 * can attribute. Typing it is the honest cost; the form says where to find
 * it (`~/.traycer/host/pid.json` on that machine).
 *
 * `version` is deliberately NOT stored or typed - it is measured by the
 * probe on every refresh, because a stored version goes stale silently.
 */

/** A host the user added by hand. The baked entry is not one of these. */
export interface StoredHost {
  readonly hostId: string;
  readonly label: string;
  readonly websocketUrl: string;
}

const STORAGE_KEY = "traycer.web.hosts.v1";

function isStoredHost(value: unknown): value is StoredHost {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.hostId === "string" &&
    record.hostId.length > 0 &&
    typeof record.label === "string" &&
    record.label.length > 0 &&
    typeof record.websocketUrl === "string" &&
    record.websocketUrl.length > 0
  );
}

/**
 * Reads the user-added hosts. A malformed or unreadable store yields `[]`
 * rather than throwing - the baked entry always remains, so a corrupted
 * list degrades to "the host that served this page" instead of a blank app.
 */
export function readStoredHosts(): readonly StoredHost[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredHost);
  } catch {
    return [];
  }
}

function writeStoredHosts(hosts: readonly StoredHost[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
  } catch {
    // Private-mode / quota failures are not worth crashing the app over;
    // the in-memory list for this session still reflects the change.
  }
}

export type AddHostResult =
  | { readonly kind: "added"; readonly hosts: readonly StoredHost[] }
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * Validates and appends a host. Rejects rather than silently normalising,
 * so a typo surfaces at the point of entry instead of as an unexplained
 * "Unreachable" badge later.
 *
 * `reservedHostIds` carries the baked entry's id: adding a second entry
 * with the same id would make `selectById` ambiguous.
 */
export function addStoredHost(
  input: {
    readonly hostId: string;
    readonly label: string;
    readonly websocketUrl: string;
  },
  reservedHostIds: readonly string[],
): AddHostResult {
  const hostId = input.hostId.trim();
  const label = input.label.trim();
  const websocketUrl = input.websocketUrl.trim();

  if (label.length === 0) {
    return { kind: "rejected", reason: "Give the host a name." };
  }
  if (hostId.length === 0) {
    return { kind: "rejected", reason: "Host id is required." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(websocketUrl);
  } catch {
    return { kind: "rejected", reason: "That is not a valid URL." };
  }
  if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
    return { kind: "rejected", reason: "URL must start with ws:// or wss://." };
  }
  // A page served over HTTPS cannot open a ws:// socket - the browser blocks
  // it as mixed content, and the failure surfaces as an unexplained
  // connection error much later. Say so here instead.
  if (
    parsedUrl.protocol === "ws:" &&
    globalThis.location.protocol === "https:"
  ) {
    return {
      kind: "rejected",
      reason:
        "This page is HTTPS, so it cannot dial a ws:// host. Use wss://, or open the app over http://localhost.",
    };
  }

  const existing = readStoredHosts();
  if (
    reservedHostIds.includes(hostId) ||
    existing.some((host) => host.hostId === hostId)
  ) {
    return {
      kind: "rejected",
      reason: "A host with that id is already listed.",
    };
  }

  const hosts = [...existing, { hostId, label, websocketUrl }];
  writeStoredHosts(hosts);
  return { kind: "added", hosts };
}

/**
 * Removes a user-added host. The baked entry is not in this store, so it
 * cannot be removed - by construction, not by a guard the caller has to
 * remember. That keeps the app from being locked out of the host that
 * served it.
 */
export function removeStoredHost(hostId: string): readonly StoredHost[] {
  const hosts = readStoredHosts().filter((host) => host.hostId !== hostId);
  writeStoredHosts(hosts);
  return hosts;
}
