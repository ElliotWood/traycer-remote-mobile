import { readCredentialsFile } from "@traycer/protocol/config/credentials";
import { cliCredentialsPath } from "@traycer/protocol/config/paths";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";

/**
 * Reads the bearer from `~/.traycer/cli/credentials` — the same file
 * `traycer login` writes and the Desktop/CLI read, per the brief.
 *
 * ESCALATED GAP (not faked around): the brief's prior art also names
 * `createCliCredentialsStore()` + `createStoreBackedRevalidator(...)` for
 * refresh-on-401. Both live ONLY in `clients/traycer-cli/src/store/
 * credentials-store.ts` — a CLI-private module (no `exports` for library
 * use), not `clients/shared`. This package must not depend on
 * `clients/traycer-cli` (wrong direction: the CLI depends on `shared`,
 * never the reverse, and its build bundles `shared` in on the assumption
 * nothing outside it does the same to the CLI). So the bridge CANNOT
 * perform the locked, single-use-refresh-token-safe rotation the CLI does
 * — reimplementing that WAL/lock logic a second time, un-audited, risks
 * corrupting the one credentials file every Traycer surface on this
 * machine shares.
 *
 * What this module does instead: on a host `UNAUTHORIZED`, re-read the
 * credentials file from disk. If ANOTHER process (the CLI, the Desktop)
 * has since rotated it, the bridge picks up the fresh token for free — the
 * file is the shared source of truth regardless of who wrote it. If the
 * token is unchanged, the bridge cannot self-refresh and reports that
 * plainly rather than spinning or faking a rotation. A long-running bridge
 * therefore depends on SOME other Traycer surface staying alive to keep the
 * token fresh past its ~4h TTL — worth fixing by extracting the locked
 * store into `clients/shared` in a follow-up, not by duplicating it here.
 */
export interface HostAuth {
  readonly lease: MutableBearerLease;
  /** Re-reads the credentials file. Never rotates anything itself. */
  revalidate(): Promise<"rotated" | "unchanged" | "signed-out">;
}

export async function resolveHostAuth(): Promise<HostAuth | null> {
  const stored = await readCredentialsFile(cliCredentialsPath("production"));
  if (stored === null || stored.token.length === 0) return null;
  const lease = new MutableBearerLease(stored.token, stored.user.id);
  let lastKnownToken = stored.token;
  return {
    lease,
    revalidate: async () => {
      const fresh = await readCredentialsFile(cliCredentialsPath("production"));
      if (fresh === null || fresh.token.length === 0) return "signed-out";
      if (fresh.token === lastKnownToken) return "unchanged";
      lastKnownToken = fresh.token;
      lease.rotate(fresh.token);
      return "rotated";
    },
  };
}
