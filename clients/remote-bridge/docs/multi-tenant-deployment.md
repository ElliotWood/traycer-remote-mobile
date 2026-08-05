# Multi-tenant deployment contract (A1 spec)

Status: **specification only** — no implementation here. This is the contract
whoever writes the spawner (systemd units, process manager, orchestration
script) implements against. It does not require reading `clients/remote-bridge`
source to follow.

## Deployment model this contract assumes

One VM. One OS user. N `traycer-remote-bridge` processes, one per Traycer
identity ("tenant"). Each process is pinned to one person's Traycer account by
environment configuration alone — **not** by OS user separation, not by file
permissions, not by any container or namespace boundary. This is an accepted
trade-off (isolation via convention + process configuration, not the
filesystem), not an oversight this spec is trying to paper over.

**The filesystem enforces nothing between tenants.** Every credentials file
under `~/.traycer/cli/credentials` is written `0600` (owner-read-only) — but
"owner" is the one shared OS user every tenant process runs as, so that mode
bit protects the account from *other machine users*, not tenant processes from
*each other*. Two bridge processes on this VM can read every other tenant's
credentials file if they resolve `$HOME` to it. Nothing at the OS level stops
that. The only thing that does is item 1 below being followed correctly.

## 1. Required environment, set before spawn, never mutated after

| Variable | Required | Why |
|---|---|---|
| `HOME` | **Yes**, on every platform this runs on (Linux is the target; also required if ever run on a POSIX-like shell on any other OS) | The single root every path in this contract derives from. See "Why `HOME` alone decides identity" below. |
| `USERPROFILE` | Only if this ever runs on native Windows (not applicable to the Linux Azure VM target, listed for completeness) | Node's `os.homedir()` reads `USERPROFILE` first on Windows, `HOME` on POSIX. Set both if the platform is ever ambiguous; on Linux only `HOME` matters. |

**Set before the process starts. Never mutated while it runs.** This is not
a style preference — it's a proven runtime property. `os.homedir()` re-reads
the environment on every call, with no OS- or Node-level cache:

```
node -e "os.homedir()" with HOME mutated mid-process:
before:       C:\Users\example
after HOME=1: C:/fake/home/1
after HOME=2: C:/fake/home/2
```

That means a `HOME` mutated after a process has already started (a
misconfigured supervisor "helpfully" updating an env var live, a shared
environment-variable store one tenant's restart script overwrites) does not
error — it silently redirects every subsequent credentials read, lock
acquisition, and host-discovery read to a different identity's files, mid-run,
with no crash to signal it happened. **The spawner must guarantee `HOME` is
part of each process's fixed launch environment (`Environment=` in a systemd
unit, or equivalent), not a value written to a shared/mutable location the
running process re-reads.**

### Why `HOME` alone decides identity

Every path the bridge touches is `join(homedir(), ".traycer", ...)`:

- Credentials: `~/.traycer/cli/credentials` (+ `.lock`, `.meta.json` beside it)
- Host discovery: `~/.traycer/host/pid.json` (read-only — the bridge never
  writes this; it is written by that identity's own Traycer host process,
  which must also be launched under the same `HOME`)

There is no second identity signal anywhere in the bridge or the underlying
`@traycer/protocol/config` primitives it depends on — no OS-user check, no
container/namespace read, no separate "tenant id" config value. `HOME` is not
*a* factor; it is the *only* factor.

## 2. What must never be shared between tenants — the invariant

**State the property, not the list, because the property is what a future
change could violate without any existing test noticing:**

> Every path this process resolves is derived from its own `HOME`.
> Nothing is global, hardcoded, or shared across processes.

This was verified directly against the code for this contract, not assumed:

- `cliConfigDir()` / `cliCredentialsPath()` (`protocol/src/config/paths.ts`)
  call `os.homedir()` inline on every invocation — no module-level constant,
  no memoization, nothing resolved at import time that a later `HOME` change
  wouldn't pick up (moot once you follow "set before spawn," but confirms
  there's no *additional* bug hiding behind that rule).
