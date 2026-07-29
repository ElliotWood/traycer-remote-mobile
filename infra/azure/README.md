# Azure IaC — A0 (public ingress) + A1 (multi-tenant host supervision)

Bicep for one VM, its networking, TLS-terminating ingress, and the systemd
scaffolding for per-tenant host supervision. Subscription-agnostic (see
`bicep/main.bicep`'s top comment) — every environment-specific value is a
parameter, supplied via a gitignored `main.bicepparam` (copy
`main.example.bicepparam` to start).

**Current state: deployed and live** on subscription `SensorMine Demo`
(`f56c4ba7-…`, `australiaeast`, resource group `altra-rg-traycer-aue`) —
`https://altra-traycer-host-aue.australiaeast.cloudapp.azure.com`. This is a
validation deployment, not a production onboarding — no tenants are
provisioned (`tenantIds` is empty), and `/rpc`/`/stream` correctly 502 until
A1/A3 land a real host process. See "Post-deploy acceptance test" below for
what "live" was actually checked against, not just asserted.

## Scope

Provisions: VM, VNet/subnet/NSG, public IP, nginx + Let's Encrypt TLS,
the `traycer-host@.service` systemd template and per-tenant HOME
scaffolding, and (optionally) one DNS A record in an existing zone.

Does **not** provision: DNS zone creation/delegation (`dnsZoneName` names a
zone assumed to already exist), the identity registry (A2, its own
ticket/branch), individual tenants' actual Traycer CLI installs or
credentials (A3, per-person onboarding, sequenced after this), or the
static frontend bundle served at `/` (see "What's not done yet" below).

## Prerequisite: check quota — BOTH numbers, not just one

`az deployment group create`/`what-if` do **not** validate VM SKU
availability against quota (verified directly — see "What `what-if` does
and does not catch" below). A failed deploy from quota exhaustion is a
runtime failure, not a preview-time one. Check first:

```sh
az vm list-usage --location australiaeast --query "[?contains(localName,'Total Regional') || contains(localName,'Family vCPUs')]" -o table
```

**Two numbers matter, and they can diverge sharply:**

- `Total Regional vCPUs` — the whole subscription's ceiling in the region.
- `Standard <X> Family vCPUs` — the ceiling for the *specific SKU family*
  `vmSize` uses. **This one binds first.** A regional total with headroom
  says nothing about whether your chosen family has any.

This is not hypothetical — it is exactly what happened on this deployment's
first attempt. At the time `vmSize`'s default was chosen, `Total Regional
vCPUs` showed 20/26 used (6 free) and looked sufficient for a 4-vCPU
`Standard_D4as_v5`. The deploy failed anyway:

```
Standard DASv5 Family vCPUs:  4 used / 0 limit   <- already over, before this deploy
Standard DSv3  Family vCPUs:  4 used / 10 limit  <- 6 free, this is what actually deployed
Total Regional vCPUs:        24 used / 64 limit  <- looked fine both times; irrelevant to the failure
```

The pre-existing resource `altra-ab-sensormine-demo-aue` already consumes
the entire `DASv5` family allotment on this subscription — the regional
total never reflected that. `main.bicep`'s `vmSize` default is
`Standard_D4s_v3` for exactly this reason: it is what the per-family check
above showed as actually deployable, not a capacity recommendation (see
"Honest capacity statement" below). If quota changes, re-run the check
before trusting either number.

## Deploying (preview only — this repo does not auto-provision)

```sh
cd infra/azure/bicep
cp main.example.bicepparam main.bicepparam   # then fill in real values; gitignored
az bicep build --file main.bicep                                    # template-level lint/type-check
az deployment group validate --resource-group <rg> --template-file main.bicep --parameters main.bicepparam
az deployment group what-if  --resource-group <rg> --template-file main.bicep --parameters main.bicepparam
az deployment group create   --resource-group <rg> --template-file main.bicep --parameters main.bicepparam
```

### What `what-if` does and does not catch — verified, not assumed

Per this epic's own rubric ("prove a gate can fail before trusting that it
passes"), both the positive and negative cases below were run against the
real resource group, not inferred:

- **Bicep's own type system genuinely gates malformed input, client-side,
  before Azure is ever called.** Passing a string where `sshAllowedCidrs`
  (declared `array`) expects an array fails immediately:
  `Error BCP033: Expected a value of type "array" but the provided value
  is of type "'not-an-array'"`. This is a real, deterministic gate.
- **VM SKU validity is NOT checked by either `what-if` or `validate`.**
  Both were run with `vmSize` set to a nonexistent SKU
  (`Standard_NotARealSku_v99`) against the live resource group — `what-if`
  previewed a clean 5-resource creation plan with the bogus SKU name
  echoed back verbatim, no error; `validate` returned
  `"provisioningState": "Succeeded"`. SKU/quota validity is checked by the
  Compute resource provider only at actual deploy time. This is a real,
  documented gap in what these commands can promise you, not something
  papered over as "should be fine."
- The full clean template (all 3 modules, nested `vm`/`ingress`
  deployments) validates end-to-end via `az deployment group validate`
  (`"provisioningState": "Succeeded"` across every nested resource).
  `what-if` alone reports `NestedDeploymentShortCircuited` for `vm`/
  `ingress` — a known ARM tooling limitation when a nested module consumes
  another module's output via `reference()`, not a defect in this
  template; `validate`'s full evaluation is what actually proves the graph
  is correct.

## Post-deploy acceptance test

Positive rows prove a route exists; the negative row proves nothing else
is silently catching everything (see `infra/azure/scripts/bootstrap.sh`'s
phase-2 comment for why that distinction is load-bearing here — a
catch-all 200 previously survived certificate issuance undetected because
no check asked "does a route that shouldn't exist correctly 404").

| Path | Expected | Why |
|---|---|---|
| `/authn/api/v3/user` | `401` JSON `{"statusCode":401,"error":"Missing authorization header"}` | Proves same-origin proxying to `authn.traycer.ai` is real, not a stub |
| `/rpc`, `/stream` | `502` naming the missing upstream | Honest until A1/A3 provision a real host process — a `200` here would read as healthy to every check available today |
| `/nonexistent-xyz` | `404` | Proves the old catch-all is actually gone |
| `/` | `403` today | `/var/www/traycer` exists but is empty — see "What's not done yet" |
| `/assets/<real>.js` | `200 application/javascript` | Only once a bundle is deployed |

Run: `curl -s -w '\nHTTP %{http_code}\n' https://<publicHostname>/<path>`.
All rows above were run against the live deployment, independently, not
just pasted from a prior report.

## Private-repo access on the VM (deploy key + shared clone)

Agents on this VM need a working checkout of a **private** GitHub repo. Two
scripts, run in that order, with a deliberate human step between them:

```sh
# 1. On the VM, as root. Idempotent - re-running never regenerates the key.
infra/azure/scripts/ensure-repo-deploy-key.sh <key-name>
#    -> prints a PUBLIC key and pins github.com's host keys.

# 2. On a machine with `gh` and admin on the repo. NOT on the VM.
gh repo deploy-key add <pubkey-file> --title traycer-azure-vm \
  --allow-write --repo <owner>/<repo>

# 3. Back on the VM, as root.
infra/azure/scripts/provision-repo-clone.sh <owner> <repo> <branch> <key-name>
```

### Why a deploy key rather than a PAT

| | Deploy key | Fine-grained PAT |
|---|---|---|
| Secret transport | **None** - private half generated on the VM, never leaves | Minted elsewhere, must be carried to the VM |
| Scope | Exactly one repository | A *user*, plus a repo list that can drift |
| Expiry | None | 1 year max - access dies on a date nobody wrote down |
| Cost | **Per-repo**: repo #2 needs key #2 | One token can cover many repos |

The transport row is the deciding one. Anything handed to the VM via
`az vm run-command` is written by the guest agent under
`/var/lib/waagent/run-command/` — a PAT would be sitting in that payload.
The deploy key's private half has no transport step to expose. The per-repo
cost is the accepted trade at one or two repos; past a handful, move to a
GitHub App installation token rather than accumulating keys.

**Step 2 is not a gap waiting to be automated.** It is the authorization
boundary: the VM holds no GitHub credential and must not be given one just
so it can grant itself repository access.

### Where the secret lives, and what that does and does not protect

`/srv/traycer/secrets/<key-name>`, mode `0600`, owned by the shared OS user
— **not** root. A root-owned `0600` file would be unreadable by the process
that actually needs it (every tenant's host process runs as that shared
user), so root ownership would be security theatre that also doesn't work.

Stated plainly because `0600` reads stronger than it is here: under this
deployment's accepted one-OS-user architecture, **a co-tenant agent can read
this key**, exactly as it can already read any other tenant's
`~/.traycer/cli/credentials`. This adds no new class of risk and closes
none. What it does buy: the key is outside every repo working tree, so no
agent running `git add -A` can commit it.

### Host keys are pinned, not trusted on first use

`ensure-repo-deploy-key.sh` writes `/srv/traycer/secrets/known_hosts` from
`https://api.github.com/meta` — fetched over TLS, so the CA chain is the
trust anchor. It *then* runs `ssh-keyscan` and requires every key port 22
offers to be a subset of what the API published. `ssh-keyscan` alone is
trust-on-first-use over an unauthenticated handshake and would record an
attacker's key without complaint; this inverts it into a MITM **detector**.
Disagreement is a hard failure, not a warning. That is what lets the clone
run `StrictHostKeyChecking=yes` rather than `accept-new`.

### Clone location — A4's decision, not this script's

`/srv/traycer/repo/<owner>/<repo>`. One clone, shared by every identity,
deliberately **not** under any tenant's `HOME`: per-identity isolation
already comes free from each host process's own `HOME` →
`~/.traycer/worktrees/`. See `docs/deployment/azure-repo-worktree-layout.md`
(branch `traycer-azure-repo-layout`) for the full rationale, including the
part that matters most operationally: **the path is immovable once worktrees
exist**, because every linked worktree stores it as an absolute path in its
own `.git` admin file.

`provision-repo-clone.sh` persists the SSH wiring into the clone's own
`core.sshCommand`, so a later `fetch`/`push` — including from a worktree a
Traycer host process creates — works with no environment set up by the
caller.

### What the verification actually proves

The rubric this epic keeps failing is "checks that report success while
measuring nothing", so each check reads a value back off disk:

| Check | Why it can't pass vacuously |
|---|---|
| `HEAD` == the remote's sha for that branch | The remote sha comes from a pre-clone `ls-remote`, compared to a post-clone `rev-parse` |
| Branch name | Read via `rev-parse --abbrev-ref HEAD`, not inferred from the `clone --branch` flag |
| Tracked file count > 0 | An empty or shallow-broken clone fails |
| Zero paths not owned by the OS user | `find ! -user` — a root-owned stray makes the tree unwritable where it matters |
| Write probe | `touch` + `rm` **executed as that user**, not inferred from mode bits |
| Zero uncommitted files | `status --porcelain \| wc -l` |

The access probe is `git ls-remote` against the specific repo, **not**
`ssh -T git@github.com` — the latter reports a cheerful "successfully
authenticated" for a key registered against any repo at all.

**The negative case was exercised on the live VM first**, before the public
key was registered: the probe failed with `Permission denied (publickey)`,
so the gate is known to be capable of failing rather than merely observed
passing. That run also caught a real bug — `sudo` inherits the caller's
cwd, and `az vm run-command` runs from a root-only directory, so every
`sudo -u traycer git ...` died with `failed to stat ... Permission denied`
*before contacting GitHub*, which reads exactly like an auth failure and is
not one. Hence the `cd /` at the top of the script.

### Live state (measured, not asserted)

Read back off the VM in a separate invocation from the one that created it:

| | |
|---|---|
| Path | `/srv/traycer/repo/AltraCloud/sensormine-v4-self-host` |
| Branch | `feature/ew/auto_labelling`, tracking `origin/feature/ew/auto_labelling` |
| HEAD | `0381a1cb07c5aacae63dff0106337de90936e357` |
| Tracked files | 7337, working tree clean |
| Ownership | `traycer:traycer`, zero paths owned by anyone else; write probe passed |
| Deploy key | `/srv/traycer/secrets/sensormine-v4-self-host`, `traycer:traycer`, `0600` |

Write access was probed with `git push --dry-run` to a throwaway ref name;
`ls-remote` afterward confirmed **0** branches matching it, so the probe
left nothing behind. Treat the dry-run as corroboration, not proof — the
authoritative check that the key is read-write is
`gh repo deploy-key list` on the repo.

### Running these over `az vm run-command`: tag your output

`az vm run-command` is **single-flight per VM**. With several agents driving
one box, an invocation can return *another* agent's stdout under a
successful exit code — observed on this deployment, where one agent's probe
read this repo's deploy-key error as its own result. An automated check that
trusts such output can report a confident, entirely false pass.

So: emit a freshly generated unique marker at the start, middle and end of
the script, and **assert on it** before believing any of the output.

One trap worth naming, because it produced exactly the failure mode the
sentinel exists to prevent. In PowerShell, `"...$sentinel:exit=..."` does
not interpolate `$sentinel` — `$name:` is parsed as a *scope qualifier*, so
the whole thing silently becomes empty. The first sentinel here was written
that way in both the emitting script and the asserting regex, so the two
matched each other perfectly while carrying no unique value at all: a
provenance check that would have accepted any agent's output. Use
`${sentinel}`, and verify the marker you asserted on is actually present in
the raw text.

## A6 — unattended operation + alerting

Three layers, because the interesting failures are the ones the cheap
layer cannot see.

| Layer | Watches | Catches | Cannot catch |
|---|---|---|---|
| systemd `Restart=`/`StartLimitBurst` | process exit | crashes, restart loops | a process that is up but doing nothing |
| `traycer-health-probe@<tenant>.timer` (60s) | TCP-connect to the tenant host's own `pid.json` port, **only while systemd says the unit is `active`** | a wedged host: `active` but not serving | a component *between* the browser and the host |
| `traycer-relay-probe.timer` (120s) | full path through the deflate relay to the host | a relay that accepts connections but passes no traffic | — |

Alert path: every source calls one script, `traycer-alert.sh`, which
writes a single message shape via `logger -p local0.crit`. AMA ships
facility `local0` to Log Analytics; one Scheduled Query Alert matches
`ProcessName == "traycer-alert"` and an Action Group emails the operator.
One shape end to end is deliberate — two differently-shaped alert paths is
how a query covers one and silently misses the other.

### Proof each gate can fail — run, not asserted

Per the epic rubric ("prove a gate can fail before trusting that it
passes"), every row below was executed against the live VM:

| Gate | Negative test | Result |
|---|---|---|
| Restart-loop detection | started a tenant unit with no CLI binary, let systemd exhaust `StartLimitBurst` untouched | early failures alerted `reason=unit_failed`; the burst-exhausting one alerted `reason=restart_loop` |
| Worktree rescue | killed the unit with a dirty worktree, then ran `git gc --prune=now --aggressive` | rescue ref survived byte-identical, containing **both** the tracked modification and the untracked file |
| Relay end-to-end | reintroduced the exact `ws://`-Origin bug and restarted the relay | **see below** |
| Azure alert rule | — | genuinely `Fired` (11:33:22Z) and `Resolved` in Azure Monitor's alert history, not merely deployed |

**The relay negative test is the one that matters**, because it reproduces
the real outage:

```
systemctl is-active traycer-ws-deflate  -> active     <- green
systemctl is-active nginx               -> active     <- green
GET /authn/api/v3/user                  -> 401        <- acceptance row passes
GET /nonexistent-xyz                    -> 404        <- acceptance row passes
node traycer-relay-probe.mjs            -> FAIL exit 1
   "relay closed 1011 (upstream unreachable/refused - the Origin-403 signature)"
```

Every pre-existing check was green while the relay could not pass a single
byte to the host. After restoring the fix the same probe returns
`OK connection held open through the relay for 4000ms`.

Why a handshake check would not have caught it: the relay accepts the
browser connection **first**, then dials the host. An upstream 403 yields
a successful `101` followed by a `1011` close a moment later, so the probe
has to require the connection to *survive* a settle window rather than
just to open.

### Bugs this work surfaced (all found by running it, not by review)

- `traycer-host@.service` never set `TRAYCER_HOME_ROOT`, which
  `traycer-host-guard.sh` requires — so the A1 guard rail refused **every**
  start before `ExecStart` was ever reached, on every deployment.
- `git stash create --include-untracked` silently ignores that flag
  (`create` does not implement it; the text was folded into the stash
  message). Untracked files — a brand-new source file an agent never
  `git add`ed, exactly the state worth rescuing — were captured by
  nothing. Replaced with a scratch-index `git add -A` + `commit-tree`.
- The VM had **no managed identity**, so AMA could not authenticate to
  Azure Monitor at all: IMDS returned `Identity not found`, AMA retried
  forever, and both `Heartbeat` and `Syslog` stayed empty with no error
  anywhere except AMA's own on-box log. A monitoring pipeline that looks
  deployed and ships nothing — the hollow-green pattern inside A6 itself.
- Neither the relay **nor** this probe was referenced by `vm.bicep` or
  `bootstrap.sh`. Both were committed and both were running on the live
  box, so everything looked done; a rebuilt VM would have come up with no
  relay (epic loading broken) and no probe to notice. Both are now wired
  into `customData` + `bootstrap.sh`.

### Agent-execution surface (`traycer-agent-probe.sh`)

Watches the thing the VM exists for: the `claude` binary, the per-tenant
credential, and the repo checkout agents work in. Two modes, and the split
is the design:

| Mode | Cost | Catches |
|---|---|---|
| structural (on the timer) | free | missing/broken binary, token not configured, **token configured but not reaching the running host**, repo unreadable by the owning user |
| `--spawn` (**not** scheduled) | one real Claude call | a token that is present and delivered but **dead** — expired, revoked, or quota-exhausted |

`--spawn` is deliberately not on a timer. The deployment shares one Claude
Max account across N people (A7), so a probe that spawned an agent every
few minutes would consume the quota it exists to protect — monitoring that
causes the outage it watches for. Enabling it is an explicit, costed
decision, not one this repo makes for the operator.

### How the harness is actually authenticated (and two wrong checks)

`claude setup-token` prints a long-lived OAuth token and **persists
nothing**. There is no credentials file to find, by design. The token
lives in `/etc/traycer/claude.env` (0600 root:root) as
`CLAUDE_CODE_OAUTH_TOKEN` and reaches the harness through
`traycer-host@.service.d/10-claude-auth.conf`'s `EnvironmentFile=-`.

**Two drafts of this check were wrong in opposite directions**, and the
pair is more instructive than either alone:

1. `[ -s ~/.claude.json ]` — a false **green**. That file is first-run
   scaffolding Claude Code writes whether or not anyone authenticated: on
   this box 0600, 389 bytes, valid JSON, and containing *only* telemetry
   and migration keys (`machineID`, `userID`, `cachedExperimentData`,
   `migrationVersion`). Zero credentials, check passes.
2. Then requiring an auth-bearing key *in that file* — a false **red**.
   Under `setup-token` it never gains one, and a bare `claude -p` from any
   shell lacking the env var always reports `Not logged in`. The probe
   reported the agent surface broken while it was working.

The second is the mirror of the first: **strictness aimed at the wrong
mechanism is not rigour.** Fixing a false-green by tightening the same
wrong measurement just relocates the error.

What it checks now, verified against the live box:

- **Configured** — `/etc/traycer/claude.env` defines a non-empty
  `CLAUDE_CODE_OAUTH_TOKEN` (presence and value *length* only; the value
  is never read, printed, or logged, so it cannot leak into the journal or
  Log Analytics).
- **Delivered** — the variable is actually present in the running host's
  `/proc/<pid>/environ`. This is the half a config check cannot give you: a
  correct env file plus a host that started *before* the drop-in landed is
  a running harness with no credential — config green, capability absent.
- Unreadable env file is treated as **inconclusive and alerted**, named
  distinctly, because the file is 0600 root:root and that means "probe ran
  as the wrong user", not "credential missing".

Verified in all three directions: passes on the real working config, fails
when the env file is absent, fails when it defines an empty token.

### Onboarding a tenant by hand? Enable its timers, or it is unmonitored

**This has already happened once.** The only real tenant on the box
(`elliot`) had **no functional health probe at all** — `traycer-health-probe@elliot.timer`
was `disabled` — while the timer for a throwaway test canary was active.
Monitoring that looked deployed and covered nothing that mattered.

**Root cause, which will recur:** `bootstrap.sh` enables the per-tenant
timers inside its `for tenant_id in ${TRAYCER_TENANT_IDS}` loop, and
`tenantIds` is still `[]` in the live parameter file. `elliot` was created
by hand, outside that loop, so nothing ever enabled its timers. Nothing
failed; the tenant simply had no monitoring, and the only visible signal
was a canary's timer sitting in the list looking reassuring.

So: **any tenant added outside `bootstrap.sh` must have its timers enabled
explicitly**, or A3 must go through the loop.

```sh
systemctl enable --now traycer-health-probe@<tenant>.timer
systemctl enable --now traycer-agent-probe@<tenant>.timer
```

Verify with `systemctl list-timers 'traycer*'` and confirm a line exists
**per tenant** — the check is that the list matches the tenants you expect,
not merely that it is non-empty.

### A note on `az vm run-command` and probe provenance

`az vm run-command` is single-flight per VM, and concurrent agents have
seen it return *another* agent's stdout under a successful exit code — a
false-green generator.

**The probes themselves are structurally immune**: every one runs on-box
under a systemd timer or `OnFailure=`, and none shells out through
`run-command`. That is a property of where they run, not luck.

What *is* exposed is verification done from a workstation. Every A6 claim
in this README was gathered with a sentinel-tagged script (`echo
"<unique>-BEGIN"` … `-END`) and the output discarded unless both markers
were present. Anyone adding an off-box watchdog that drives the VM through
`run-command` must do the same, or assert on strings unique to their own
script — asserting on generic output like `active` is exactly how one
agent's state gets read as another's.

### Known limits, stated rather than implied

- The relay probe asserts the path carries a *connection*, not that a real
  `epic.subscribe` returns correct data. A host that accepts WebSockets
  but serves corrupt payloads would still pass.
- `traycer-health-probe` deliberately no-ops when systemd reports the unit
  inactive — that case belongs to `OnFailure=`, and alerting twice for one
  root cause makes the stream noisier, not more informative.
- Ingestion lag between `logger` and a queryable Log Analytics row is
  minutes. The alert rule's floor is `PT5M`. A6 is not a real-time pager.

## Agent execution — the thing the VM exists for

Everything above makes the box *serve* Traycer. None of it makes the box
*run an agent*, and for a long time it could not: there was no agent harness
installed on the VM at all. `command -v claude` returned nothing.

**Every check in this README passed the whole time.** `systemctl is-active`
said `active`, the health probe was green, `/rpc` and `/stream` answered,
the mobile client listed epics, and the host's own
`agent.listHarnessModels` returned a full Claude catalogue
(`default`/`opus[1m]`/`sonnet`/`haiku`) — because that catalogue is a static
list the host ships, **not a probe of anything installed**. It is the same
shape of defect as the catch-all `200` recorded above: a check that passes
while measuring nothing.

`infra/azure/scripts/provision-agent-runtime.sh` closes it, is wired into
`bootstrap.sh`'s last phase (so a rebuild gets it), and is re-runnable
standalone (so an existing box recovers without one).

### What is automatic on a rebuild, and what is not

| Piece | Rebuild gets it? |
|---|---|
| Claude Code harness installed to `/usr/local` | yes — `provision-agent-runtime.sh` |
| Harness on the **host process's** PATH | yes — `/usr/local/bin` is in it |
| Node 22 (see below) | yes — `bootstrap.sh` |
| Per-tenant agent work root (`$HOME/work`) | yes |
| **Claude subscription credential** | **no — a human must approve an OAuth grant** |

The credential is the one thing that cannot be captured here, and it is not
an oversight: it is an OAuth grant against a Claude subscription. **No token,
credential, or `.credentials.json` belongs in this repo**, and none is
committed. Supply it out of band using the procedure the script prints on
failure (reproduced under "Authenticating the harness" below).

### Install to `/usr/local`, and why the PATH that matters is the host's

npm's default prefix on this image is `/usr` (apt's territory), so the
harness is installed with `--prefix /usr/local`. The reason that works is
read from the live host process rather than assumed —
`/proc/<host-pid>/environ` gives:

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin
HOME=/srv/traycer/tenants/elliot
USER=traycer
```

The harness is spawned *by that process*, so that is the only PATH that
decides whether it is found. A login-shell PATH would prove nothing here:
the `traycer` user's shell is `/usr/sbin/nologin` and it never gets one.

### Node 22, not 20 — a fixed bug, not a version bump

`bootstrap.sh` used to install Node 20 with the justification "matches the
CLI's documented floor". The CLI does declare 20 — and then breaks on it.
Every CLI command that talks to the host over its WebSocket RPC failed:

```
$ traycer agent list-harnesses
error: No global `WebSocket` available for the host transport on this runtime. [code=E_UNEXPECTED]
```

Node 20 keeps the global `WebSocket` behind `--experimental-websocket`.
Moving to 22 fixed it; the same commands were re-run unflagged afterwards to
confirm. `NODE_OPTIONS=--experimental-websocket` was the alternative and was
rejected — that flag is removed in later Node majors, which would convert a
fixed bug into one that silently returns on the next upgrade.

The guard tests the **major version**, not presence: `command -v node` is
satisfied by exactly the Node 20 that is broken, so a presence check would
skip the fix on every already-deployed box.

Neither the Traycer host nor the Claude harness is affected by the system
Node version — both ship self-contained binaries, which is precisely why the
host ran fine on Node 20 while the CLI could not. System Node serves the
npm-installed `traycer` CLI, the ws-deflate relay, and its probe.

### Authenticating the harness (out of band, needs a human)

There is no SSH to this VM and no browser on it, so the flow is driven
through a tmux pty that survives between `az vm run-command` invocations:

```sh
tmux new-session -d -s claudeauth \
  "sudo -u traycer env HOME=/srv/traycer/tenants/elliot TERM=xterm-256color \
     /usr/local/bin/claude setup-token; sleep 3600"
tmux capture-pane -p -J -t claudeauth     # read the sign-in URL out of the pane
# a human opens that URL, signs in as the account whose capacity this box
# should consume, approves, and reads back the code:
tmux send-keys -t claudeauth '<code>' Enter
tmux capture-pane -p -J -t claudeauth     # confirm it took
```

Whichever account authorises here becomes the VM's capacity — this is a
deliberate choice, not a detail. Re-run `provision-agent-runtime.sh`
afterwards to verify.

### What the verification actually proves

The script's check is deliberately **not** "is the binary present" and
**not** "what version does it print" — a version string proves a file
downloaded. It runs a real inference round-trip, as the real OS user, with
the real per-tenant HOME:

```sh
sudo -u traycer env HOME=/srv/traycer/tenants/elliot \
  /usr/local/bin/claude -p 'Reply with the single word: ready'
```

`sudo -u` is not decoration: root can run the binary while the `traycer`
user may not, and root is not who runs agents.

**The negative case was run first.** With the harness installed but not yet
authenticated, the check fails and prints the recovery procedure — confirmed
live before the credential existed, so the passing case is worth something.
That ordering is the point: a gate never observed failing is not evidence.

## What's not done yet

- **The static frontend bundle is not deployed.** `bootstrap.sh` creates
  `/var/www/traycer` but leaves it empty, so `/` 403s (nginx's default
  behaviour for an existing, index-less, non-listable directory — not a
  bug). Deploying the built bundle there doesn't fit A1 or A3 cleanly:
  both govern per-*tenant* backend processes, while the bundle is
  tenant-agnostic static assets. It sits closest to A0's own promise
  ("real ingress" implies serving something at `/`, not just infra) — most
  of the plumbing (`try_files ... =404`, the docroot, TLS) is already this
  ticket's code. Tracking it as an A0 follow-up rather than folding it
  into A1/A3's scope.
- **The `buildTenantEnvironment`/systemd HOME-derivation parity check is a
  shell script, not a type-checked test** —
  `infra/azure/scripts/verify-tenant-env-parity.sh`, run and proven to
  both pass on the current tree and fail on a deliberately broken unit
  file. `clients/shared/identity-registry/tenant-environment.ts` (A2) does
  not exist on this branch yet, so a real vitest import isn't possible
  today; this is a grep-based structural check that could be fooled by a
  rearrangement preserving the same substrings. Replace with a real
  cross-package test once A2 merges — tracked here, not silently dropped.
- Tenant onboarding (A3) — `tenantIds` is empty on this deployment.
- Nginx tenant routing beyond `/authn`, `/rpc`, `/stream` — no per-tenant
  path/host routing exists; that is A1/A3's territory once a real host
  process exists to route to.

## Honest capacity statement

`Standard_D4s_v3` (4 vCPU / 16 GiB) **proves the multi-tenant model
deploys and serves real TLS traffic. It does not carry a team.** The user
runs roughly 10 concurrent Claude Code agents on a single workstation
today; this VM has not been load-tested against anything close to that
per-tenant, let alone multi-tenant. Read every claim in this document as
"validated at this size," never as a sizing recommendation — A7 (capacity)
is the ticket that measures real per-tenant usage and revisits `vmSize`
from evidence, not this document's guess.

## Cost estimate (australiaeast, pay-as-you-go, USD — from Azure's retail
pricing API, not memorized)

| Resource | Rate | Monthly (≈730h) |
|---|---|---|
| VM compute, `Standard_D4s_v3` | $0.25/hr | ~$182.50 |
| OS disk, StandardSSD_LRS, 30 GiB (E4 tier) | $3.264/mo flat | $3.26 |
| Public IP, Standard, static | $0.005/hr | ~$3.65 |
| **Total (excl. bandwidth)** | | **~$189/mo** |

Bandwidth/egress is usage-based (not a flat rate) and not included — the
first tier is typically free in this region and expected negligible for a
validation deployment's traffic volume, but this is not measured, only
expected. Re-run the same retail-pricing-API query if `vmSize` changes;
prices above are current as of this deployment, not guaranteed stable.

## Why one shared OS user (not one per tenant)

All tenant host processes run under a single OS user
(`infra/azure/systemd/traycer-host@.service`'s `[Service]` comment);
isolation is per-process `HOME`, never OS-user or filesystem boundaries —
see `clients/remote-bridge/docs/multi-tenant-deployment.md` for the full
accepted-tradeoff writeup (**the filesystem enforces nothing between
tenants**; only `HOME` being set correctly, once, before spawn, does). The
tech plan rejected one-OS-user-per-tenant because Traycer CLI's own
`service install` path assumes exactly that model and does not compose
with per-tenant systemd instances the way this deployment needs.

The `HOME`/`USERPROFILE` derivation here (a systemd `Environment=` line
templated from `TRAYCER_HOME_ROOT`/`%i`) is required to match A2's
`buildTenantEnvironment`'s non-negotiable rule — same field, same
tenant-owned value, set last, nothing able to override it afterward — even
though it cannot literally call that function (see
`infra/azure/bicep/modules/vm.bicep`'s comment on why baking a
provisioning-time snapshot of `PATH`/`TEMP` into a long-lived unit file
would be actively wrong, not merely different). Enforced today by
`infra/azure/scripts/verify-tenant-env-parity.sh` (see "What's not done
yet" for its known limitation).

## Cleanup

The resource group is tagged `purpose=traycer-remote`,
`managed-by=bicep`, `disposable=true`. Delete everything with:

```sh
az group delete --name altra-rg-traycer-aue --yes
```

---

## A2 — identity-routed ingress (the tenant router)

Until this landed, the VM ran N host processes but was **effectively
single-tenant**: `traycer-ws-deflate.service` was hardcoded to
`/srv/traycer/tenants/elliot/.traycer/host/pid.json`, so every inbound
connection reached that one tenant's host regardless of who sent it. The
multi-identity architecture existed on paper only.

`traycer-tenant-router.service` replaces it. Same port (`45080`), same
`upstream traycer_host` in nginx, same permessage-deflate on the
internet-facing leg — plus the thing that makes the VM genuinely
multi-tenant: it decides **which** tenant's host each connection reaches.

### The routing key, and why the decision happens where it does

The bearer is **not an HTTP header**. `ClientOpenFrame` is
`{ kind: "open", token, manifest }` — the token arrives as the **first
WebSocket message**, after the upgrade, because browsers cannot set headers on
a WebSocket. So nginx *cannot* route on identity; it has no visibility past the
upgrade. The router must accept the socket, buffer until the open frame lands,
and only then choose an upstream. That ordering is forced by the protocol.

The identity is **not read out of the token**. The token is presented to
Traycer's own authn (`GET /api/v3/user`, access-only — it can never spend a
refresh token) and the user id in the **answer** is the routing key. A client
presents a token; it cannot present an identity. Nothing else — path, query,
header, cookie, Origin, conversation id — influences tenant selection.

Resolution goes through the same `IdentityRegistry` the rest of the epic uses,
bundled in rather than reimplemented. A second implementation of the security
control living in a deploy script is exactly the divergence that hands one
engineer another engineer's credentials.

### Routing is not authorization

This is what makes the live-authn dependency acceptable inside the security
control. The host independently validates the same bearer and enforces its
owner binding, so a stale routing decision sends a user to **their own** host,
which then applies its own check. It cannot send anyone to a *different*
tenant's host, because the id routed on came from the issuer. Every failure is
closed: bad frame, rejected token, **authn unreachable**, verified-but-unmapped
identity, or a tenant whose host is down all close the socket. There is no
default tenant and no first-configured-tenant fallback.

### The registry is generated, never committed

`traycer-registry-generate.sh` derives `/srv/traycer/identity-registry.json`
from each tenant's own credentials file — the same file the host reads to pin
its owner — so "the registry says X" and "X's host is pinned to X" are the same
fact rather than two facts that can disagree. Real user ids are therefore never
in git. A tenant with no credentials is **skipped, not defaulted**: nobody is
signed in as them, so there is no identity to route.

### Build and deploy

```bash
infra/azure/router/build.sh          # -> infra/azure/router/dist/tenant-router.mjs
# self-contained (zod + ws bundled); the VM needs no npm install
```

### Proof, not configuration review

Two harnesses, both runnable on the VM against the **deployed artifact**:

- `verify-routing.mjs` — stands up two real host listeners on different ports,
  two tenant homes, and a stand-in authn, then drives real connections through
  the real router and asserts *which listener each one physically arrived at*.
  12 checks: A→A, B→B (kills "always the first tenant" — the mutation that
  passes every single-tenant test ever written), unmapped refused, rejected
  token refused, authn-down refused, open frame forwarded verbatim, and the
  upstream `Origin` being `http://` rather than `ws://` (that one cost a live
  outage; see `traycer-ws-deflate-proxy.mjs`'s note).
- `smoke-real-token.mjs` — drives a **real** tenant's **real** token through
  **production** authn to their **real** host. Takes a loopback port or a full
  `wss://` URL, so it exercises either the router alone or the whole public
  chain. Prints only a hash prefix of the user id, never the token.

Neither subsumes the other: the first proves the routing decision, the second
proves the decision is being made from a genuine production credential.

### Rollback

`traycer-ws-deflate.service`'s unit file is left in place (stopped and
disabled). `systemctl disable --now traycer-tenant-router && systemctl enable
--now traycer-ws-deflate` restores the previous single-tenant behaviour.

### Third harness: a real browser session

`verify-pwa-session.mjs <origin-url>` drives real chromium (via
`playwright-core`, resolving a browser from the local Playwright cache) against
the public origin and asserts the PWA **renders**, not merely that the protocol
chain carries frames. The first two harnesses can both pass while the app is
blank — a WebSocket that opens and exchanges one frame is not a working client.

It reads `~/.traycer/cli/credentials` on the machine running it and seeds
`localStorage["traycer.mobile.auth"]` before app code runs, because the app
would otherwise boot into the device-code sign-in flow, which needs a human.
Nothing is copied off the VM; only a hash prefix of the user id is printed.

Checks: valid TLS + 200, a `wss://` connection actually opened, non-trivial
rendered content, **not** on a sign-in/unauthorized screen, **not** showing a
connection-failure banner, and no uncaught page errors. It also writes a
screenshot and the rendered text.

One note for whoever edits it: the `try/catch` around the `localStorage` seed is
load-bearing. Init scripts run in *every* frame, and this app renders wireframe
previews in sandboxed iframes where `localStorage` access throws — without the
guard the harness manufactures the page errors it exists to detect.
