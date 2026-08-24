import type { TenantMapping } from "./types";

/**
 * The ONE construction of a tenant child process's environment. Both A1's
 * systemd-unit-template generation (per-host, boot-time) and A2's
 * `tenant-connection-manager.ts` (per-consumer-process, on-demand) MUST
 * call this rather than building their own — see `registry.ts`'s and
 * `tenant-connection-manager.ts`'s module docs for why: two independently
 * written spawners with two env allowlists, in the one place a divergence
 * hands someone another person's credentials, is a defect vector created
 * deliberately. If A1's systemd generator can't practically call into this
 * (e.g. it needs the values as `Environment=` unit-file lines rather than a
 * `NodeJS.ProcessEnv` object), it must still derive from the SAME allowlist
 * and the SAME `HOME`/`USERPROFILE` rule below — that's the non-negotiable
 * part, not the calling convention.
 *
 * WHY NOT `{ ...process.env, HOME: tenant.home }`: that spread inherits the
 * PARENT's entire environment into every tenant child. On this deployment
 * the parent process (the Teams bot / gateway) may hold secrets no tenant
 * child should ever see — and a tenant child already runs arbitrary agent
 * code under that tenant's `HOME` (the epic's accepted risk is
 * honest-actor attribution, not code-injection-proof isolation), so
 * minimizing what reaches it is real defense in depth, not theater. This
 * function copies ONLY {@link DEFAULT_INHERITED_ENV_ALLOWLIST} from the
 * parent's environment, plus caller-supplied `extra` values (per-spawn
 * identifiers like `TRAYCER_EPIC_ID`, never silently inherited), then sets
 * `HOME` and `USERPROFILE` last so nothing above can override them.
 *
 * `USERPROFILE` is set alongside `HOME`, not only on Windows — mirrors A1's
 * own contract ("`HOME` and `USERPROFILE` if ever on Windows"). Target
 * deployment is Linux, where `USERPROFILE` is simply inert, but a
 * half-set environment that only resolves correctly on Linux is a fault
 * that surfaces only when someone runs this on Windows for dev/testing —
 * exactly the kind of gap this repo's own environment traps warn about.
 */
export const DEFAULT_INHERITED_ENV_ALLOWLIST: readonly string[] = Object.freeze(
  ["PATH", "SystemRoot", "TEMP", "TMP", "ComSpec"],
);

export interface BuildTenantEnvironmentOptions {
  readonly tenant: TenantMapping;
  readonly parentEnv: NodeJS.ProcessEnv;
  /** Per-spawn values (e.g. `TRAYCER_EPIC_ID`, `TRAYCER_AGENT_ID`) — explicit, never read from `parentEnv`. */
  readonly extra?: Readonly<Record<string, string>>;
  /** Test-only override; production callers omit this and get {@link DEFAULT_INHERITED_ENV_ALLOWLIST}. */
  readonly allowlist?: readonly string[];
}

export function buildTenantEnvironment(
  options: BuildTenantEnvironmentOptions,
): NodeJS.ProcessEnv {
  const allowlist = options.allowlist ?? DEFAULT_INHERITED_ENV_ALLOWLIST;
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = options.parentEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (options.extra !== undefined) {
    for (const [key, value] of Object.entries(options.extra)) {
      env[key] = value;
    }
  }
  env.HOME = options.tenant.home;
  env.USERPROFILE = options.tenant.home;
  return env;
}
