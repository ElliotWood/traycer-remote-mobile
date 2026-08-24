import {
  HostRpcError,
  isTransientHostRpcFailure,
} from "@traycer-clients/shared/host-transport/host-messenger";

/**
 * Runs a unary RPC call with ONE bounded retry when the HOST itself
 * classifies the failure as transient (`HostRpcError.fatalDetails.retryable
 * === true` — the same `isTransientHostRpcFailure` check the GUI's own
 * error-toast logic already uses).
 *
 * This is deliberately NOT auth recovery. `createAuthAwareMessenger`
 * revalidates the BEARER on a plain `UNAUTHORIZED`; this handles the
 * narrower case the host explicitly flags retryable-without-a-bearer-change
 * — a transient credential-VERIFICATION hiccup on the host side.
 * `auth-aware-messenger.ts`'s own comment names "a JWKS fetch timeout" as an
 * example of this class; an `"exp" claim timestamp check failed` observed
 * once against a bearer independently confirmed non-expired (its `exp`
 * claim decoded and compared against wall-clock time) is the same class — a
 * momentary host-side verification hiccup, not a bad token. Revalidating our
 * own bearer cannot fix a host-side hiccup, so the fix is exactly what the
 * host is telling us to do: wait briefly and ask again, once, and log that
 * it happened so this failure mode is visible on an unattended process
 * instead of silently fatal.
 *
 * Bounded to exactly one retry: a transient host-side hiccup either clears
 * on the next attempt or it is not actually transient, and this helper must
 * not become an unbounded retry loop hiding a real, persistent failure.
 */
export async function withTransientRetry<T>(opts: {
  readonly label: string;
  readonly call: () => Promise<T>;
  readonly onDiagnostic: (message: string) => void;
  readonly delayMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    return await opts.call();
  } catch (error) {
    if (!(error instanceof HostRpcError) || !isTransientHostRpcFailure(error)) {
      throw error;
    }
    opts.onDiagnostic(
      `${opts.label}: host reported a transient failure (${error.message}) - retrying once in ${String(opts.delayMs)}ms`,
    );
    await sleep(opts.delayMs);
    return opts.call();
  }
}
