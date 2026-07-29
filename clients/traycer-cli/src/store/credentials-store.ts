import {
  createCredentialsMutationStore,
  type CredentialsMutationStore,
} from "@traycer/protocol/config/credentials-mutation";
import { refreshOnceAbortable } from "../../../shared/auth/auth-validation";
import { config } from "../config";
import { effectiveAuthnBaseUrl } from "./credentials";
import { cliCredentialsPath } from "./paths";

/**
 * The CLI's handle onto the cross-process credentials mutation store (§2 / §7).
 * It is the CLI counterpart to the desktop `FileTokenStore`: every token *spend*
 * (`rotate`) runs inside the shared `${credentials}.lock` file lock, so a CLI
 * command and the desktop app can never double-spend a single-use refresh token.
 *
 * Distinct from `cli-lock.ts` (the host install/update/upgrade lock over a
 * SEPARATE `.lock` file) — the two never contend.
 *
 * Lifecycle: the CLI is a short-lived process. Create one store per command,
 * run the op through {@link withCommitRetry}, and `dispose()` before exit. The
 * store's background commit-failed retry timer would never fire in a process
 * that exits immediately, so `withCommitRetry` re-drives a `commit-failed`
 * synchronously instead (the plan's "a CLI command retries before exit").
 *
 * T0b (headless-client credentials store): `createStoreBackedRevalidator` and
 * `withCommitRetry` used to be defined here, but neither ever referenced
 * anything CLI-specific (no `config`, no `effectiveAuthnBaseUrl`) - proven by
 * this file's own pre-existing test, which exercises both against a fully
 * mocked `CredentialsMutationStore`. They moved verbatim to
 * `clients/shared/auth/host-credentials-store.ts` so a headless Node client
 * that is not the CLI (`clients/remote-bridge`, `remote-agent` next) can hold
 * the same locked, single-use-refresh-token-safe rotation without depending on
 * this CLI-private module - the wrong dependency direction, since the CLI
 * depends on `shared`, never the reverse. Re-exported below so every existing
 * import here keeps resolving unchanged; `createCliCredentialsStore` itself
 * stays in place (it reads CLI-specific `config.environment` / dev-desktop-slot
 * `effectiveAuthnBaseUrl` overrides that a plain headless client has no
 * equivalent of).
 */
export {
  createStoreBackedRevalidator,
  withCommitRetry,
} from "../../../shared/auth/host-credentials-store";

// Lock hold time includes at most one bounded in-lock refresh (~10s, see
// `refreshOnceAbortable`); the wait budget sits just above it so a competing
// mutation waits it out rather than failing (matches the desktop store).
const LOCK_WAIT_MS = 12_000;
const LOCK_POLL_INTERVAL_MS = 50;
const CONTINUATION_RETRY_MS = 1_000;

export function createCliCredentialsStore(): CredentialsMutationStore {
  const credentialsPath = cliCredentialsPath(config.environment);
  return createCredentialsMutationStore({
    paths: {
      credentialsPath,
      metaPath: `${credentialsPath}.meta.json`,
      lockPath: `${credentialsPath}.lock`,
    },
    // `rotate` refreshes against the file's stored `authnBaseUrl`. The shared
    // dev credentials file can carry a *sibling* dev-desktop run's authn URL
    // (its own local-stack port), so re-point the refresh at THIS run's
    // effective URL — the exact override `resolveHostAuth` applies to the initial
    // bearer. Production is a no-op (`effectiveAuthnBaseUrl` returns the stored
    // value when not inside a dev-desktop slot); the persisted pair keeps the raw
    // stored URL untouched (only this refresh call is re-pointed).
    refresh: (args) =>
      refreshOnceAbortable({
        ...args,
        authnBaseUrl: effectiveAuthnBaseUrl(args.authnBaseUrl),
      }),
    lockWaitMs: LOCK_WAIT_MS,
    lockPollIntervalMs: LOCK_POLL_INTERVAL_MS,
    continuationRetryMs: CONTINUATION_RETRY_MS,
  });
}

/**
 * Create a CLI credentials store, run `fn` against it, and dispose it — the
 * one-shot lifecycle for a short-lived command (`login`, `whoami`, `logout`).
 * `dispose` stops any `commit-failed` continuation timer `fn`'s mutations armed.
 * (host-rpc / monitor manage the store's lifetime themselves — the store must
 * outlive a single call there, so they don't use this wrapper.)
 */
export async function runWithCliStore<T>(
  fn: (store: CredentialsMutationStore) => Promise<T>,
): Promise<T> {
  const store = createCliCredentialsStore();
  try {
    return await fn(store);
  } finally {
    store.dispose();
  }
}
