import { readCredentialsFile } from "@traycer/protocol/config/credentials";
import { cliCredentialsPath } from "@traycer/protocol/config/paths";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import type { RevalidateOutcome } from "@traycer-clients/shared/auth/bearer-revalidator";
import {
  createHostCredentialsStore,
  createStoreBackedRevalidator,
} from "@traycer-clients/shared/auth/host-credentials-store";
import type { CredentialsMutationStore } from "@traycer/protocol/config/credentials-mutation";

/**
 * Reads the bearer from `~/.traycer/cli/credentials` — the same file
 * `traycer login` writes and the Desktop/CLI read — and holds the LOCKED,
 * single-use-refresh-token-safe rotation the brief's prior art named
 * (`createCliCredentialsStore` + `createStoreBackedRevalidator`, mirroring
 * `traycer monitor`'s wiring).
 *
 * T0b: this used to be impossible without depending on `clients/traycer-cli`
 * (the wrong dependency direction) — both functions lived ONLY in that
 * CLI-private module. They are now extracted, verbatim, into
 * `clients/shared/auth/host-credentials-store.ts` (see that file's docblock
 * for the full why and the CLI's unmodified test file as the fidelity
 * proof), so this bridge holds a REAL rotation capability, not merely a
 * read-only re-check of what some other process already did. That is what
 * makes the bridge a genuinely unattended process past the bearer's ~4h TTL
 * — an always-on channel bot's entire value proposition depends on this,
 * not on a Desktop/CLI staying open somewhere to keep refreshing for it.
 *
 * One store for the whole process lifetime (`dispose()` on shutdown) — the
 * store's background `commit-failed` continuation timer must survive across
 * calls, exactly like `traycer monitor`'s.
 */
export interface HostAuth {
  readonly lease: MutableBearerLease;
  /** The `user.id` this process resolved from its credentials file at startup — see `requireHomeEnv`'s docblock for why this identity is otherwise unverifiable from outside the process. */
  readonly userId: string;
  /** The `HOME` (`USERPROFILE` on Windows) this process resolved its identity from. */
  readonly home: string;
  /** Runs the locked rotate mutation. Never throws — every failure maps to an outcome. */
  revalidate(): Promise<RevalidateOutcome>;
  /** Stops the store's background continuation timer. Call once, on shutdown. */
  dispose(): void;
}

// `createStoreBackedRevalidator`'s return type is an intersection of
// `AuthRevalidator` (whose `revalidateCurrentContext` is deliberately
// `Promise<unknown>` - the unary auth-aware messenger ignores the value in
// favor of a before/after bearer comparison) with an object literal that
// separately declares the concrete `Promise<RevalidateOutcome>` signature.
// TypeScript does not merge those into the narrower type through the
// intersection, so callers that need the concrete outcome (this module,
// `traycer monitor`'s own `InboxRevalidator`) declare their own narrow local
// shape and let structural typing match it against the real returned object.
interface HostRevalidator {
  revalidateCurrentContext(): Promise<RevalidateOutcome>;
}

/**
 * Reads `$HOME` (`$USERPROFILE` on Windows) directly from the environment,
 * refusing `os.homedir()`'s fallback to the current OS user's home
 * directory (`getpwuid()` on POSIX when `HOME` is unset — Node's own
 * documented contract, see nodejs.org/api/os.html#oshomedir) when it is
 * absent. Every path this process resolves (`cliConfigDir()` →
 * `cliCredentialsPath()` → the credentials file, its lock, and its WAL
 * sidecar) is `join(homedir(), ...)` — see docs/multi-tenant-deployment.md.
 *
 * On a multi-tenant deployment where every bridge process shares ONE OS
 * user (separate `HOME`s only), that fallback is not a graceful default —
 * it is the exact mechanism that silently collapses every misconfigured
 * tenant onto whichever identity happens to own the shared account, with
 * no error and no signal that it happened. A missing `HOME` must fail
 * loudly, immediately, before this process reads or touches any
 * credentials — not silently proceed as an unintended identity.
 *
 * Deliberately strict, no escape hatch: this deployment has no legitimate
 * case where falling back to the OS user's home is the intended behavior,
 * only ways that fallback goes wrong, and an opt-out here would exist
 * purely to be reached for under incident pressure and never removed.
 */
export function requireHomeEnv(): string {
  const home =
    process.platform === "win32"
      ? (process.env.USERPROFILE ?? process.env.HOME)
      : process.env.HOME;
  if (home === undefined || home.length === 0) {
    throw new Error(
      "remote-bridge: HOME is not set in the environment (USERPROFILE on Windows). " +
        "Refusing to start: os.homedir()'s fallback to the current OS user's home " +
        "directory would let this process silently resolve another identity's " +
        "credentials on a multi-tenant deployment where every process shares one " +
        "OS user. Set HOME explicitly before launching this process - see " +
        "docs/multi-tenant-deployment.md.",
    );
  }
  return home;
}

export async function resolveHostAuth(): Promise<HostAuth | null> {
  const home = requireHomeEnv();
  const stored = await readCredentialsFile(cliCredentialsPath("production"));
  if (stored === null || stored.token.length === 0) return null;
  const lease = new MutableBearerLease(stored.token, stored.user.id);
  const store: CredentialsMutationStore = createHostCredentialsStore();
  const revalidator: HostRevalidator = createStoreBackedRevalidator({
    store,
    lease,
  });
  return {
    lease,
    userId: stored.user.id,
    home,
    revalidate: () => revalidator.revalidateCurrentContext(),
    dispose: () => store.dispose(),
  };
}
