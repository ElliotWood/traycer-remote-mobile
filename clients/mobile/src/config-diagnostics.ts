/**
 * Startup config validation (staleness/config incident, 2026-07-28) — fail
 * loudly instead of a silent runtime mystery.
 *
 * `VITE_AUTHN_BASE_URL` defaults to the real production authn origin
 * (`https://authn.traycer.ai`) when unset — correct ONLY when this app is
 * itself served FROM production (`https://platform.traycer.ai`), because
 * authn's CORS allowlist is that one origin and nothing else (see
 * `vite.config.ts`'s dev-proxy docblock). A build served from any other
 * origin (a tailnet URL, a custom domain, local dev) with this unset falls
 * back silently, and every sign-in attempt then dies to a browser CORS
 * block with no diagnostic beyond a generic network error — exactly what
 * happened here: a build produced with no `.env` baked in the production
 * default, and sign-in read as a plain "Couldn't start sign-in" mystery.
 *
 * `VITE_HOST_WS_URL` already has an EXISTING fail-loud path (`App.tsx`'s
 * `HostConfigPrompt`, via `app-screen.ts`'s "no-host" screen) — but only
 * AFTER a successful sign-in, so a config-less build still burns a full
 * device-flow attempt first. Surfacing it here too means the user never
 * starts sign-in against a build that cannot possibly finish it.
 */
const CANONICAL_PRODUCTION_ORIGIN = "https://platform.traycer.ai";

export interface ConfigProblem {
  readonly id: "authn-cross-origin-default" | "host-ws-url-missing";
  readonly message: string;
}

export interface ConfigDiagnosticsInput {
  readonly authnConfigured: boolean;
  readonly hostWsUrl: string | null;
  readonly origin: string;
}

export function computeConfigProblems(
  env: ConfigDiagnosticsInput,
): readonly ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  if (!env.authnConfigured && env.origin !== CANONICAL_PRODUCTION_ORIGIN) {
    problems.push({
      id: "authn-cross-origin-default",
      message:
        "VITE_AUTHN_BASE_URL was not set when this build was made, so it falls back to the production authn origin. Sign-in will fail here — authn only accepts cross-origin requests from the real production site, and this isn't it.",
    });
  }

  if (env.hostWsUrl === null) {
    problems.push({
      id: "host-ws-url-missing",
      message:
        "VITE_HOST_WS_URL was not set when this build was made, so there is no host for this app to connect to.",
    });
  }

  return problems;
}
