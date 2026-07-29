# Azure shared-repo + worktree layout (A4)

How the Azure VM's N per-identity Traycer host processes (see the multi-identity
host deployment) share one git repository safely. Scripts implementing this are
under [`scripts/azure/`](../../scripts/azure). This document is the shippable
counterpart of the A4 sprint contract negotiated with the epic's Evaluator; it
states the finished design, not the negotiation.

## What's already solved by the deployment's other pieces

Every identity's Traycer host process runs with its own `HOME`
(`/srv/traycer/identities/<hostId>`, one per person). Because
`TRAYCER_HOME = join(homedir(), ".traycer")` is derived purely from `HOME`,
**each identity already gets its own `~/.traycer/worktrees/` root for free** -
no parallel worktree-rooting scheme is needed here. This document only covers
what that per-`HOME` isolation does *not* give you automatically: the shared
clone's location, branch naming, concurrency safety, disk sizing, stale
reclamation, and permissions.

## Shared clone

One clone, at one path, shared by every identity's host process:

```
/srv/traycer/repo/<owner>/<repo>
```

Provisioned once via [`provision-shared-repo.sh`](../../scripts/azure/provision-shared-repo.sh).
**Idempotency is qualified, not unconditional:** re-running with the identical
arguments is a no-op *when the target's `git remote get-url` echoes back
exactly the string passed to `git clone`* - true on Linux (reasoned, not yet
verified against a real Linux target - see the platform-limitation note
below), but **not** reliable on Windows/git-bash, where a POSIX-style path
can round-trip through `git clone` and come back drive-lettered, making an
identical second invocation look like a mismatched remote and refuse. Either
way, the script always refuses to touch a checkout whose `origin` genuinely
doesn't match what was asked for - that part holds on both platforms and is
tested. See `provision-shared-repo.test.sh`, which asserts idempotency for
real and reports the Windows limitation as an explicit, explained SKIP rather
than a silent pass or an unexplained failure.

**This location is a one-time, final decision, not a config value to revisit
casually.** Every worktree linked to this clone stores the clone's path as an
**absolute path** inside its own `.git` admin file
(`gitdir: /srv/traycer/repo/<owner>/<repo>/.git/worktrees/<name>`). Moving the
clone after worktrees exist requires running `git worktree repair` against
every single tenant's checkout.

## Branch naming

```
u/<identity>/<chat-id>
```

This matches the product's own shipped branch convention - this very repo's
worktrees already use `<seg>/<seg>` names (`traycer/merry-moose`,
`tests/validation-suite`) - rather than inventing a parallel scheme.

Constructed and validated by
[`branch-namespace.sh`](../../scripts/azure/branch-namespace.sh)
(`azure_branch_name <repo-dir> <identity> <chat-id>`). Never construct this
string ad hoc elsewhere - every caller (the bridge, onboarding tooling,
anything that calls `worktree.create`) goes through this function.

### The `u/` prefix, and what it does and doesn't buy

A flat branch literally named `<identity>` (creatable by anyone with shell
access to the shared repo - any agent, per this project's already-accepted
same-OS-user risk) permanently blocks every future worktree for that identity:
git refuses a ref that is simultaneously a leaf and a namespace directory.
Reserving one prefix token (`u/`) narrows the collision surface from N
identity values to a single documented token nobody should use directly for
an unrelated branch.

**This is a mitigation, not a guarantee.** It does not stop someone from
creating a flat `u` or `u/<identity>` branch by hand. `branch-namespace.sh`'s
pre-flight `git show-ref` walk catches the common case with a named
diagnostic instead of git's generic "cannot lock ref" two layers down, but it
races with concurrent out-of-band branch creation and cannot enforce anything
against direct shell access. This is the same class of risk already accepted
for the whole deployment (an agent with shell access can do this through
ordinary product behavior) - named here concretely for branch naming, not
newly introduced by this design.

### Identity segment: `hostId`, not an AAD object id

The identity segment is A2's `hostId` - **not** the AAD object id. A2 declined
to hand over oids on privacy grounds: an oid correlates a person across every
AAD-integrated system, and a GUID welded into git branch history outlives the
branch itself. `hostId` carries no meaning outside this deployment and is the
reverse-lookup key for `resolveIdentity(hostId)`.