- The credentials **lock path** is `${credentialsPath}.lock` — always
  colocated with that process's own resolved credentials file
  (`clients/shared/auth/host-credentials-store.ts`). The underlying lock
  primitive (`protocol/src/config/credentials-lock.ts`) takes the lock path
  as a parameter throughout; grepped the entire file for any fixed/global
  path — none exists. Two tenants' lock files never collide because their
  credentials paths never collide, given distinct `HOME`s.
- The bridge itself **binds no port, writes no pid file, and writes no log
  file** — logging goes to `process.stderr` only, with no file path anywhere
  in the logger. There is nothing here for two tenants to collide on beyond
  the `HOME`-derived filesystem paths above.

If a future change introduces any top-level `const` that resolves `homedir()`
once at import time, or any path that is not `join(homedir(), ...)`, it
violates this invariant silently — there is currently no test that would
catch it, because the property has never been false. Anyone changing
`clients/shared/auth/host-credentials-store.ts`,
`clients/remote-bridge/src/host-endpoint.ts`, or the `@traycer/protocol/config`
path helpers should re-verify this invariant by hand.

## 3. The guard rail Traycer does not provide — and how to compensate operationally

**Traycer has no built-in way to detect or prevent two processes started
against the same `HOME`.** If a spawner mistake launches two bridge processes
(or a bridge and a `traycer` CLI invocation) under the identical `HOME`, they
will contend for the same credentials lock file — which will *work*
(`credentials-lock.ts`'s lock serializes correctly; this was proven under real
concurrent contention as part of T0b, two real processes racing one real file,
exactly one refresh spent, both converge) — but it will silently mean two
processes are operating as **one identity that neither of them owns
exclusively**. That is a deployment-topology bug, not a crash, and nothing in
this codebase surfaces it. This has been raised upstream as a Traycer product
gap; the deployment cannot wait on that landing.

**Until Traycer provides that surface, the spawner is responsible for both
halves of this gap:**

