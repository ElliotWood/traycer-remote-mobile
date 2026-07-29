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

**Both directions were exercised on the live VM.** The negative case was run
first, before the public key was registered, and failed with
`Permission denied (publickey)` at the probe. That run also caught a real
bug: `sudo` inherits the caller's cwd, and `az vm run-command` runs from a
root-only directory, so every `sudo -u traycer git ...` died with
`failed to stat ... Permission denied` *before contacting GitHub* — which
reads exactly like an auth failure and is not one. Hence the `cd /` at the
top of the script.

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