A2's registry (`registry-config.ts`) enforces `hostId` against
`^[a-z0-9][a-z0-9-]{0,63}$` at load time and refuses to load a non-conforming
value. `branch-namespace.sh` validates the identity segment against the exact
same pattern - **this is now an assertion of an invariant A2 already
guarantees, not primary defense** (contrast the chat-id segment below, which
remains genuinely untrusted). Kept because it's cheap and catches a violation
elsewhere instead of letting it propagate silently.

**Stated assumption, not enforced here:** a retired `hostId` is never
reissued. Branch history outlives the tenant it named, so a recycled `hostId`
would silently attribute a departed colleague's branches to whoever gets that
id next. This is a config-issuance-time concern A2's registry has no
visibility into - it belongs to A1/A3's onboarding/offboarding procedure. A4
depends on this assumption (it's the only ticket that reads identity back out
of branch names) without being able to enforce it; written down so it's
checkable rather than silently relied on.

### Chat-id segment: still the real defense

`chatId` is **client-supplied** per protocol
(`protocol/src/host/epic/unary-schemas.ts:924-925`: *"Client-supplied. The
host resolver is idempotent on this id."*) with no format constraint beyond
`z.string()`. `branch-namespace.sh` is the only thing standing between an
untrusted chat-id and git.

### Why `LC_ALL=C` is forced on every validation call, and why it matters beyond this script

Under a UTF-8 locale (the common Linux server default, e.g. `en_US.UTF-8`),
glibc collation interleaves case (`a A b B c C ...`), so a bracket expression
like `[a-z0-9]` matches uppercase letters too - `ALICE` passes a
`[a-z0-9]`-anchored shell pattern under `en_US.UTF-8` but is correctly
rejected under `C`/`C.UTF-8`. Measured directly (see
`branch-namespace.test.sh`).

This is load-bearing for more than this script's own correctness: A2's
registry enforces the **identical regex string** in JS, where character
ranges are code-point-based and locale-independent - JS always rejects
`"ALICE"`. Without forcing `LC_ALL=C`, this shell check would silently
disagree with A2's JS check under a normal Linux locale (shell accepts what
JS rejects) - exactly the cross-layer drift this design depends on not
happening. `LC_ALL=C` is what makes the two checks mean the same thing, not
just a local footgun fix.

### Flag-injection: git is not a safety net

A branch name starting with `-` is parsed as an **option** by git's own
argument parser, not rejected as an invalid ref. Verified directly:

```
$ git worktree add wt-evil -b "-D" victim-branch
Preparing worktree (new branch '-D')
Deleted branch victim-branch (was 3aef047).
fatal: invalid reference: -D
```

The victim branch is gone; git reports failure. `git`'s own ref-format
validation (`check-ref-format`) rejects `..`, `~`, `:`, trailing `/`, and
similar - but it does **not** defend against this, because `-D` is
syntactically a valid ref name; the danger is argument-parsing, not ref
syntax. `branch-namespace.sh` rejects any segment starting with `-` before it
ever reaches a git invocation - this is the actual defense, not git.

## Concurrency

Empirically characterized against real, disposable git repositories (never
mocks) - see [`scripts/azure/__tests__/`](../../scripts/azure/__tests__).

| Scenario | Result |
| --- | --- |
| 8 (parameterizable) concurrent `git worktree add` calls, distinct identities, one shared `.git` | All succeed. Git's own ref locking serializes internally (hundreds of ms of real contention observed); **no application-level mutex is needed or used.** |
| Two processes racing to create the identical branch name | Exactly one wins atomically; the loser fails loudly (`cannot lock ref ... reference already exists`) - never corrupts, never silently duplicates. A caller must treat this specific failure as "adopt the existing worktree," not a crash. |
| `git gc --auto` racing a fresh burst of worktree creation | No failures, no corruption (`git fsck` clean) - proven, not assumed; this scenario was untested by anyone before this sprint. |
| Same-OS-user, different simulated identity `HOME`s reading/writing each other's worktrees | No `safe.directory`/ownership friction (see Permissions below). |

## Disk sizing

Measured from this machine's own live analog of the target pattern -
`traycer-remote-mobile`'s own shared clone, currently backing 13 linked
worktrees:

| Component | Measured | Multiplies by |
| --- | --- | --- |
| Shared `.git` (object store, refs) | 34 MB | **once** - not per worktree, not per identity. This is the actual disk-saving property of one shared clone vs. N separate clones. |
| One linked worktree's working-tree files | ~40 MB | **N x M** (every person's every chat) |
| Per-worktree `node_modules` | Not duplicated on disk when the setup script uses bun's content-addressable install cache (symlinks from `~/.bun/install/cache`) - but that cache lives under `HOME`, so it's shared across one person's own chats (M) but **not** across people (N), since each identity has a separate `HOME`. Measured on this dev machine: **1.6 GB** at `~/.bun/install/cache` for one identity's accumulated installs across this project's history. | **N** (not M), ~1.6 GB/identity as an order-of-magnitude figure |

Formula: `disk ~= .git_once + N * (bun_cache_per_identity) + N * M * (working_tree_size)`.

Worked example at N=10 people, M=5 chats each: `34 MB + 10 * 1.6 GB + 50 * 40 MB` =
`34 MB + 16 GB + 2 GB` ~= **18 GB**. The bun-cache term dominates and scales
with N, not with total chat count - the sizing trap this table exists to
name. The 1.6 GB figure is one identity's cache after months of use on this
project specifically, not a universal constant; a fresh identity's cache
starts near zero and grows with what that person actually builds. Size the
production VM's disk against the number of *people*, not the number of
*chats*.

## Stale worktree reclamation

Wraps the existing `traycer-housekeeping` capability rather than building a
new one. `traycer worktree list --json --include-activity` already returns
a `tier` computed by the same shared classifier behind the Settings > Worktrees
pills - that classification is not re-derived here.

`housekeeping-sweep.sh` supplies the one thing that capability lacks: it is
inherently per-`HOME` (hence per-identity), with no fleet-wide view. The
sweep script iterates a configured list of identity `HOME` directories and
runs the existing listing under each.

**Safety floor, inherited exactly, not just the CLI surface:**

- **Report-only, always.** The sweep never calls `traycer worktree delete`,
  `git worktree remove`, or `rm -rf`. Deletion is a separate, explicit,
  per-worktree human decision through the existing skill's own Act step.
- **Tier only, never age.** An actively-working-but-uncommitted agent's admin
  `gitdir` mtime and `HEAD` reflog both stay frozen while files are written
  with no commit - reproduced directly (see `reclamation-safety.test.sh`). A
  three-day-live agent can read as three-day-idle. The sweep never derives a
  removal signal from age; only from `tier`, which already accounts for this
  via `uncommittedCount > 0` forcing `review` and `inUse` as a hard stop.

