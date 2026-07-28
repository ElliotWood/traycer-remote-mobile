import { readCredentialsFile } from "@traycer/protocol/config/credentials";
import { cliCredentialsPath, type Environment } from "@traycer/protocol/config/paths";
import {
  createCredentialsMutationStore,
  type CredentialsMutationStore,
  type MutationResult,
} from "@traycer/protocol/config/credentials-mutation";
import { refreshOnceAbortable } from "@traycer-clients/shared/auth/auth-validation";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import type { OpenFrameBearerSource } from "@traycer-clients/shared/auth/bearer-source";
import type {
  AuthorityBoundAuthRevalidator,
  RevalidateOutcome,
} from "@traycer-clients/shared/auth/bearer-revalidator";

/**
 * Push-service host auth, mirroring the CLI's own boundary
 * (`clients/traycer-cli/src/internal/host-auth.ts` + `store/credentials-store.ts`):
 * the push service reads the same `~/.traycer/cli/credentials` file the CLI
 * writes on `traycer login`, and refreshes through the same locked `rotate`
 * mutation so it can never double-spend a single-use refresh token
 * concurrently with the CLI or desktop.
 *
 * Reimplemented here (not imported from `clients/traycer-cli`) because that
 * package's `src/` is not a shared package boundary — only `@traycer/protocol`
 * and `@traycer-clients/shared` are. The push service is production-only, so
 * it always resolves the shared production credentials path with no
 * dev-desktop-slot indirection (unlike the CLI, which supports dev-slot
 * overrides for local development of the CLI itself).
 */
const ENVIRONMENT: Environment = "production";

export interface HostAuth {
  readonly token: string;
  readonly authnBaseUrl: string;
  readonly userId: string;
}

/** `null` when there is no signed-in session — the caller surfaces "not signed in" rather than dialing with an empty bearer. */
export async function resolveHostAuth(): Promise<HostAuth | null> {
  const stored = await readCredentialsFile(cliCredentialsPath(ENVIRONMENT));
  if (stored === null || stored.token.length === 0) return null;
  return {
    token: stored.token,
    authnBaseUrl: stored.authnBaseUrl,
    userId: stored.user.id,
  };
}

const LOCK_WAIT_MS = 12_000;
const LOCK_POLL_INTERVAL_MS = 50;
const CONTINUATION_RETRY_MS = 1_000;
const COMMIT_RETRY_ATTEMPTS = 3;

export function createPushServiceCredentialsStore(): CredentialsMutationStore {
  const credentialsPath = cliCredentialsPath(ENVIRONMENT);
  return createCredentialsMutationStore({
    paths: {
      credentialsPath,
      metaPath: `${credentialsPath}.meta.json`,
      lockPath: `${credentialsPath}.lock`,
    },
    refresh: (args) => refreshOnceAbortable(args),
    lockWaitMs: LOCK_WAIT_MS,
    lockPollIntervalMs: LOCK_POLL_INTERVAL_MS,
    continuationRetryMs: CONTINUATION_RETRY_MS,
  });
}

async function withCommitRetry(
  op: () => Promise<MutationResult>,
): Promise<MutationResult> {
  let result = await op();
  for (
    let attempt = 0;
    attempt < COMMIT_RETRY_ATTEMPTS && result.outcome === "commit-failed";
    attempt += 1
  ) {
    await delay(CONTINUATION_RETRY_MS);
    result = await op();
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface BearerRevalidator extends AuthorityBoundAuthRevalidator {
  revalidateCurrentContext(): Promise<RevalidateOutcome>;
}

/**
 * On-`UNAUTHORIZED` bearer revalidator for the push service's long-running
 * host stream, backed by the locked `rotate` mutation. Never throws — every
 * failure maps to an outcome, matching the CLI revalidator's contract.
 */
export function createBearerRevalidator(args: {
  readonly store: CredentialsMutationStore;
  readonly lease: MutableBearerLease;
}): BearerRevalidator {
  const { store, lease } = args;
  const revalidateCurrentContext = async (): Promise<RevalidateOutcome> => {
    try {
      const current = lease.getBearerToken();
      const result = await withCommitRetry(() =>
        store.rotate({
          expectedUserId: lease.identity.userId,
          expectedToken: current,
          refreshTokenOverride: null,
          signal: null,
        }),
      );
      switch (result.outcome) {
        case "applied":
        case "superseded":
        case "commit-failed":
          if (result.credentials !== null) {
            lease.rotate(result.credentials.token);
          }
          return "rotated";
        case "refresh-network":
        case "lock-busy":
          return "network-error";
        case "deleted":
        case "tombstoned":
        case "user-mismatch":
        case "refresh-rejected":
          return "rejected";
      }
    } catch {
      return "network-error";
    }
  };
  return {
    revalidateCurrentContext,
    async revalidateExpectedBearer(
      expected: OpenFrameBearerSource,
    ): Promise<RevalidateOutcome | "superseded"> {
      if (expected !== lease) return "superseded";
      return revalidateCurrentContext();
    },
  };
}