**a. Refuse a double-launch.** Before starting a bridge process for tenant
`T`, the spawner must check whether a bridge is already running for that same
`HOME`. There is no Traycer-provided mechanism for this — implement it at the
spawner/orchestration layer (e.g., a systemd unit named per-tenant so
`systemctl start traycer-bridge@T` is inherently exclusive per tenant; or an
explicit PID-file-under-`HOME` check the spawner itself owns and cleans up,
external to the bridge's own code, since the bridge deliberately writes none).
**Two spawner-launched processes sharing a `HOME` is a spawner defect to
prevent, not a bridge-code condition to detect** — the bridge has no signal
that would let it self-detect this.

**b. Let an operator verify which identity a given running process is pinned
to, without reading source.** The bridge now provides this directly: every
successful startup logs a single greppable line to stderr, before any RPC or
host connection is attempted —
```
{"level":"info","message":"identity resolved","fields":"{\"userId\":\"<resolved user.id>\",\"home\":\"<resolved HOME>\"}"}
```
(`clients/remote-bridge/src/bridge-client.ts`'s `BridgeClient.start()`,
sourced from `HostAuth.userId`/`HostAuth.home` in `host-auth.ts`). This is
the process's own attestation, self-reported and live-verified against the
real host — an operator greps that process's log output for `"identity
resolved"` and gets the exact `user.id` and `HOME` it started with, no
`/proc` inspection required. `/proc/<pid>/environ` remains a fallback for a
process that crashed before logging, or whose logs were not retained, but is
no longer the primary mechanism. The spawner's own launch configuration
(systemd unit naming, process manager metadata) is still the authoritative
record of *intended* tenant mapping — the identity-resolved log line is what
confirms the process's *actual* resolved identity matched that intent.

## 4. Failure modes — what actually happens, checked against the real runtime, not described as intended

| Condition | What actually happens | How it looks to an operator |
|---|---|---|
| `HOME` unset entirely | **Fails cleanly, by design — fixed and live-verified, no longer a risk left to the spawner.** The underlying danger is real and stays documented below for context: per Node's own `os.homedir()` contract ("On POSIX, it uses the `$HOME` environment variable if defined. Otherwise it uses the effective UID to look up the user's home directory" — nodejs.org/api/os.html#oshomedir), an unset `HOME` would otherwise fall back to the password-database entry (`getpwuid`) for the **current OS user** — and since every tenant on this VM shares that one OS user, that fallback would silently collapse every misconfigured tenant onto the SAME real identity, with no error. `clients/remote-bridge/src/host-auth.ts`'s `requireHomeEnv()` closes this by reading `process.env.HOME` (`USERPROFILE` on Windows) directly and refusing to proceed if it is unset or empty — it never calls `os.homedir()` at all, so the dangerous fallback is never reached. Called at the very start of `resolveHostAuth()`, before any credentials file is read. Live-verified against the real host with `HOME`/`USERPROFILE` unset: process exits immediately, code 1, `[bridge] fatal: remote-bridge: HOME is not set in the environment...` — no credentials file touched, no network call made. Strict, no escape hatch: there is no legitimate case in this deployment model where falling back to the OS user's home is the intended behavior. |
| `HOME` set to a path that does not exist | **Fails cleanly, verified.** `readCredentialsFile` (`protocol/src/config/credentials.ts`) maps `ENOENT` to `null` ("no session") rather than throwing; `resolveHostAuth()` (`clients/remote-bridge/src/host-auth.ts`) returns `null` on a `null`/empty-token read, and `BridgeClient.start()` throws `"remote-bridge: not signed in - run \`traycer login\` to authenticate."` The process exits with a clear, attributable error. This is the SAFE failure — loud, unambiguous, and it cannot be mistaken for a different tenant's identity. |
| `HOME` set to **another real tenant's** home directory (a spawner mix-up, not a typo) | **Does NOT fail. Silently succeeds as the wrong identity.** Verified directly: a process whose `HOME` was set to a different (real, valid) tenant's home directory reads that tenant's actual credentials file and proceeds as that tenant with no error, no warning, and no code-level distinction from correct operation. Demonstrated: <br>`Process resolved identity: TENANT-B-USERID` (while intending to run as tenant A). <br>**This is the failure this whole contract exists to prevent**, and the bridge code has no way to catch it — it has no independent notion of "who it is supposed to be" to compare against. The ONLY defense is the spawner never producing this condition: `HOME` values must be generated deterministically per tenant (never copy-pasted, never derived from a shared/mutable source two tenants could momentarily both read) and the spawner should log the resolved `HOME` value alongside the tenant identifier it intended at every launch, so a mismatch is at least auditable after the fact even though it is not detectable in-process. |

## What changed since this spec was first written

Two of the risks originally documented here as pure spawner responsibilities
turned out to be fixable inside the bridge itself, and were: the unset-`HOME`
collapse (§4's first row) is now a fail-fast check in the bridge's own code,
not just an instruction for the spawner to follow; the operator-verification
gap in §3(b) is now a startup log line the bridge emits itself, not purely a
`/proc` workaround. Both are implemented in `clients/remote-bridge/src/host-auth.ts`
and `bridge-client.ts`, covered by unit tests, and live-verified against the
real host. The distinction that remains: these are things the bridge CAN
self-detect (its own environment, its own resolved identity); the
double-launch guard (§3a) is not, because it requires knowledge of other
processes the bridge has no way to observe — that one is still, correctly,
the spawner's job.

## What this spec deliberately does not do

- Does not specify the process supervisor (systemd, PM2, plain shell) — that's
  the spawner author's implementation choice.
- Does not build the "refuse a double-launch" check from §3a — implementing
  that requires the spawner/orchestration layer's own knowledge of what else
  it has launched, which the bridge cannot observe about itself.
- Does not build any introspection tooling beyond the startup log line
  already shipped — a queryable "what identity is this PID" surface (rather
  than grepping logs) is future scope, not part of this ticket.