**Authority for the cross-`HOME` sweep - stated as an open question, not
answered here.** `traycer worktree list` calls `worktree.listAllForHost` over
the host RPC (`clients/traycer-cli/src/commands/worktree-list.ts:141-143`) -
it is **not** a disk-only read. Listing identity X's worktrees requires a
live, authenticated host process bound to X's `HOME`, so the sweep genuinely
does run with `HOME` pointed at each identity's home in turn, touching their
credential store to make the call. This is not a *new* risk - it's a live
instance of the already-accepted same-OS-user risk (any process can already
read any other tenant's credentials) - but *who* is authorized to run this
sweep (a per-identity self-service command vs. a central ops account) is
deliberately left open, routed to A3/A6 as a boundary decision rather than
invented here. What is bounded regardless: the sweep only ever calls the
read-only `worktree.listAllForHost` RPC, never an act-capable one (no
approve/send/reject) - it can enumerate metadata, never act as anyone.

**Cost note for A7 (not an A4 problem):** the CLI's listing path hardcodes
`forceRefresh: true`, so a sweep across N identities forces N full disk walks
plus git/`gh` probes with no cache.

## Missing dependency graph after worktree creation

A linked worktree does not inherit a `node_modules` install - this project's
own `.traycer/environment.json` setup convention (here, `make build`)
provisions it. Already observed to fail silently and read exactly like a code
defect (a missing `node_modules` symlink; `bun install` fixed it). After
provisioning a worktree, run
[`verify-worktree-deps.sh`](../../scripts/azure/verify-worktree-deps.sh),
which checks a **positive expectation** - the workspace member directories
derived from the root `package.json`'s `workspaces` globs - rather than
scanning for existing-but-broken entries, specifically so a nested
`node_modules` that is completely *absent* (not merely a dangling symlink) is
still caught. An earlier version scanned only for existing `node_modules`
directories and checked those for a dangling symlink, which cannot see a
path that was never created - exactly the documented incident - and reported
such a worktree "healthy" (caught in review, fixed; see
`verify-worktree-deps.test.sh`, which regression-tests this exact shape).

**Authority for `eval`-ing the setup command, stated explicitly:** the
self-heal path runs the `setup` command from `<worktree>/.traycer/environment.json`
- a file the protocol describes as "committable & shareable," i.e. controlled
by whoever can commit to that worktree's branch. Executing it is correct
behavior (the Traycer host already does this by design, and agents running
arbitrary code is an accepted risk in this project's decision log), but *who*
invokes this script changes what that execution means: run as per-identity
self-service, a tenant is just running their own committed code under their
own `HOME` - no new authority question. Run by a central ops process across
many worktrees, it executes **each tenant's committed command as ops** - a
sharper version of the same authority question `housekeeping-sweep.sh`
states for its own, read-only case. If provisioning automation invokes this
script centrally, that is itself the authority decision and should be made
deliberately.

## Permissions

Same-OS-user (the deployment's accepted architecture) means `safe.directory`
(the CVE-2022-24765 cross-UID mitigation) has no trigger condition here -
there is only one UID - and cross-user worktree-writability doesn't arise
because there's no second user. Confirmed by `permissions.test.sh`, not
assumed.

**Scope note, and a Windows-testing limitation stated plainly:** this
suite's tests were authored and run on Windows, where there is no OS-level
UID concept to actually vary - the "different identity" simulation is
necessarily just a different `HOME` under the same Windows account, which is
exactly what the real deployment does too (same OS user, different `HOME`),
so the test is a faithful proxy for *that* mechanism specifically. It says
**nothing about credential separation** - that risk is already named and
accepted in the decision log (any process under the shared OS user can
already read any other tenant's `~/.traycer/cli/credentials`); A4 does not
change that.

## Windows development machine vs. Linux deployment target

Built on Windows, deployed on Linux - every finding below was either produced
by or exposed this asymmetry, and is flagged rather than silently ported.

- **Case sensitivity inverts.** NTFS folds `Alice` and `alice` to the same ref
  file; ext4 (the target) does not, so `u/Alice/chat-1` and `u/alice/chat-1`
  would be two distinct, visually-confusable branches on Linux even though a
  case-only collision test would falsely *pass* on this Windows dev machine.
  No test in this suite asserts "collision prevented" for a case-only
  difference - the actual mitigation is that the allow-list restricts to
  `[a-z0-9-]` under a forced `C` locale, sidestepping filesystem case-folding
  reliance entirely, on both platforms.
- **A Windows-reserved device name can pass `check-ref-format` and still fail
  at actual ref creation.** `identityX/con` is accepted by `git
  check-ref-format --branch`, syntactically valid everywhere, but fails on
  Windows with a low-level `Invalid argument` error when git tries to create
  the lock file, because `CON` is a reserved DOS device name. This
  Windows-only failure mode is not assumed to reproduce on Linux, but it
  proved the general lesson this design relies on: `check-ref-format` alone
  is necessary but not sufficient, which is why `branch-namespace.sh` has its
  own allow-list rather than delegating to git's validation.
- **`git remote get-url` can return a different path representation than what
  was passed to `git clone`, on Windows/git-bash specifically** (a POSIX-style
  temp path gets echoed back drive-lettered). This is why
  `provision-shared-repo.sh`'s idempotency is stated as qualified rather than
  unconditional (see Shared clone, above): `provision-shared-repo.test.sh`
  detects this exact case on Windows and reports it as an explicit SKIP with
  a stated reason, never a silent pass. It is *reasoned*, not yet *verified*,
  that this does not occur on the Linux target, where the remote is a real
  URL or a consistent absolute path with no dual representation - re-run
  this test on Linux before relying on idempotency in production. Documented
  rather than "fixed" with normalization logic in the script, since
  normalizing path representations risks masking a genuinely different
  remote.

## Distance from the shipping branch

`traycer-azure-repo-layout` branched from `traycer/traycer-remote-mobile-electric-stork`
at `a6d9bb3d` (0/0 at that point). This sprint added 2 commits on top (the
A4 deliverable, then an executable-bit fix) - **2 ahead, 0 behind** at
hand-off. Re-verify before merging; this is the actual number, not the
pre-commit "0 ahead" this section stated in an earlier draft, which was true
only because none of the sprint's work was in git yet.
