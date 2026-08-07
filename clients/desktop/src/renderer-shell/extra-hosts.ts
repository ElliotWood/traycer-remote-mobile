import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";

/**
 * Extra hosts supplied at launch rather than in source, so an endpoint never
 * lands in a tracked file.
 *
 * `HostDirectoryService.refresh()` assigns whatever the remote fetcher returns
 * straight to `remoteEntries` - no validation, no kind coercion - and
 * `snapshot()` concatenates it after the local entry. Nothing between here and
 * the socket re-checks these values, so this function is the only place they
 * can be rejected.
 *
 * Why entries are `kind: "local"`, and why that is not a lie
 *   `WsRpcClient` dials `webSocketFactory.create(selected.websocketUrl)`
 *   verbatim (`ws-rpc-client.ts:189`); `WsStreamClient` does the same via
 *   `toStreamDialUrl` (`ws-stream-client.ts:704`). Neither consults `kind`.
 *   The `127.0.0.1` constraint people expect here lives in
 *   `isCurrentHostWebsocketUrl`, whose only two callers are in
 *   `electron-main/host/` and both read a `LocalHostSnapshot` - the bundled
 *   host's own `pid.json`. A directory entry never reaches it. Verify with:
 *     grep -rn "isCurrentHostWebsocketUrl" clients --include=*.ts
 *   So `kind` here selects a dial strategy, not a network location, and
 *   "local" is the strategy that means "dial this url as given".
 *
 * The local host still wins
 *   `getDefaultEntry()` returns `localEntry` whenever one exists, so on
 *   desktop these entries are strictly additive: they appear in the picker and
 *   are never auto-selected. An entry reusing the bundled host's `hostId` is
 *   shadowed by it in `findById` and would be an unselectable duplicate row -
 *   that collision cannot be detected here, since the local id is not known
 *   until the runner host emits its first snapshot.
 *
 * Availability is asserted, not probed
 *   `status: "available"` matches what `toLocalEntry` hardcodes for the local
 *   host. It means "configured", not "reachable" - an unreachable entry looks
 *   identical until a dial fails.
 */
export const EXTRA_HOSTS_ENV_VAR = "VITE_DESKTOP_EXTRA_HOSTS";

/** Only these two schemes are dialable; anything else fails at the socket. */
const DIALABLE_PROTOCOLS = new Set(["ws:", "wss:"]);

function isDialableWebsocketUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return DIALABLE_PROTOCOLS.has(parsed.protocol);
}

function toEntry(item: unknown): HostDirectoryEntry | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const record = item as Record<string, unknown>;
  const { hostId, websocketUrl, label, version } = record;

  // An empty id is worse than a missing one: it produces a picker row that
  // `findById("")` can never resolve back to.
  if (typeof hostId !== "string" || hostId.trim().length === 0) {
    return null;
  }
  if (typeof websocketUrl !== "string" || !isDialableWebsocketUrl(websocketUrl)) {
    return null;
  }

  return {
    hostId,
    label:
      typeof label === "string" && label.trim().length > 0 ? label : hostId,
    kind: "local",
    websocketUrl,
    version: typeof version === "string" ? version : null,
    status: "available",
  };
}

/**
 * Parses the launch-time host list. Returns `[]` for every malformed input
 * rather than throwing: this runs inside `HostDirectoryService.start()`, where
 * a throw would abort the initial refresh and leave the app with no directory
 * at all. A bad entry costs you that entry; it never costs you the app.
 *
 * Entries are deduplicated by `hostId`, first occurrence winning, so a
 * duplicated id cannot produce two picker rows that resolve to one host.
 */
export function parseExtraHosts(raw: unknown): readonly HostDirectoryEntry[] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const entries: HostDirectoryEntry[] = [];
  for (const item of parsed) {
    const entry = toEntry(item);
    if (entry === null) {
      continue;
    }
    if (seen.has(entry.hostId)) {
      continue;
    }
    seen.add(entry.hostId);
    entries.push(entry);
  }
  return entries;
}

/**
 * The `RemoteHostFetcher` handed to `TraycerApp`. Reads the env var once per
 * call so a refresh picks up nothing new - the value is baked in at build
 * time by Vite, which is the point: it is configuration, not discovery.
 */
export function createExtraHostsFetcher(
  raw: unknown,
): () => Promise<readonly HostDirectoryEntry[]> {
  return () => Promise.resolve(parseExtraHosts(raw));
}
