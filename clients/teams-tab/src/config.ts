/**
 * Build-time configuration, supplied by Vite env at build time.
 *
 * Nothing here has a default that would let the app start against the wrong
 * host. An unset value produces an empty string and {@link configProblems}
 * reports it, rather than the app quietly pointing somewhere unintended —
 * the same reasoning as the mobile client's config diagnostics.
 *
 * NO deployment identifiers in source: the FQDN is a deployment fact, and
 * this file is committed to an open-source repo.
 */

/** `https://<host>/authn` — the AuthnV3 base the device flow talks to. */
export const AUTHN_BASE_URL: string = import.meta.env.VITE_AUTHN_BASE_URL ?? "";

/** `wss://<host>/rpc` — the Traycer host's WebSocket RPC endpoint. */
export const HOST_WS_URL: string = import.meta.env.VITE_HOST_WS_URL ?? "";

/** The host id this tab binds to, matching the host's own `pid.json`. */
export const CONFIGURED_HOST_ID: string = import.meta.env.VITE_HOST_ID ?? "";

export interface ConfigProblem {
  readonly key: string;
  readonly detail: string;
}

/**
 * Reports what is missing, rather than failing at the first use.
 *
 * A tab that starts and then errors on its first RPC is much harder to
 * diagnose from inside Teams than one that says on load which build-time
 * variable was not set — there is no address bar and no easy console.
 */
export function configProblems(): readonly ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (AUTHN_BASE_URL === "") {
    problems.push({
      key: "VITE_AUTHN_BASE_URL",
      detail: "Sign-in cannot start without the authn base URL.",
    });
  } else if (!/^https?:\/\//.test(AUTHN_BASE_URL)) {
    // ABSOLUTE, not relative — and this is a gate rather than a note because
    // the failure it prevents is invisible.
    //
    // A relative `/authn` throws inside `new URL(relative, base)` before any
    // request is made, so sign-in fails with ZERO network traffic: no failed
    // request in devtools, no server log, nothing to find. That cost the PWA
    // a long debugging session, and `.env.example` still suggests the form
    // that cannot work.
    //
    // Caught at load, where it names itself, rather than at first sign-in,
    // where it looks like an auth outage.
    problems.push({
      key: "VITE_AUTHN_BASE_URL",
      detail:
        `Must be absolute (https://…/authn), not "${AUTHN_BASE_URL}". ` +
        "A relative value throws while building the request URL, so sign-in " +
        "fails without a single network call.",
    });
  }
  if (HOST_WS_URL === "") {
    problems.push({
      key: "VITE_HOST_WS_URL",
      detail: "No Traycer host endpoint is configured.",
    });
  }
  if (CONFIGURED_HOST_ID === "") {
    problems.push({
      key: "VITE_HOST_ID",
      detail: "The host id is needed to bind the client to a host.",
    });
  }
  return problems;
}
