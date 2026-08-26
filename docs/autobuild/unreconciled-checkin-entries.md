# Check-in entries written while artifact sync was down

RECOVERY COPY — and since 2026-08-26, the ONLY copy.

The authoritative epic artifact this file mirrored is
`traycer-remote-teams/autobuild/index.md` under the epic's artifacts
directory. On 2026-08-26 04:23:29 the repair this header warned about ran
and overwrote it — detail in the 08:15 entry below. Until an attended
session reconciles these entries back into that artifact and they survive a
reopen, the artifact is a ~2026-08-11 cloud snapshot: **do not write
check-in entries there** (an edit before reconciliation dies at the next
epic open, measured), and do not read anything it says about 2026-08-12
onward as current. Write here. This file lives on `main` as of 2026-08-26
so the repair cannot reach it and `git pull` delivers it.

## Why it exists — and the risk it was built against has now FIRED

`EpicFileSync` stopped at **2026-08-11 19:15:33**. Every entry below was
written to a disk artifact the cloud never saw again. This header used to
warn: *"the next session to open the epic runs a repair that writes ~210
cloud artifacts OVER the disk. All … unreconciled entries meet that repair
together, so a single event can take all of them at once."*

**That single event happened at 2026-08-26 04:23:26–29** — the first epic
open since 08-11 ran `cloud repair complete liveArtifacts=210
writeCandidates=210`, then `file sync stopped pendingArtifactWrites=0`:
everything came down, nothing went up. The **twenty** entries in this
file survived because they are here; every artifact-only entry did not. The
2026-08-24 04:15 entry counted the artifact pile at **nineteen** while this
file held fourteen, so at least five entries (2026-08-19 → 2026-08-24) plus
every entry written after 08-24 04:15 — including one written eight minutes
before the repair — are gone, except where the 08:15 entry below recovers
them.

**The counts in this section are derived, not carried:** `grep -c "^## 2026"`
on this file → **twenty**. Three count sites remain in this header: this
derivation, the survivor count above, and the one under *What to do now*
(the 08-24 artifact-pile *nineteen* is frozen history — never update it).
Re-derive and update all three, or update none. (The old fifth site — "consecutive
check-ins have flagged this" — is retired rather than updated: the runs of
2026-08-19..26 wrote their flags into the channel that was destroyed, so
that count stopped being derivable the day it was needed most.)

## What to do now (rewritten 2026-08-26 — the old "when sync comes back" branch happened, destructively)

One attended minute, in the desktop app: open the epic, then either paste
the twenty entries below back into `traycer-remote-teams/autobuild/index.md`
(newest-first; the artifact's top entry is currently 2026-08-11 16:15) and
confirm every heading survives a subsequent reopen — or decide this file on
`main` is the permanent record and leave a pointer in the artifact. Only
after one of those, delete this file. A recovery copy that outlives its
emergency is just a second source of truth that nothing keeps honest — but
deleting this one before reconciliation deletes the only copy.

## 2026-08-26 20:15 — quiet hold: the priced map survives upstream's next move, and the WARN storm's 6× step is a watchdog waking, not a person arriving

| Probe | Reading |
| --- | --- |
| `[ERROR]` in `host.log` since rotation (2026-08-25 00:15) | **0** |
| Genuine rate-limiting (level-anchored) | **0** |
| Last provider turn | unchanged — **04:23:27 → 04:23:53**, chat `ee3843e4`, `terminal=completed`; nothing has run since |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | the fork merge (Elliot) and ConvBot S1 grading (Elliot + VM) — both carried |
| Dirty trees attributable to an agent | **none** — every dirty pile across the five live worktrees has **zero** files modified after 16:24 |
| CI on `main` @ `7f0ee0ab` (the tip) | **green — all six workflows**, run created with the 16:15 entry's push |
| `main` vs `origin/main` | **0 / 0** @ `7f0ee0ab` |
| `CredentialLeaseReleasedError` storm | **3,152** at 20:16 (was 1,853 at 16:23) — rate stepped ~60/hr → ~354/hr at 16:33:08; see below |

### The map survives upstream's next move

`upstream/main` moved again (`2635ce3e7` → `4a6b85930`), now **311** in /
our **489**. `git merge-tree --write-tree main upstream/main` → **43**
conflicted paths, and they are the same set the 16:15 map priced: same five
clusters, same two modify/deletes, same 20 `clients/mobile` add/adds.
Re-derived, not assumed — the pricing (four hand-merges + one policy call)
holds at the new tip unchanged.

### The storm's step change is internal, and the tempting read was checked before it was written

The count nearly doubled in four hours, and the hourly grouping shows a
step, not a drift: ~60/hr from 09:00 through 15:00, **147** in hour 16,
~354/hr from 17:00 on. All four Tiptap rooms' `stayed disconnected;
rebuilding provider` loops first appear at **16:33:08.261–.263** — four
rooms inside two milliseconds — and the 16:25–16:35 window contains **no
other line of any kind**: no connection, no subscribe, no INFO. So the step
is a host-internal room watchdog first firing ~12h after the 04:23 epic
open, not a client arriving. Checked because the tempting read — the 16:15
push notification was tapped and someone glanced at the epic — would have
been *evidence the escalation landed*, and it is disconfirmed: nothing
connected. Same root cause, same remedy (the attended minute); until then,
roughly six more WARN lines per minute of pure noise.

### Done this run

| | |
| --- | --- |
| Verification | fleet sweep (roles, `host.log`, five worktrees' status with post-16:24 mtime attribution), CI on the tip, merge re-derivation at the new upstream tip — all read-only |
| This entry | written here, count sites 19 → 20 in lockstep per the header's rule |
| Push notification | **not sent** — a quiet hold plus a noise-rate diagnosis is not new information Elliot can act on; the 16:15 ask stands |
| Build work | **none, deliberately** — the standing goal's next step is still the fork merge, still Elliot's decision; the candidate branch remains one instruction away |

### 🟠 Blocked on Elliot — carried, numbers current

1. **Fork-merge direction** — the 16:15 map holds verbatim at
   `upstream/main@4a6b85930` (311 in / 489 ours / 43 conflicted paths).
   Saying *"run it on a candidate branch"* is enough.
2. **One attended desktop minute** — open the epic, reconcile this file per
   *What to do now*; also restarts the credential lease behind the WARN
   storm, now ~6 lines/min.
3. **Unchanged:** VM start-or-stays-off (deallocated since 08-19 13:16),
   `GUI_APP_RUNNER`, retiring `/`, the Teams app-package install (the
   exempted shortcut), ConvBot S1 grading.

### Survival check on this entry

Born under version control on `main`.

## 2026-08-26 16:15 — the merge priced path by path: four hand-merges and one policy call; the other thirty-eight sides are obvious

| Probe | Reading |
| --- | --- |
| `[ERROR]` in `host.log` since rotation (2026-08-25 00:15) | **0** |
| Genuine rate-limiting (level-anchored) | **0** |
| Last provider turn | unchanged — **04:23:27 → 04:23:53**, chat `ee3843e4`, `terminal=completed`; nothing has run since |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | the fork merge (Elliot) and ConvBot S1 grading (Elliot + VM) — both carried |
| `main` vs `origin/main` | **0 / 0** @ `2c5dc114` |
| `CredentialLeaseReleasedError` storm | **1,853** at 16:23 (was 1,607 at 12:15) — still WARN-only, still the attended-minute dependency |

### What this run adds: the decision is priced, not just measured

Three consecutive runs correctly held the fork merge as Elliot's and correctly
did not attempt it. But the escalation priced it as *"~42 conflicts in 4
clusters"* — a size, not a cost. This run classified **every conflicted path
by what each side actually did since the merge-base** (`8f21d506f`). Nothing
was resolved and nothing was decided; each row is a `git diff --numstat` from
the base to each tip, plus a direct main↔upstream diff where both copies
descend from the same lineage.

Current figures: `upstream/main` moved again mid-run (fetch pulled `988a9a7a`
→ `2635ce3e7`), now **309** in / our **488**; `git merge-tree --write-tree
main upstream/main` → **43** conflicted paths (12:15 counted 42 at the older
tip). The clusters, priced:

| Cluster | Paths | What the diffs say | Side to take |
| --- | --- | --- | --- |
| **Build plumbing** | 4 — `test.yml`, `bun.lock`, root + gui-app `package.json` | ours adds the fork CI matrix / workspace entries; theirs adds their own jobs and deps | union by hand for the three JSONs/YAML; **regenerate `bun.lock` from the merged manifests, never merge it textually** |
| **`clients/shared/host-transport`** | 5 | ours since base is almost entirely the self-alias→relative import rewrite (2-line diffs; `ws-stream-client` also carries stdout-reservation comments for `remote-bridge`); theirs is a big rewrite (`remote-session` +2308, its test +4782, `ws-rpc-client` +326/−144, `ws-stream-client` +662) | **theirs wholesale, then re-run the alias rewrite.** ⚠️ then re-verify the desktop loopback bridge still dials — upstream's remote stack is relay-pinned, and our bridge work sits in these files' *consumers*, which is what the 2-line deltas prove |
| **gui-app extractions** | 4 — `provider-ordering`, `profile-usage-projection`, `rate-limit-envelope`, `provider-profile-model` | ours are extraction stubs (−455/−169/−94/−79; `provider-ordering` on `main` is a re-export whose own docblock says "MOVED to `clients/shared/providers/`"); theirs carry real semantic changes (+124, +42/−18, +33/−11, +30) | **keep the stubs; port their delta into the `clients/shared` copies.** The conflict is the planned upstream contribution arriving as files — do not resolve it by un-extracting |
| **gui-app hand-merges** | 10 | `router.tsx` ours +31 (hash history) vs theirs +84; the mermaid/export/save-blob quartet both-sides-touched but nearly convergent (direct main↔upstream residue 9/9, 8/15, 11/21; only `save-blob-to-disk.ts` is real at 87/61); `index.ts` ours +2 exports; two modify/deletes below | genuine merges, all small |
| **`clients/mobile`** | 20 add/add | ours (98 files) is upstream's 08-24 shell snapshot **plus our 61-file web layer** (`sw.ts`, `teams-host.ts`, push, safe-storage, tools — all ours-only, merge silently). Theirs (109 files) adds ~72 theirs-only Capacitor/iOS files, which **also merge silently** — the add/add set is only the shared-lineage paths where their copy has since evolved | **theirs for the 11 Capacitor/iOS paths** (our copies are stale snapshots of their own lineage — `capacitor.config`, `ios/*`, `dev-ios`, `mobile-runner-host` + test, `vitest.config`); **hand-merge the ~9 web-shell files** where our wiring meets their evolution — `src/web/main.tsx` is the real one (their +192/−275 against our teams-host/pwa-shell wiring), then `vite.config.ts`, `mobile.css`, `package.json`, `tsconfig.json`, `vite-env.d.ts`, `.gitignore`, `AGENTS.md`, `README.md` |

**The two modify/deletes decode cleanly, and one of them was about to be
mis-fought.** `host-picker.tsx`: upstream deleted it in the host-lifecycle
redesign (`22ffa612c`, #1243) — its successor is
`settings/host-scope/host-switcher.tsx` — and our entire modification is **2
lines** (yesterday's launch-config extra hosts, `0b671885b`). Fighting for our
file would resurrect a component upstream retired; the right resolution is
their deletion plus a 2-line re-port into their switcher.
`nested-focus-boundary-lint.test.ts`: upstream deleted the test, we modified
it — one look at *why* they deleted it decides it, and nothing else hangs off
it.

**So the merge's real residue is four hand-merges and one policy call:**
`src/web/main.tsx`, `router.tsx`, `save-blob-to-disk.ts` (+ its test), and
porting four small upstream deltas into our `clients/shared` extractions. The
policy call: post-merge, the fork carries upstream's Capacitor/iOS tree
(~72 inert files). Convergence-architecture says *"we skip native"* — but
deleting them re-manufactures this same conflict surface on every future
upstream merge. **Recommendation: carry them inert; delete nothing.** The
other 38 paths have an obvious side once the clusters above are accepted.

### Done this run

| | |
| --- | --- |
| Verification | fleet sweep (roles, `host.log`, worktree dirt) — all clean, all read-only |
| The map | derived per-path from `8f21d506f` to both tips; commands recorded inline so every row is re-derivable |
| This entry | written here, count sites 18 → 19 in lockstep per the header's rule |
| Push notification | **sent** — the merge is now priced at four hand-merges + one policy call, which is new information, not a repeat of the 08:15 ask |
| Build work | **none** — the merge stays Elliot's, unchanged; a candidate branch is now one instruction away if he wants it built before deciding |

### 🟠 Blocked on Elliot — carried, first item re-priced

1. **Fork-merge direction** — now with the map above. Saying *"run it on a
   candidate branch"* is enough; the map makes it a day's work, not an
   investigation.
2. **One attended desktop minute** — open the epic, reconcile this file per
   *What to do now*; also restarts the credential lease the WARN storm is
   about.
3. **Unchanged:** VM start-or-stays-off (deallocated since 08-19 13:16),
   `GUI_APP_RUNNER`, retiring `/`, the Teams app-package install (the
   exempted shortcut), ConvBot S1 grading.

### Survival check on this entry

Born under version control on `main`.

## 2026-08-26 12:15 — quiet hold: the fleet is verifiably clean, the merge is still Elliot's, and the numbers it waits on drifted while it waited

| Probe | Reading |
| --- | --- |
| `[ERROR]` in `host.log` since rotation (2026-08-25 00:15) | **0** |
| Genuine rate-limiting (level-anchored) | **0** |
| Last provider turn | unchanged from 08:15's reading — **04:23:27 → 04:23:53**, chat `ee3843e4`, `terminal=completed`, idle-eviction 04:33; nothing has run since |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | the fork merge (Elliot, by explicit decision) and ConvBot S1 grading (Elliot + VM) — both carried, not re-litigated |
| Dirty trees attributable to an agent | **none** — every untracked pile mtimes to 08-24 or earlier (electric-stork `scratch/` 08-09..24; focus-truth worktree's `clients/teams-bot`, `clients/teams-help`, `scratch/guiapp-measure` all 08-12; wt-guiapp-main `scratch/` incl. `entry.md`, which is the 08-24 recovery source — keep until reconciliation) |
| CI on `main` @ `b818f7e7` (the tip) | **green — all six workflows**, 2026-08-25 22:30 UTC. `4d273da0`'s pre-commit red was the missing trailing newline the tip commit exists to fix |
| `main` vs `origin/main` | **0 / 0** |
| `CredentialLeaseReleasedError` storm | continuing — **1,607** at 12:15 (was 1,345 at 08:15), still WARN-only, still the attended-desktop-minute dependency, still adjacent noise |

### The one derived fact this run adds: the merge's numbers moved while the decision waited

Re-measured, same commands as 04:15, current tips: `upstream/main` @
`988a9a7a` is **306** commits in (was 299) against our **487** (was 485).
`git merge-tree --write-tree main upstream/main` still exits 1 — **42**
CONFLICT lines across ~40 distinct paths (was ~38). The clusters are the
same four: `clients/mobile` **20** (the adopt-or-contribute question as
files), `clients/gui-app` **11**, `clients/shared` **5**, plus `test.yml`,
`bun.lock`, `package.json`, `traycer-cli`. Nothing about the decision's
shape changed; the conflict surface grows by roughly a path a day while it
waits. Recorded so the next escalation quotes current numbers rather than
04:15's.

### Two standing-record corrections, verified on the trunk rather than inherited

- **The Teams web shell is ON `main`** — `clients/mobile/src/web/teams-host.ts`,
  its test, and `sw.ts` are tracked on the trunk (landed 08-24 via
  `autobuild/next-teams-shell-on-main`). Any note still saying the shell
  lives only on a branch is stale.
- **`traycer/chat-transfer` is fully merged** — 0 ahead of `main`, so the
  electric-stork worktree holds no outstanding branch work; its dirt is
  scratch only.

### Done this run

| | |
| --- | --- |
| Verification | fleet sweep (roles, `host.log`, four active worktrees' status + mtime attribution), CI on the tip, merge-number re-derivation — all read-only |
| This entry | written here, count sites 17 → 18 in lockstep per the header's own rule |
| Build work | **none, deliberately** — same reason as 08:15: the standing goal's next step *is* the fork merge, and that is Elliot's decision, already escalated by push notification. A second notification four hours later would be nagging, not escalating |

### 🟠 Blocked on Elliot — unchanged from 08:15, carried verbatim

1. **Fork-merge direction** (numbers updated above).
2. **One attended desktop minute** — open the epic, reconcile this file per
   *What to do now*; also restarts the credential lease the WARN storm is
   about.
3. **Unchanged from 08-24:** VM start-or-stays-off (deallocated since
   08-19 13:16), `GUI_APP_RUNNER`, retiring `/`, the Teams app-package
   install (the exempted shortcut), ConvBot S1 grading.

### Survival check on this entry

Born under version control on `main`.

## 2026-08-26 08:15 — the repair this file was built against fired once for everything, and what it destroyed included every escalation asking to prevent it

| Probe | Reading |
| --- | --- |
| `[ERROR]` in `host.log` since rotation (2026-08-25 00:15) | **0** |
| Genuine rate-limiting (level-anchored) | **0** |
| Last provider turn | **04:23:27 → 04:23:53 today**, chat `ee3843e4`, `terminal=completed`, idle-eviction 04:33 |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | the fork merge — parked on Elliot **by prior explicit decision**, reaffirmed below, not re-litigated |
| CI on `main` @ `5eeb294c` (pushed 00:28 today) | **green** — all six workflow runs, 2026-08-25 14:29 UTC |
| `main` vs `origin/main` | **0 / 0** — the 08-24 entry's "push" blocker has since been cleared |

The 04:23 turn was the upstream-merge role holder acknowledging the 04:15
run's informational message and correctly taking no action. One caution for
whoever reads its transcript: its reply calls `main @ 5eeb294c` *"stale
relative to the dd6de34e I just pushed"* — that is a resumed session's
2026-08-05 context bleeding through, not a fact. `5eeb294c` is current;
`dd6de34e` is three weeks old.

### 🔴 THE FINDING: at 04:23:26 the first epic-open since 2026-08-11 ran the repair, and every artifact entry since 08-18 is gone

```text
04:23:26.642 EpicFileSync: starting file sync hasDiskSync=true
04:23:26.649 EpicFileSync: cloud repair starting trackedArtifacts=0
04:23:29.884 EpicFileSync: cloud repair complete liveArtifacts=210 writeCandidates=210
04:23:31.849 EpicFileSync: file sync ready trackedArtifacts=210
04:38:53.548 EpicFileSync: stopping file sync pendingArtifactWrites=0
```

Derived check, not carried: a grep for any `2026-08-19` through `2026-08-26`
date across the entire artifacts directory returns **0 files**. Nothing in
the epic's artifacts is newer than the cloud's 2026-08-11 state plus what
the 14 entries here already preserve. `writeCandidates=210` is every
artifact overwritten; `pendingArtifactWrites=0` at stop is the upward
direction confirming nothing was saved.

**What was destroyed:** the artifact pile was **nineteen** at 08-24 04:15
(that entry's own count, recovered below) versus fourteen here — so at least
five entries from 2026-08-19..24 that were never copied to git, plus
whatever the runs of 08-24 08:15 → 08-26 04:15 wrote, including the 04:15
entry this morning, written **eight minutes** before the repair. Also
destroyed: the dated correction that run added to
`convergence-architecture`'s risk 1.

**What survives, and where — recovered this run:**

| Lost | Survives as |
| --- | --- |
| 2026-08-24 04:15 entry | **verbatim** — `scratch/entry.md` in the main worktree; appended below with provenance |
| 2026-08-24 16:15 entry | **incomplete draft** — `scratch/checkin-1615-draft.md` in the electric-stork worktree; appended below |
| 2026-08-26 04:15 entry | **its substance**, verbatim in the message it sent the `Upstream merge into main` role holder; quoted below |
| The code work of every lost run | `main`'s own commits: `8f9785fd`, `9b501868`, `a8ad626d` (08-24 04:15) · `734f5d3b`, `ab65ee68` (08:15) · `a76b76a9` (12:15) · `2d4384dd` (08-25 00:15, the six-hook pre-commit repair) · `5eeb294c` (08-26 00:15) — plus the first fully-green fork Tests run, `32682942738` |
| Everything else — 08-24 20:15, the five 08-25 daytime runs, narrative detail | **unrecoverable**; snapshots dir predates it. Whether those five runs wrote entries at all is unknowable from here |

### 🔴 The consequence nobody had stated: every escalation to Elliot since 08-11 went into a channel that does not deliver

The desktop app renders the **cloud** copy of the artifacts, and the cloud
has been frozen at 2026-08-11 the whole time. Fifteen runs of "blocked on
Elliot" lists — the fork-merge decision, the VM, the entry-pile itself —
were written where he structurally could not see them. The 08-24 04:15
entry's five-item escalation below never existed anywhere Elliot reads.
This file moving to `main` is the fix this run can make; the two-minute ask
was also sent as a push notification, the one channel left that does not
route through the frozen artifacts.

### The 2026-08-26 04:15 entry's substance, preserved from the message it sent (verbatim)

> PR #572 'Mobile app' MERGED into upstream/main on 2026-08-24T14:14:27Z
> (approved, merge commit b8ef446d). The responsive layer is now on
> upstream/main: epic-canvas/mobile = 43 files, hooks/ui/use-mobile-viewport.ts
> present. upstream/main @ 662e4389 is 299 commits ahead of fork main @
> 5eeb294c; fork main carries 485 commits upstream lacks. git merge-tree
> --write-tree main upstream/main = exit 1, ~38 conflicted paths. Clusters:
> (1) clients/mobile — upstream's #572 client (capacitor.config.ts, full ios/
> shell, src/web/main.tsx) collides with our web-shell copy at the same
> paths; this is the adopt-or-contribute question as files. (2)
> clients/gui-app — host-picker.tsx, rate-limits projections, router.tsx,
> nested-focus-boundary-lint.test.ts (our recent fixes). (3)
> clients/shared/host-transport — remote-session, create-remote-transport,
> ws-rpc-client, ws-stream-client. (4) test.yml, bun.lock, package.json,
> traycer-cli credentials-store. The merge was deliberately NOT attempted
> unattended: it decides which mobile client the fork carries, and
> convergence-architecture's retirement table says we skip native while
> upstream's copy includes it. Direction on whether/how to run this merge
> rests with Elliot.

This supersedes the 08-24 04:15 finding's *cost*: the responsive layer is no
longer a 3,743-line fork off an unmerged draft — it is one (contested) merge
away, on upstream's trunk proper.

### 🟠 A WARN storm, scoped so it is not mistaken for the finding

`EpicTokenRefresher: batch threw … CredentialLeaseReleasedError: No live
request context retained for user '3e3d1309…'` — every ~1 minute since
**2026-08-25 05:16:53**, 1,345 occurrences and climbing at write time. Same
needs-an-attended-desktop-session family as the `getTaskCollabTokens` 401
recorded 08-10 (886 occurrences then; that asked for Elliot to
re-authenticate and it never happened). Mechanism consistent with the host
restart at 08-25 00:15 plus token expiry ~5h later, with no desktop session
to re-lease from. **It did not stop the file sync or the repair** — both ran
at 04:23 regardless — so it is adjacent noise for this file's purposes, and
another instance of the same attended-minute dependency, not a new defect.

### ✅ Done this run

| | |
| --- | --- |
| This file | moved to `main` — it lived on two side branches (`autobuild/next-teams-focus-truth` had the newest copy), unreachable from the trunk and invisible to a `git pull` |
| Two lost entries | recovered below, verbatim + draft, with provenance |
| Worktree registry | pruned — `wt-checkin-0826`'s gitdir pointed at a deleted directory |
| Push notification | sent: two attended minutes needed (fork-merge direction; epic-open reconciliation) |
| Build work | **none, deliberately** — the standing goal's next step *is* the responsive layer reaching the trunk, which *is* the fork merge, which is Elliot's decision. Building around it would re-litigate a decision already escalated |

### 🟠 Blocked on Elliot — the standing list, carried forward because its previous copies were all destroyed

1. **Fork-merge direction** — upstream/main @ `662e4389`: 299 in (including
   #572's responsive layer) / 485 ours / ~38 conflict paths in 4 clusters.
   Until then the trunk still cannot render a phone-shaped or
   Teams-mobile-shaped client (the 08-24 04:15 finding, which stands).
2. **One attended desktop minute** — open the epic, reconcile this file per
   *What to do now*. This also restarts the credential lease the WARN storm
   is about.
3. **Unchanged from 08-24:** VM start-or-stays-off (deallocated since
   08-19 13:16), `GUI_APP_RUNNER`, retiring `/`, the Teams app-package
   install (the exempted shortcut), ConvBot S1 grading.

### Survival check on this entry

Born under version control on `main` — the first entry that does not need
the check. The artifact was deliberately not written this run; the reason is
the finding above.

## 2026-08-24 16:15 — RECOVERED DRAFT: the 12:15 push's pending run landed red as a flake, and the fork's pre-commit gate had never once been green

> **Provenance and status:** recovered 2026-08-26 from
> `scratch/checkin-1615-draft.md` (electric-stork worktree, mtime 08-24
> 16:50). A working draft, not the final entry — its `[PENDING — fill in]`
> gaps are preserved as written. The final entry went to the artifact and
> was destroyed 2026-08-26 04:23. The pre-commit work it describes landed as
> `2d4384dd` on `main`. Heading levels demoted one step to fit this file;
> otherwise verbatim.

### Fleet state table
- [ERROR] host.log today: 0
- rate limiting: 0
- last provider turn: unchanged (08-10 20:16; idle-eviction 08-11 19:15)
- blocked/errored/stranded: none
- idle with work outstanding: 1 — ConvBot S1 ungraded (unchanged; Elliot + VM)
- VM: altra-vm-traycer-host-aue still deallocated (az vm list -d, this run)

### Finding 1: the 12:15 push's pending run landed RED, and the red was a flake
- run 32682942738 (Tests @ a76b76a9) failed 12:30 AEST, 15 min after 12:15 entry closed
- 13/14 jobs green; `test (traycer-clients-gui-app)` (shard 1/4) failed in 5m — real test failure shape, not runner starvation
- the failing test's NAME is unrecoverable: nx replays failed-task output at completion and the job log carries only ~93KB of it; no vitest summary line survives. Both the job-log endpoint and the run-logs archive carry the same truncation. Green shards carry NO summary either (nx swallows successful task output)
- discriminated two ways:
  - local: same commit, same shard split (--shard=1/4), vitest under node → 263 files passed | 1 skipped, 2813 tests, exit 0
  - CI: `gh run rerun --failed` at the same commit → GREEN in ~6 min
- so: flake. And the rerun makes 32682942738 the fork's FIRST fully green Tests run ever — gui-app (the Teams client under convergence) has now executed green in CI, all four shards

### Finding 2: pre-commit workflow has NEVER been green on this fork — decomposed and fixed
- run 32682942767 failed; history: failure/cancelled/failure/failure/failure back to 08-10
- six hooks red, decomposition:
  1. workspace-checks (prettier): CI log shows 85 files but the log is TRUNCATED — real churn is 173 files (bun run format locally). Mostly clients/mobile/src/web (the shell merged at a8ad626d was never formatted), teams-bot intake/proactive, shared, remote, remote-bridge, mobile-push-service, traycer-cli posix fixtures
  2. end-of-file-fixer: 7 files (subset of prettier churn) + badge-probe.txt
  3. check-shebang-scripts-are-executable: 50 tracked scripts with shebangs at 100644 → chmod=+x in index (list derived locally, not from the truncated log)
  4. check-json: 6 tsconfigs are JSONC with load-bearing comments (ours; upstream's copies are strict JSON) → excluded tsconfig*.json from check-json (tsconfig is JSONC by spec)
  5. shellcheck: 16 findings, 9 files, all ours (deploy/infra) — fixed each (SC2015 if-then, SC2012 find, SC2086 quoting, SC2028 printf, SC2181 direct check, SC2016 one disable-with-reason on node -e JS)
  6. oss-hygiene: 2 REAL hits (push-envelope-probe.mjs hardcoded C:/Users/<user> chrome path + docstring) — fixed by LOCALAPPDATA + placeholder + REPO derived from import.meta.url. Plus 3 hook false positives: POSIX placeholder lookahead required a trailing `/` (fails at EOL and before quotes — the Windows pattern already knew this), and the email pattern matched Apple @2x.png asset names. Hook patterns fixed as SHAPES; controls planted and all four real-shaped hits still fire (incl. terminal-path /home/<realname> and numeric-prefix /home/12abc)
- badge-probe.txt: stray one-word file ("hello") hitchhiked onto main in 875281d5 — removed
- vendored MicrosoftTeams.v1.25.schema.json: prettier-ignored instead of reformatted (byte-comparable to source)

### Verification
- fast hooks local: eof/check-json/shebang/trailing-ws/exec-shebangs/mixed-le/yaml/private-key ALL pass
- oss-hygiene: clean + 4 planted controls fire
- suites on formatted tree: mobile, teams-bot, mobile-push-service, remote, remote-bridge fully green; shared 1 timeout under 7-way load → solo 15/15 in 20.7s (load-manufactured); gui-app touched files 29/29; traycer-cli touched files 102/3skip
- desktop: 15 failures in 5 files — CONTROL: identical 15 on clean a76b76a9 → pre-existing Windows-environment failures (LaunchAgents, native clipboard flavors, real-subprocess budgets); CI runs desktop on Linux/macOS where green. NOT ours, NOT fixed this run — recorded
- lint + compile: [PENDING — fill in]
- push: [SHA — fill in]; triggered runs: [IDs]

### Memory updates
- fork-ci memory: first green Tests run; pre-commit decomposed/fixed (pending CI confirm)

## 2026-08-24 04:15 — the Teams client's source is on the trunk now, and the thing that makes it a *mobile* client is upstream's and is on neither trunk

> **Provenance:** recovered 2026-08-26, verbatim, from `scratch/entry.md` in
> the main-repo worktree — the run's own copy of the entry it wrote into the
> artifact that was destroyed 2026-08-26 04:23.

Fleet **idle**, checked rather than assumed for the twenty-fourth consecutive
run, and **re-read immediately before the merge**, not only at the start.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** — both readings |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-11 19:15:33**. Nothing has run in **321h** |
| Last `status=running` | **2026-08-10 20:16:14** |
| `claude.exe` processes | **1** — this session, started 04:15:03. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none**. `\b429\b` matches **53** times and **every one is a millisecond field** (`…:31.429]`); anchored on a level (`(WARN\|ERROR).*\b429\b`) → **0**, `too many requests` → **0** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, tip `a38fd692`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

### 🔴 THE FINDING: `main`'s gui-app is desktop-only, so the trunk cannot build a mobile *or* a Teams client at all

**Last run's 🟠 named the wrong subject and was an order of magnitude out.** It
recorded that the web shell — *"`teams-host.ts`, `sw.ts` … **33 files**"* —
lives only on a branch, and concluded *"whether it should be on `main` is a*
*merge decision"*. The shell is the small half and, as the section below
shows, it was never the blocker. The blocker is the **UI**:

| `clients/gui-app/src/components/epic-canvas/mobile` | files |
| --- | --- |
| `main` | **0** |
| **`upstream/main`** | **0** |
| `autobuild/next-teams-focus-truth` (the `/next/` stack tip) | **28** |

`clients/gui-app/src/hooks/ui/use-mobile-viewport.ts` — the 768px hook that
`convergence-architecture` names as **the** core fact the entire plan rests on
(*"upstream's mobile app is `clients/gui-app` made responsive — gated on a*
*768px media query"*) — **does not exist on `main` in any form.** `git grep`
for it, and for `useMobileViewport`, returns nothing.

So `main` carries upstream's **desktop** gui-app. The responsive layer exists
only on `upstream/mobile-app`, i.e. **draft PR #572** — OPEN, `isDraft: true`
since 2026-07-22, `mergeable: CONFLICTING`, reviewed by nobody.

#### Costed, because the decision this hands Elliot is "fork it or don't"

Measured against `upstream/main`, which is what `main` merged:

| | |
| --- | --- |
| The responsive core, **purely additive** — `epic-canvas/mobile/` + `use-mobile-viewport.ts` + `lib/mobile-app.ts` | **30 files, 3,743 insertions, 0 deletions** |
| Existing gui-app files that **wire it in** (non-test, outside that directory) — `app-shell.tsx`, `app-header.tsx`, `sidebar.tsx`, `epic-shell.tsx`, `tile-canvas.tsx`, `tab-strip.tsx`, `settings-surface.tsx`, `landing-composer.tsx`, `notifications-mobile-sheet.tsx`, … | **19 files**, every one of which has drifted on `main` |
| The draft as a whole vs `upstream/main`, gui-app only | 376 files, +14,378 / −18,084 |
| Our snapshot of the draft | **116 behind** it, 87 ahead |

**3,743 lines is the floor, not the price.** The 19 wiring sites are the part
that cannot be copied: they are edits to files `main` has moved 509 commits
past. This is the first time this epic has put a number on
`convergence-architecture`'s risk #1 (*"tracking a long-lived side branch"*),
which fired on 2026-08-10 and has sat for fourteen days.

**What it means for the standing goal, stated plainly.** *"Full UI fidelity*
*with the Traycer Remote mobile PWA"* cannot be reached from `main` today —
not for want of features, but because the phone-shaped layout is not there.
A Teams **desktop** tab is a wide iframe and would render correctly from the
trunk; **Teams mobile, and the PWA, would not.**

### ✅ Built, gated and merged: the shell itself IS portable — `8f9785fd` + `9b501868`, `main` `00d7e870` → **`a8ad626d`**

Having found the real blocker, the answer to last run's actual question is
worth having, and it is the opposite of what "a merge decision" implied.
**`clients/mobile` now sits on `main` and is green there.**

The shell's whole coupling to gui-app is **twelve import paths**, and
**ten of them resolve on `main` unchanged**; the other two (`@/lib/persist`,
`@/lib/host`) are directories with an `index.ts` and resolve too. What was
missing was not upstream's — it was **ours**, four changes we made to gui-app
and `clients/shared` and never brought to the trunk:

| Ours, absent from `main` | |
| --- | --- |
| `lib/mobile-app.ts` | 34 lines — the mobile-app mode flag |
| `header/host-picker-extra.ts` | 27 lines — a slot for a shell that owns its own host list |
| `theme-applier.ts` | +53/−2 — `setHostThemeOverride`, so a Teams tab's own light/dark outranks the OS media query |
| `IWorkspaceFoldersHost.canPickNatively` | +7 — a shell with no native folder dialog routes through the RPC picker |

**The typecheck named the entire cost, and it was four lines.** With the two
new modules and the two patches applied, `tsc -b clients/gui-app` returned
**exactly four errors, all `TS2741 canPickNatively is missing`** — the
mechanical implementers. Nothing else. A file set 526 files and 509 commits
newer than the snapshot the shell was written against, and it fit.

`canPickNatively` is a **required** member, so every implementer had to
answer. All four on `main` are desktop-style shells and say `true`, which
makes the change **inert for every surface `main` has today** — the same
"divides a measured extent, changes nothing where it isn't needed" shape as
the split-affordance rule, and the reason it is safe to land ahead of its
consumer.

#### The slot needed a door, and this is the shape that reaches a user as nothing

`registerHostPickerExtra` is a module-level setter returning `void`. **A
`<HostPicker />` that never called the getter would be indistinguishable from
the shell's side** — no error, no return value, nothing to branch on. It
would surface only as *"the Manage hosts button isn't in the Teams tab"*, on
the one surface nobody can attach a debugger to. Same family as this epic's
`onOpenArtifact={() => {}}` and its most-repeated bug, *"the button did
nothing"*.

So the slot is rendered in `host-picker.tsx`, and the test asserts **placement,
not presence** — the docblock promises *under the host list*, and a node
rendered into the wrong subtree still satisfies `getByTestId`.

`node clients/gui-app/tools/mutate-host-picker-extra.mjs` → **2/2 caught**:

| Mutation | Result |
| --- | --- |
| the slot is never rendered — registration silently dropped | **caught**, and the no-registration control stayed green |
| the slot renders **above** the list instead of under it — the node IS there, only misplaced | **caught** by the `compareDocumentPosition` assertion alone |

**The probe's first run reported `SURVIVED` and was wrong about itself, in
both arms.** MUT-1 read `reddened=false controlGreen=false` — *nothing*
matched, including the test that must pass, which is the harness indicting
itself rather than a weak suite. Cause: it shelled out to `npx vitest`, and
`npx` here resolves against its own view of the tree and emits a startup error
that looks in a scroll-back exactly like a suite that failed to catch the
mutation. (Recorded before for `npx tsc`: *"This is not the tsc command you*
*are looking for"*.) MUT-2 then aborted on `target appears 0 times` — its
anchor assumed the slot preceded the list when it follows it. **Both were
probe defects and neither was visible from the verdict**; only the pair
*"the control also failed"* separates them from a real survival. Fixed to
invoke the workspace's own `vitest.mjs` through `node`.

#### Two defects the port surfaced that only a different tree could show

| | |
| --- | --- |
| **An undeclared direct dependency** | Three of the shell's test files `import "@testing-library/react"` and its `package.json` never declared it. On the `/next/` stack it resolved by **hoisting** from gui-app; on `main`'s tree it does not hoist and the typecheck fails with three `TS2307`s. Declared. A dependency that works only by hoisting is green until the tree around it changes — and the tree around it had not changed in three weeks |
| **The last `--fix` in the workspace** | The package shipped `eslint . --cache --fix --max-warnings 0` — the write-as-gate defect repaired everywhere else at `20cb8265`, surviving here because this package has been outside every repair since the pivot. Nine other packages: `--fix` in **one**, this one. Removed. Non-vacuous after: **51 files linted, 0 messages** |

### 🔵 The gate written last run went red on this run's commit, which is the first thing it could have caught

`protocol/__tests__/ci-test-matrix-coverage.test.ts` landed at 00:15 against a
list that had drifted **three** times. Adding `@traycer-clients/mobile` to the
workspace turned it red immediately, naming the package and `test.yml`:

```
These projects own a `test` script and have no job in .github/workflows/test.yml,
so their tests never run in CI: @traycer-clients/mobile.
```

Entry added by hand, as the gate's own comment asks. **This is the first time
in this log a gate has caught a real omission on its own next commit** rather
than being written after the fact about a defect already found by reading.

Worth stating precisely what the package's CI history was, since "no job here"
undersells it: the `/next/` stack's own `test.yml` **also** omits it, *and*
that workflow triggers only on `pull_request` or `push` to `main`, so on that
branch it has never run at all. **22 test files and 329 tests that had
executed in no CI, on any branch, ever.**

### 🟠 Two deliberate deviations, recorded rather than buried

1. **25 Capacitor/iOS files landed on `main` verbatim**, against
`convergence-architecture`'s retirement table (*"nothing — we skip native"*,
*"We do NOT adopt their `clients/mobile`"*) — a 20-file Xcode project,
`capacitor.config.ts`, `scripts/dev-ios.ts`, and six `@capacitor/*`
dependencies. **Taken knowingly, and the reason is that trimming is the
riskier option:** the deployed `/next/` bundle is built from the stack's copy
of this package, so a trimmed copy on `main` would be a *different* package
from the one that ships — gates on `main` would stop gating what a user runs,
which is the double-development trap this whole pivot exists to escape.
Verbatim keeps the file sets identical, which is the property that lets the
stack be retired later. The files are inert: nothing builds them and no CI job
touches them, and `git rm` reverses it in one command once the stack is gone.
2. **43 of the shell's files are not prettier-clean**, so the standing
`format` hold's number moves **187 → 230**. Not reformatted, for the reason
the hold already gives *and* one this run adds: a mechanical reformat here
would diverge `main`'s copy from the stack's, i.e. deviation 1's hazard by
another route.

### Checked non-findings

| Predicted | Measured |
| --- | --- |
| **gui-app's markdown links navigate the Teams iframe away**, the defect fixed in `clients/teams-tab` whose fix was deleted with the package | **False — upstream already has a stronger policy than ours did.** `markdown-anchor.tsx` `preventDefault`s **every** classified href and routes externals through `runnerHost.openExternalLink`; `links/classify-href.ts` is a documented scheme-plus-`:line:col` classifier with `file`/`external`/`ignore`/`default` arms. Nothing falls through to a real navigation. This was the highest-value carry-over candidate from the retired package and there is nothing to carry |
| The desktop suite is red because of `canPickNatively` | **False, and the counts nearly said otherwise.** Branch: 10 files / 18 tests failed. Clean `main`: **5 files / 15**, then **6 / 16** on an immediate re-run — the baseline is unstable on this box. The discriminating comparison is the failing **set**, and the branch's is `{host-login-item, json-file-store, traycer-cli-idle-timeout-integration, native-clipboard-file-paths, host-health-monitor}` — **a subset of the baseline's**, all macOS/timing-shaped, none touching `desktop-runner-host.ts`. Positive control on the file actually changed: `src/renderer-shell/__tests__/` **3 files, 58 tests, exit 0** |

### Gates

`main` at the merge tip `a8ad626d`, re-run **after** the merge rather than
trusting the pre-merge run:

| | |
| --- | --- |
| `tsc -b` across all ten projects | exit **0** |
| `clients/mobile` vitest | **22 files, 329 passed**, exit 0 |
| `clients/gui-app` shard 1/4 | **264 files, 2,810 passed / 1 skipped**, exit 0 |
| `clients/shared` vitest | 85 files, **1,158 passed / 1 skipped**, exit 0 |
| `protocol` CI gates (matrix + runner labels) | **6 passed**, exit 0 |
| `eslint --max-warnings 0` — gui-app, shared, desktop, mobile | exit **0** each |
| `prettier --check` on every changed file | clean |
| `clients/mobile` typecheck **read** | **4,866 files, 49 of them the package's own**, 1,928 gui-app — not a `files: []` green |
| working tree | **clean** |
| `main` vs `origin/main` | **24 ahead** (was 21; this run added 3) |

⚠️ **`gitleaks` was NOT re-run and this is weaker than the last two entries.**
The binary is not on `PATH` in this session and was not installed — installing
one is outward-facing. Substituted: a pattern scan of every added text file
(`api_key|secret|token|password|BEGIN … PRIVATE KEY|sk_live|ghp_`), which
returns **only identifier names** (`tokenStore`, `record.token`) and no
literal values. **That is a weaker instrument than the scanner and is labelled
as one** — it walks the working tree, not the history, and it has no entropy
rule. The added binaries are four PNG icons and an Xcode asset catalogue.

⚠️ **Two harness notes.** `prettier` exists here **only** as a bun shim
(`node_modules/.bin/prettier.exe`); there is no `prettier.cjs` to invoke
through `node`, so `bun x prettier` is the only form that works. And
`tsc -b clients` fails with `TS5083` — `clients/` is not a solution root;
projects must be named individually.

### 🟠 Blocked on Elliot — five, and the first one changed shape today

1. **Decide the responsive layer.** Fork upstream's 30-file / 3,743-line
   `epic-canvas/mobile` layer plus 19 wiring sites onto `main`, keep tracking
   draft PR #572, or ask traycerai for a timeline. **Until one of those, the
   trunk cannot produce a phone-shaped or Teams-mobile-shaped client at all.**
   This supersedes the 08-10 escalation with a number attached.
2. **Push.** `origin/main` is **24 behind**; nothing pushed since 2026-08-10.
   Every repair in this log, including the CI fix that would finally make a
   green run possible, is invisible until it is.
3. **Decide `GUI_APP_RUNNER`** — unchanged; doing nothing now also works.
4. **Start the VM — or say it stays off.** Deallocated 08-19 13:16, now
   ~111h. **Not re-read this run**: nothing here depended on it.
5. **Retire `/`**, the **Teams app package install** (the exempted shortcut),
   and **`autobuild/conversational-bot` parked on H1** — unchanged.

### Survival check on this entry

⚠️ Written into the same KNOWN-DOWN sync window, now **~321h** deep.
`EpicFileSync` stopped **2026-08-11 19:15:33**; last `cloud repair complete`
still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward. **This entry is on disk only.**

**Answering the 00:15 entry's PENDING:** it **survived its first reading** —
pre-write size was 398,545 B, the file was **413,261 B** when this run opened
it, and its entry is intact. The second reading is unavailable for the same
reason as its ten predecessors: no `cloud repair complete` since 2026-08-11,
so what is established is *"not yet overwritten"*, not *"survived a repair"*.

🟢 **The pile is now NINETEEN.** **Not re-escalated** — restarting sync needs
an epic opened in the desktop app, still one attended minute, still impossible
unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **413,261 B**.


## 2026-08-18 20:15 — the standing goal names a reference surface that was archived thirteen days ago, and four runs missed it while flagging the other half of the same sentence

Fleet **idle**, checked rather than assumed for the nineteenth consecutive run,
and re-checked at **20:31 — before the write**, not only at the start
([[liveness-read-expires-recheck-before-push]]).

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-11 19:15:33**. Nothing has run in **169h** |
| Last `status=running` | **2026-08-10 20:16:14** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none**. Timestamp-stripped `\b429\b` → **0** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

### 🔵 The DNS fix ran for the first time, and this run cannot say it worked

The check-in fired at **20:15:03** and reached the API. The preflight wrote no
`api unreachable at start` line, so `Test-ApiReachable` passed on its **first**
probe and neither the wait loop nor the retry loop executed a single iteration.

That is the fix's pass arm, not its repair arm. **A run that succeeds while the
fault is absent measures nothing about the fix** — it is the middle state of
[[measurements-need-three-states]], and the honest reading is *"the network was
up"*, not *"the fix works"*. What the 16:15 entry did establish stands on its
own evidence: the predicate was replayed against the eleven real dead logs and
fired on all eleven, and against a constructed productive body quoting
`ENOTFOUND` and did not. That is the discriminating test; this run is not one.

### 🔴 THE FINDING: both sides of the parity sentence are archived, and only one side was ever noticed

The standing goal in the check-in prompt reads:

> the Teams client must reach full UI and functional fidelity with the Traycer
> Remote mobile PWA

Four consecutive runs (08-14 12:15, 16:15, 20:15, 08-18 16:15) have flagged that
the **subject** of that comparison — `clients/teams-tab` — exists on neither
lineage. **Nobody checked the reference.** It is gone too.

| `clients/mobile/src`, files under version control | count |
| --- | --- |
| `main` | **0** — the package is absent from `clients/` entirely |
| `autobuild/next-teams-focus-truth` (the `/next/` stack tip) | **53**, and every one is the browser shell: `src/web/` (22 modules + tests), `mobile-runner-host.ts`, `index.ts`, `vite-env.d.ts` |
| `archive/clients-mobile` (tag `e41bbcd7`) | **256** — `App.tsx`, `app-shell.tsx`, `views/`, `router/`, `host/`, `components/`, the whole PWA |

`git ls-tree --name-only main -- clients/` returns ten packages and
`clients/mobile` is not one of them. The 53 files on the stack tip are a *shell*,
not a client: `clients/mobile/src` at the tip contains exactly `index.ts`,
`mobile-runner-host.ts`, `vite-env.d.ts` and `web/`.

**So the mobile PWA's UI has no source on any live branch.** It survives as a
deployed bundle at `/` (200, entry `assets/index-BoMwHhjL.js`) built from a
commit reachable only through an archive tag.

#### Why this changes what the next run should do, rather than being trivia

`/next/` renders `TraycerApp` from `clients/gui-app` —
`clients/mobile/vite.config.web.ts` sets `root: src/web` and aliases `@` →
`gui-app/src`, and `main.tsx` mounts upstream's component. **There is no second
UI implementation left to diverge from.** On the source side, "full UI fidelity
with the mobile PWA" is not a gap that can be closed by feature work; it is a
property the convergence pivot already made true by deleting the alternative.

The two live surfaces confirm they are different *builds* rather than different
*intents* — and the shared chunk is the control that keeps this from being a
statement about cache-busting:

| | `/` | `/next/` |
| --- | --- | --- |
| entry | `index-BoMwHhjL.js` | `index-BzMfybHh.js` |
| app chunks | `kind-tokens`, `yjs` | `jsx-runtime`, `draft-runtime-registry` |
| `v4-DDdyfk2q.js` *(vendor control)* | present | **same hash** |

**A copy marker would have been the wrong instrument here and was discarded
mid-run.** "Agent selection" is a gui-app settings label, so it looked like a
clean discriminator — and `git grep` finds it in
`archive/clients-mobile:clients/mobile/src/views/toolbar/settings-screen.tsx`
too. The PWA was a *reimplementation* of gui-app, so it shares gui-app's words
almost everywhere. [[control-keyed-on-copy-measures-the-copy]] in its most
literal form: two different applications, one vocabulary.

#### What is actually left, stated so it is not confused with parity work

1. **Deployed parity is not satisfied and cannot be closed by building
   anything.** `/` serves the old PWA; `/next/` serves gui-app. Someone opening
   both today sees two applications (the contract's own `#root` counts, 677 vs
   4482, are the same fact measured earlier). The only move that closes it is
   **retiring `/`** — pointing it at the `/next/` build, or taking it down.
   That is Elliot's call, not an unattended one, and it is the single decision
   that would let this epic's standing goal be marked done.
2. **Shell adaptation is the only thing that can still differ**, and both of its
   halves are now swept. The frame half was declared complete at 08-14 20:15.
   The `IRunnerHost` half is swept below, this run, and comes out clean.

### ✅ The second sweep, and it is the one that says the shell is finished

The 08-14 20:15 entry closed the *frame* class. The class it did not open is the
one the interface itself warns about — `runner-host.ts` documents that shells
lacking a native capability *"install a no-op implementation whose event
emitters never fire or whose picker returns an empty selection. Callers never
branch on `null`."* That is the "button did nothing" defect promised in a
docblock, and `web-notification-host.ts` already came out of it once.

Every degraded member of `MobileRunnerHost`, read rather than assumed:

| member | web shell | can a Teams tab differ from a browser tab? |
| --- | --- | --- |
| `tray` | `MobileNoopTrayState` | no — unconditional field initialiser |
| `workspaceFolders` | `canPickNatively: false`, `pickFolders → []` | no — object literal |
| `fileDrops` | all three methods → `[]` / identity | no — object literal |
| `zoom`, `service`, `traycerCli`, `migration`, `hostManagement`, `hostTray` | `null` | no — and callers must branch, TypeScript enforces it |
| `getRegisteredUrlSchemes` | `→ []` | no — documented as "offer nothing native" |
| `requestMicrophoneAccess` | `→ "granted"` | no |
| `openMicrophoneSettings` | resolved no-op | no |
| `onAuthCallback` | dead `Disposable` | no — documented, "sign-in still completes poll-only" |
| `hasLocalHost` | `false` | no |

**Every one is a constructor-level constant with no input from the frame.** That
is the whole result: none of them can produce a Teams-vs-browser difference, so
none of them is a parity defect. The capabilities that *do* read the frame are
exactly the eight the last ten runs found and fixed.

**Two Capacitor imports exist in the whole tree** (`@capacitor/browser`,
`capacitor-secure-storage-plugin`, both in `mobile-runner-host.ts`) and
`vite.config.web.ts` aliases **both** to the shim. `clients/gui-app/src` and
`clients/shared` import Capacitor **nowhere**. There is no unaliased native
dependency hiding in the web bundle.

### 🟠 A checked non-finding, filed with its reasoning so it is not re-derived

**The "Open Settings" button in the dictation-failure toast is dead on every
browser surface, and this run deliberately did not build it.**

`use-composer-dictation.ts:61` offers a toast action labelled *"Open Settings"*
whose `onClick` calls `runnerHost.openMicrophoneSettings()` — a resolved no-op
in `MobileRunnerHost`. On a genuine user denial the user taps it and **nothing
happens**: no navigation, no message, no error.

Three reasons it stays unbuilt, in order of weight:

1. **It is not a parity defect.** `/` and `/next/` share `MobileRunnerHost`, so
   the mobile PWA has the identical dead button. Against a goal defined as
   fidelity *to* that PWA, this is a shared defect, not a divergence.
2. **The 08-12 microphone work already met this branch and kept it on
   purpose.** `microphone-seam.test.tsx` carries a test named *"CONTROL: a real
   user denial on a granted surface still says so, and still offers Settings"*.
   The policy case was re-described precisely so `permissionDenied` stays false
   and the button is never offered *for a setting that does not exist*; the
   genuine-denial case was left propagating, deliberately.
3. **Its honest repair is an upstream UI change, not a shell adapter.** No
   browser exposes a site-settings deep link, so the shell cannot make the
   button work — only gui-app declining to offer an action the host cannot
   perform would fix it. That is the same call already parked twice as the
   popup recovery: **a decision, not a task.**

Reachability, stated rather than assumed: the mic renders only when
`useDictationAvailability` reports ready, which is driven by the host's
`speech.getModelStatus` RPC. So the path is gated on *host* state this run
cannot read — reachable in principle, unverified in fact. Not a structurally
dead branch, and not a demonstrated live one either.

### 🔵 A small correction to the parity contract's own recovery instruction

The contract's header says the retired packages went to *"branches **and** tags,
pushed"*. The tags are real and pushed — `git ls-remote origin` lists all eight
`refs/tags/archive/*`, dereferencing to the right commits. **The branches do not
exist**, locally or on `origin`: `git for-each-ref refs/heads refs/remotes` |
archive → nothing.

Not a hazard — `git checkout archive/clients-mobile -- clients/mobile` works
against a tag, so the documented restore is correct. Worth one line only because
a tag is deletable by anyone with push and is not protected the way a default
branch is, and the sentence tells a reader there are two copies when there is
one.

### Gates

Run against the `/next/` stack tip (`c95722b1`), because that is the lineage the
served bundle is built from:

| | |
| --- | --- |
| `clients/mobile` vitest | **22 files, 329 tests, all passed** (32.4s) |
| `tsc -b --force` | exit **0** |
| files the typecheck actually read | **4,841**, of which **45** are the package's own |

The file count is the guard against the solution-style `files: []` trap this
epic has hit before — `exit 0` alone would not distinguish a clean check from a
check of nothing ([[hollow-green-checks]]).

Nothing was committed to the source tree this run: the sweep found no defect
that was both a parity gap and an unattended-safe fix.

### Not done, deliberately

1. **Not pushed.** `main` is **14** ahead of `origin/main`, unchanged; this run
   added nothing to that count.
2. **`/` not retired.** The one action that would close the standing goal, and
   the one this run is least entitled to take unattended. Raised to Elliot
   above.
3. **The popup recovery**, **the app package**, and
   **`autobuild/conversational-bot` on H1** — unchanged, all three still
   Elliot's.
4. **The parity contract's capability table not edited.** Its rows still
   describe `clients/teams-tab`. Raised for the fifth run running; still owned
   by the "Teams Tab Surface" role holder, and resolving that holder at run time
   still returns nobody. **This entry adds the reference-side half of the same
   problem rather than rewriting the table** — whole-file rewrites reverted it
   four times on 08-03.

### Survival check on this entry

⚠️ Written into the same KNOWN-DOWN sync window, now **~169h** deep.
`EpicFileSync` stopped **2026-08-11 19:15:33**; last `cloud repair complete`
still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward.

**Answering the 16:15 entry's PENDING:** it **survived on the first of its two
readings** — pre-write size was 341,064 B, the file is now 351,791 B and its
entry is intact on disk. The second reading is unavailable for the same reason
as its five predecessors: **no `cloud repair complete` has occurred since**, so
what is established is *"not yet overwritten"*, not *"survived a repair"*. Five
entries deep, that distinction has never once been closable.

🟢 **The pile is now FOURTEEN.** **Not re-escalated** — restarting sync needs an
epic opened in the desktop app, still one attended minute, still impossible
unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **351,791 B**.

## 2026-08-18 16:15 — the check-in has been dead for three and a half days, the log said "SUSPECT" eleven times, and nothing was listening

Fleet **idle**, checked rather than assumed for the eighteenth consecutive run,
and re-checked at **16:24 — before the commit**, not only at the start
([[liveness-read-expires-recheck-before-push]]).

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-11 19:15:33**. Nothing has run in **165h** |
| Last `status=running` | **2026-08-10 20:16:14** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none**. Timestamp-stripped `\b429\b` → **0** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

**There was no agent to unblock. The thing that was blocked was the check-in
itself**, and it had been blocked since the last entry was written.

### 🔴 Eleven consecutive runs died on DNS — ~44 hours — and the box was awake for every one

| | |
| --- | --- |
| Dead runs | **11**, `2026-08-15 00:15` → `2026-08-18 12:15` |
| Every one | `API Error: Unable to connect to API (ENOTFOUND)`, one line, exit 1 |
| Every verdict | `SUSPECT: only 1 lines of output` |
| Commits produced | **0** |

This is the 2026-07-31 seven-run outage in a new costume, and the mitigation
written for that one **worked and was not enough**. The `$Verdict` line added
then correctly refused to call these runs productive — it said `SUSPECT`
eleven times. But `SUSPECT: only 1 lines of output` **does not name a cause**,
and nothing reads the log unless a human opens it. Detection without an
actor is a slower version of the same silence.

**The box was not asleep, and that is the reading that changes the diagnosis.**
`host.log` logged continuously through every one of those minutes — 24–28 lines
in each check-in's own minute. The one genuine sleep window
(**08-15 08:18 → 08-17 09:04**, zero host.log lines, 08-16 absent entirely)
produced **no check-in logs at all**, which is correct behaviour and is the
control: a sleeping box does not fire the task, so a task that fired and died
was not sleeping. Eleven fires, eleven deaths, machine up.

**What the root cause is, honestly.** Not established, and not recoverable: the
System event log only reaches back to **2026-08-18 04:04**. Within that window
there is exactly one `Tcpip 4266` — *ephemeral UDP port exhaustion* — at
**08:01:24**, 14 minutes before the 08:15 death. DNS is UDP, so it is the right
*shape*. It is **not** the explanation: the 04:15 run also died, inside the
retained window, with no 4266 anywhere near it. **One event explains at most one
of eleven.** Recorded as a lead, not a finding. Live readings now: 46 UDP
endpoints against a 16,384-port pool, `api.anthropic.com` resolves and connects.

Also live and worth naming for whoever does chase it: **Tailscale holds DNS
tailnet-wide** (`accept-dns=true`, `tailscaled` in the path for every lookup on
this box, interface metric 5 against Wi-Fi's 30). A resolver that is up but not
resolving is exactly this failure's shape. Not accused — measured as present.

### ✅ Fixed, and the fix does not depend on knowing the cause — `e0768e96`, merged `75a704d1`

Whatever takes DNS away, a check-in that waits for it back loses minutes rather
than days. Three parts, each with the trap it avoids:

1. **A reachability preflight**, up to 30 minutes. The probe is a **TCP
   connect**, not `Resolve-DnsName` — `ENOTFOUND` *is* a resolver failure, and a
   name lookup can answer out of **cache**, returning green for the exact
   condition being tested for. A probe that passes when the fault is present
   measures nothing ([[measurements-need-three-states]]).
2. **Up to three attempts**, retried only when an attempt produced almost no
   output **and** names a connection error.
3. **The network verdict is evaluated first**, off the **last attempt** rather
   than the whole body.

**Both (2) and (3) are load-bearing, and both were verified by the arm that
could fail rather than the arm that agrees:**

| arm | body | predicate | note |
| --- | --- | --- | --- |
| the **11 real dead logs** | 1 line | **retry ✅ fires** | verdict now reads `NO-OP: NO NETWORK` |
| **3 real productive logs** | 27 / 41 / 45 lines | retry ✗ | *non-discriminating* — none contain the marker |
| **productive body quoting `ENOTFOUND`** | 30 lines | **retry ✗** | a body-wide grep reads **fires**. The size term is what saves it |
| **padded no-op**, 3 attempts + 2 retry notices | **exactly 5 lines** | — | size rule alone → `"ran, 5 lines of output"` |

**The third arm had to be constructed, because the real productive logs do not
discriminate** — none of them contain the phrase, so they pass with or without
the size term. **This very entry contains `ENOTFOUND` repeatedly**, so the run
that reports this fix would have been retried three times by a body-wide grep.
That is the identical trap the rate-limit verdict already records having fallen
into in 2026-08-01, and it was one edit away from being re-made.

**The fourth arm is why the retry loop nearly broke its own reporting.** `$Body`
spans all attempts, so three dead attempts plus two retry notices is **five
lines** — and the size rule reports five lines as a working run. *The fix for
the silent no-op would have reintroduced the silent no-op.* `$DiedOnNetwork` is
read off the last attempt alone, which is the only term that still means
anything once retries can pad the body.

**Where the fix had to land is itself a finding.** The scheduled task runs from
the `traycer-...-electric-stork` worktree, pinned to `traycer/chat-transfer` —
which is **409 commits behind `main`** ([[checkin-worktree-is-behind-main]], and
worse than that note implies). **A fix committed only to `main` would never have
reached the task.** So it was committed on the running branch first and merged
up. Three-way hash, because the file the task reads is the only one that counts:

```
on disk, running tree   d1efcf52…
committed HEAD blob     d1efcf52…
main blob               d1efcf52…
```

**I nearly recorded "409" as "12".** The first read was `git log --oneline
HEAD..main | head`, which showed ten lines and agreed with the known
`origin/main..main` count of 12. `head` truncating a count into a plausible
wrong number is [[pipeline-masks-exit-status]] in a new form: the pipe did not
hide a status, it hid a *magnitude*, and the wrong value was credible because
another true number matched it.

### 🔵 Correction made mid-run: `--is-ancestor` is the wrong instrument on a dist branch

Checking whether the two Teams-theme fixes reached the deployed bundle, I ran
`git merge-base --is-ancestor <sha> demo/upstream-mobile-next-dist` and got
**ABSENT for all five** — including `1055ab78` and `d2dc7b3c`, which the 08-14
entry had **verified as served** by three-way sha256 and content markers.

The contradiction is the instrument, not the deploy. **A dist branch carries
built assets; the source commits are not its ancestors**, so reachability is
structurally guaranteed to read ABSENT for a correctly deployed fix. Five
confident, well-formed, entirely meaningless readings
([[structural-checks-pass-well-formed-wrong]]). Discarded rather than reported.
The 08-14 entry's content-and-hash method is the right one and stands.

### 🔵 Nothing else moved, and that is measured

The queue was **ZERO** at 08-14 20:15. It still is, and not by assumption:

```
main                              8fa892d1   2026-08-14 (before this run)
demo/upstream-mobile-next-dist    92b1503d   2026-08-14 20:23
autobuild/next-teams-focus-truth  1a5f5453   2026-08-14 20:36
autobuild/conversational-bot      a38fd692   2026-08-10 20:09
```

**Newest commit anywhere in the repo before this run: 2026-08-14 20:36.** Eleven
dead check-ins and an idle fleet produced zero commits between them, so there is
no new source work waiting to deploy and no drift to reconcile. The deploy queue
is still zero because nothing has been built to put in it.

### ⚠️ The recovery pile is not on the trunk

`docs/autobuild/unreconciled-checkin-entries.md` — the mitigation the last four
entries rely on for surviving the sync outage — exists **only on
`autobuild/next-teams-focus-truth`**. `git ls-tree main -- docs/autobuild/`
returns **nothing**. The safety net for the KNOWN-DOWN sync is itself on an
unmerged branch, so a reader on `main` cannot find it. Appended to anyway
(entry **thirteen**), because that is where the other twelve are; **flagged
rather than moved**, since relocating it is a merge decision on a stack whose
owner is the `/next/` lineage, not this run.

### Not done, deliberately

1. **Not pushed.** `main` is **14** ahead of `origin/main` (12 + this fix).
2. **The popup recovery** — unchanged, still a decision rather than a task.
3. **The app package not rebuilt** (the exempted shortcut);
   **`autobuild/conversational-bot`** still on H1, still Elliot's one minute.
4. **The parity contract and tickets index are still written against
   `clients/teams-tab`**, a package on neither lineage. Raised 12:15 08-14,
   unchanged at 16:15, 20:15 and here. Resolving the "Teams Tab Surface" role
   holder at run time still returns nobody.
5. **The root cause of the outage.** Deliberately not chased past the evidence —
   the log that would settle it is gone, and a guess written down reads like a
   finding to the next run.

### Survival check on this entry

⚠️ Written into the same KNOWN-DOWN sync window, now **~165h** deep.
`EpicFileSync` stopped **2026-08-11 19:15:33**; last `cloud repair complete`
still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward.

**Answering the 08-14 20:15 entry's PENDING:** it **survived on the first of its
two readings** — pre-write size was 327,417 B, the file is now 341,064 B and its
entry is intact on disk. The second reading remains unavailable for the same
reason as its four predecessors: **no `cloud repair complete` has occurred
since**, so what is established is *"not yet overwritten"*, not *"survived a
repair"*. Four entries deep, that distinction has never once been closable.

🟢 **The pile is now THIRTEEN.** **Not re-escalated** — restarting sync needs an
epic opened in the desktop app, still one attended minute, still impossible
unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **341,064 B**.

## 2026-08-14 20:15 — the fix built to be read back off a live tab was read back and it works, and the instrument that read it had been dead since lunchtime

Fleet **idle**, checked rather than assumed for the seventeenth consecutive run,
and re-checked at **20:33 — after the last commit and before this write**, not
only at the start ([[liveness-read-expires-recheck-before-push]]). `main`
untouched at `8fa892d1`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-10 20:16:14**, last session activity **2026-08-11 19:15:33**. Nothing has run in **73h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none**. 22 word-bounded `429` hits, **all 22 milliseconds in a timestamp** — see below |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

**The rate-limit grep needed one more turn of the screw than the recorded
trap.** [[hostlog-429-grep-is-milliseconds]] says to word-bound it. `\b429\b`
**still matches `[2026-08-14 20:18:13.429]`** — `.` and `]` are both non-word
characters, so the boundary is satisfied on both sides. Word-bounding is
necessary and not sufficient. What settles it is stripping the timestamp first
and re-matching: `sed -E 's/^\[[0-9-]+ [0-9:.]+\] //'` then `\b429\b` returns
**zero**. Reporting 22 would have invented a rate-limit story for an idle fleet.

### ✅ Deployed, and the queue is now ZERO — `92b1503d`

The 16:15 entry ended by naming this run's first job: *"the next run should*
*deploy it and read those two attributes off the live tab rather than adding a*
*third item to this queue."* Both queued builds are now served.

| | |
| --- | --- |
| `1055ab78` | `saveBlobToDisk` stops claiming `saved` on the anchor path, which cannot observe a write |
| `d2dc7b3c` | `document.hasFocus()` replaced by `hasFocus() \|\| (visible && onScreen)` when framed |

Built from `clients/mobile/vite.config.web.ts` with the six env values **derived
from the outgoing served bundle**, per [[next-deploy-pipeline]] — and the check
that derivation exists for passed: the baked config literal in the new entry
chunk is **byte-identical** to the one it replaced, so nothing was silently
repointed.

**Verified with a grep keyed on the dataset PROPERTY, not the attribute.**
[[dataset-grep-reads-zero-on-correct-build]] arrived exactly as recorded: the
first sweep of the fresh build read `data-focus-policy` **0**, which looks like
a build that dropped the feature. The code writes `dataset.focusPolicy`, so the
minified string is `focusPolicy` and the hyphenated form appears nowhere.

| marker | live before | built | served after |
| --- | --- | --- | --- |
| `focusPolicy` | 0 | 1 | **1** |
| `focusOnscreen` | 0 | 1 | **1** |
| `Check your browser downloads` | 0 | 2 | **2** |
| `data-teams-host` *(unchanged control)* | 1 | 1 | **1** |

The live "before" column is a **measured** absence, not an assumed one, and one
reading in it was nearly invalid: the first attempt fetched the chunk carrying
the download copy **by the name it has in the new build**, got `http=200`, and
would have recorded a clean zero. It was the SPA fallback — `size=7034`,
identical to `index.html`. [[teams-tab-deploy-procedure]] records that a missing
asset answers 200 and only the content-type discriminates; here it was the size
that caught it. The baseline was re-taken against the chunk name in the **live**
`index.html`, which answers `application/javascript` at 826 KB.

**The closed check is a three-way sha256**, because a git round-trip through a
Windows checkout is exactly where LF→CRLF conversion would corrupt a JS bundle
while every count above still read correctly (git warned about 15 files on
commit):

```
local build   c27f8daa…  entry     c7b08dc8…  index.html
VM docroot    c27f8daa…            c7b08dc8…
served (curl) c27f8daa…            c7b08dc8…
```

### ✅ Read back off the live tab — 14/14, and the observer TRACKS

`scratch/teams-shell-probe/live-focus-policy.mjs`, `ff6516e7`. This is the point
of the two attributes: the 16:15 entry shipped them so a deployed tab could be
read rather than assumed, and then did not deploy.

| arm | `data-focus-policy` | `data-focus-onscreen` | `hasFocus()` |
| --- | --- | --- | --- |
| **top level (control)** | `native` | **ABSENT** | true |
| framed, on screen | `framed` | `true` | **true** |
| framed, `display:none` | `framed` | **ABSENT** | false |

**The top arm's ABSENT is the reading that carries the most.** Outside a frame
the module returns before installing anything, so an absent attribute is the
only value that separates *"did not touch this surface"* from *"installed and
happened to agree"* — the three states of [[measurements-need-three-states]]
applied to the fix's own reporting.

**`framed-hidden` was written expecting `false` and came back ABSENT. The code
is right and the expectation was wrong.** A `display:none` element never
receives an initial `IntersectionObserver` entry at all, so `reportOnScreen` is
never called and `onScreen` holds the deliberate initial `false` its own comment
describes: *"FALSE until the observer says otherwise, so the moment before the*
*first callback behaves exactly as today rather than suppressing on an*
*assumption."* `hasFocus` reads false there, which is the conservative
direction. Corrected the probe, not the module.

**But that left the observer never observed SAYING false** — which is precisely
the hole the module's own docblock names (*"`data-focus-policy="framed"` on a*
*frame whose observer never fires reads exactly like one whose observer*
*works"*). A fourth arm closes it: one document, on screen → moved off screen →
restored, three readings off the same observer.

```
data-focus-onscreen   true  →  false  →  true
document.hasFocus()   true  →  false  →  true
document.visibilityState  visible in all three
```

The restore is what rules out a one-way latch; `visibilityState` reading
`visible` throughout is what proves the discriminator is the on-screen term and
not visibility.

**One internal control worth stating, because the obvious objection is that the
native term did all the work.** Headless Chromium *does* give focus to a
top-level page (`top` reads true with zero interaction), so "headless holds no
focus" is not available as an argument here. It is settled from this run's own
data instead: `framed-hidden` has the same override installed and reads
**false**. The override short-circuits on the native reading, so a native `true`
in a framed document would have made that arm true. It is false — therefore the
native term is false when framed, and `framed-shown`'s `true` comes from
`(visible && onScreen)` and nothing else.

### ✅ Fixed: every committed browser probe was unrunnable, including the one written this run — `9f114006`

The 16:15 entry found this and deliberately left it, correctly: sixteen
committed probes import `playwright-core` bare, it was never a declared
dependency of anything here, and the `rm -rf node_modules && bun install` that
repaired the prosemirror duplicate at 12:38 took the stray install with it.
Declaring a devDependency would touch `bun.lock` in a tree rebuilt three hours
earlier *because* its dependency graph had drifted.

**Re-verified before acting rather than inherited** ([[blockers-expire-silently]]):
`import("playwright-core")` from the repo root still returns
`ERR_MODULE_NOT_FOUND`, and the single `playwright` string in `bun.lock` is an
**optional peer of vitest** (`@vitest/browser-playwright`), not a declaration.

This run paid the predicted cost within the hour — the live probe above had to
be written into a scratch tree to run at all — so it is fixed, by the route that
keeps the 16:15 reasoning intact rather than overruling it. **`scratch/` is not
a workspace**: the root globs are `["protocol","clients/*"]`, so a
`scratch/package.json` is invisible to a root install and gets its own lockfile,
while Node resolution walking up from `scratch/**/*.mjs` finds
`scratch/node_modules`. No probe was edited.

**Containment verified, not argued** — root `bun.lock` sha256 across the install:

```
before  f344167ecba489f9c16934e227403876723635427a8b15cac73c017128dbf4be
after   f344167ecba489f9c16934e227403876723635427a8b15cac73c017128dbf4be
```

Pinned to **1.62.1**, the version the working probes have actually been running
against, so this restores the apparatus rather than changing it. And the check
that discriminates, since a resolving `import()` proves only resolution:
`live-focus-policy.mjs` run **from the repo** rather than from a scratch copy
returns the same **14/14**, tracking arm included.

### 🔵 The measurement worth carrying: the class the last entry pointed at is mostly empty, and that is the finding

The 16:15 entry closed by naming where the remaining shell risk lives: not in
APIs that *fail* in a frame — those announce themselves — but in ones that
*succeed against a different referent*. It named three and called them
unchecked: `navigator.onLine`, `visibilityState`, and viewport geometry. All
three were checked this run.

| named risk | reading |
| --- | --- |
| **viewport geometry** | **clean by construction.** `screen.width`, `screen.height`, `screen.availWidth`, `outerWidth`, `outerHeight` appear **nowhere** in `clients/gui-app/src`, `clients/mobile/src` or `clients/shared`. Every geometry read is `innerWidth` / `innerHeight` / `visualViewport` / `getBoundingClientRect` — all of which correctly refer to the **frame**. The 768px mobile breakpoint (`use-mobile-viewport.ts`) is `matchMedia` + `innerWidth`, so a Teams tab gets the layout its own width deserves |
| **`navigator.onLine`** | not a referent change — it is the browser's network state and identical in a frame. And `query-client.ts:66` already neutralises the one consumer that mattered: *"Never let `onlineManager` pause work"* |
| **`visibilityState`** | **already consumed by the fix just shipped.** Measured `visible` in every arm and every phase above, including moved-off-screen. The one dangerous case — the whole window backgrounded — remains **unmeasurable on this box** ([[browser-probe-environment-limits]]), and is labelled unmeasured in the module rather than relied on |

**So the direction the last entry pointed at is two-thirds clean by construction
and one-third already fixed.** That is worth stating plainly because the
tempting next move was to keep sweeping this class, and there is nothing left in
it. The one referent that genuinely moved — `document.hasFocus` — was found and
fixed; the others were named by analogy and the analogy does not hold, because
they read global browser state rather than per-document state.

`prefers-color-scheme` is the one signal in this family that *does* change
referent in a Teams tab — it reads the OS, not the host app's theme — and it was
already handled, by `b3d17333` adding a second ambient source
(`setEmbedderTheme`) rather than writing over the media query.

**The next run should not extend this sweep.** It has reached the end of what
framing breaks in the shell.

### Not done, deliberately

1. **The popup recovery is still unbuilt.** Unchanged from 12:15 and 16:15, and
   still a decision rather than a task: the pre-opened window fires for every
   user on every download, and the gate that would restrict it to frames that
   need it is the read 08-13 proved impossible.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; unchanged, and this
   run added nothing to that count. The dist branch **was** pushed —
   `demo/upstream-mobile-next-dist` is at `92b1503d` — because that is the
   deploy mechanism, not a merge.
3. **`main` not merged**, **the app package not rebuilt** (the exempted
   shortcut), **`autobuild/conversational-bot`** still on H1.
4. **The parity contract and the tickets index are still written against
   `clients/teams-tab`**, a package on neither lineage. Raised at 12:15,
   re-checked and unchanged at 16:15 and again here. Still not edited — those
   rows belong to the "Teams Tab Surface" role holder, and whole-file rewrites
   reverted that table four times on 08-03. Resolving the holder at run time
   still returns nobody.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `~73h` deep.**
`EpicFileSync` stopped **2026-08-11 19:15:33**; the last `cloud repair complete`
is still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward.

**Answering the 16:15 entry's PENDING:** it **survived on the first of its two
readings, and the second is still unavailable** — the same verdict it recorded
for its own predecessor, and for the same reason. The artifact grew
313,221 → **327,417 B** and the entry is on disk. No `cloud repair complete` has
occurred since, so what is established remains *"not yet overwritten"* rather
than *"survived a repair"*.

🟢 **The pile is now TWELVE and the mitigation held.** Appended to
`docs/autobuild/unreconciled-checkin-entries.md`, under version control and
outside the repair's reach. **Not re-escalated** — restarting sync needs an epic
opened in the desktop app, which is still one attended minute and still cannot
be done unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **327,417 B**.

## 2026-08-14 16:15 — the Teams tab told the user about the chat that was open in front of them, and the signal it read cannot mean there what it means in a browser

Fleet **idle**, checked rather than assumed for the sixteenth consecutive run,
and re-checked at **16:36 — between the build commit (`d2dc7b3c`, 16:35) and
this write**, not before both ([[liveness-read-expires-recheck-before-push]]).
Stated that precisely because the first draft of this line said *"before
committing"*, which would have claimed a reading the build did not have.
`main` untouched at `8fa892d1`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-11 19:15:33**. Nothing has run in **69h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored **and** word-bounded. **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

### ✅ Built: `document.hasFocus()` is the wrong instrument in a frame — `d2dc7b3c`

`notification-display.ts` gates every host-channel emission and every cloud
snapshot arrival on `readFocusedHostNotificationPresenceEntity()`. Its docblock
states the intent exactly: *"this gate re-checks live focus at display time so*
*the tab you are looking at never toasts about its own activity; rows for other*
*entities still display."*

That function returns `null` — meaning **suppress nothing** — the instant
`document.hasFocus()` is false (`notification-presence.ts:70`). The same reading
is what the client reports to the host as `presence.focused` (line 31).

**In a frame the surrounding chrome is part of the same page.** Every click on
Teams' rail, tab strip or compose box takes focus out of the app while the app
stays fully on screen, and a freshly opened tab has never been clicked at all.

`scratch/teams-shell-probe/focus-presence.mjs`, Chromium 1228, Teams' own
sandbox token set, three arms × three states — **identical under `headless` and
`HEADFUL=1`**, which is the first thing that had to be checked because this box
has produced a headless-only reading before:

| arm | on load | clicked in app | clicked host chrome |
| --- | --- | --- | --- |
| **top level (control)** | **true** | true | *n/a* |
| same-origin frame | **false** | true | **false** |
| cross-origin frame | **false** | true | **false** |

`visibilityState` reads `visible` in **every** cell — the app is on screen
throughout, in all nine.

**The top arm is the whole reason the others can be read.** A headless browser
holds no focus at all — already recorded for the wake lock — so a run where
every arm read false would have measured nothing and reported a finding anyway.
It reads `true` with **zero** interaction, so the framed `false` is the frame
and not the harness.

**And both framed arms agree, which points this fix at the opposite
discriminator from the last one.** `embedding.ts` exists because being
*cross-origin* is what takes the notification permission away, and its
same-origin arm is what proved being framed is not. Here the same-origin arm
reads identically to the cross-origin one, so this module tests for **framing**.
Two neighbouring modules, two different questions, and the arm that separates
them is the same arm.

#### What replaces it — and the part deliberately NOT claimed

`frame-hidden.mjs` asked the question the first probe left open: can a frame tell
*"the host is showing me"* from *"the host switched away"*? Five mechanisms, the
frame clicked first so focus starts true:

| the host did this | `intersectionRatio` | `hasFocus` | `visibilityState` |
| --- | --- | --- | --- |
| nothing (baseline) | 1 | true | visible |
| `display:none` | **0** | true | visible |
| moved off screen | **0** | true | visible |
| `visibility:hidden` | 1 | true | visible |
| covered opaquely | 1 | true | visible |

Same observer, same run, a restore between each — so the 1s are a **measured
absence** rather than a stuck instrument. The installed reading is therefore
`hasFocus() || (visible && onScreen)`.

**Three things it does not know, recorded because the safe direction differs:**

1. **`visibilityState` under a backgrounded window is UNMEASURED, not measured
   absent.** The probe's own control for it **failed** — bringing a second tab to
   the front left the frame reading `visible` under headless *and* headful. That
   is [[browser-probe-environment-limits]]: this box does not background pages.
   The term is kept because it can only make the reading **more** conservative,
   and it is labelled unmeasured rather than quietly relied on.
   [[measurements-need-three-states]] applied to this run's own claim.
2. **A frame hidden by `visibility:hidden`, or covered by another window, reads
   as focused.** Measured, above. This is the one direction that can cost a
   notification, and it is stated in the module rather than papered over.
3. Which mechanism Teams actually uses is unverified — no real Teams install on
   this box (the standing exemption).

#### Why (2) was acceptable here and would not be on the desktop

The decision turns on a fact this sweep established two runs ago, and which makes
the two failure directions **asymmetric on this surface specifically**:

- A wrong `true` suppresses **one entity** — the gate only filters rows matching
  what the user is looking at; every other row still displays.
- And on this surface the suppressed output is an in-app toast and a chime.
  `web-notification-host.ts` reports **`surface-blocked`** for a cross-origin
  frame, so there is **no OS notification to lose**. A toast in a tab the user is
  not looking at was never going to be seen. **The chime is the whole of what a
  wrong `true` costs.**
- Against that, the wrong `false` it replaces fires a toast **and** a chime for
  the chat on screen — from load until the first click inside the frame, and
  again after every click on Teams' own chrome.

Had OS notifications worked here the balance would run the other way and this
would have been left alone. **It is the surface's own limitation that makes the
recovery cheap**, which is worth recording because the same reasoning does *not*
transfer to the desktop client.

**Outside a frame nothing is touched at all** — the PWA and the desktop renderer
keep the native method, and MUT-6 is what holds that.

**9/9 mutations caught**, and the set is chosen so the two failure directions are
separately falsifiable rather than jointly:

| mutation | why it matters |
| --- | --- |
| MUT-1 native reading no longer short-circuits | the one input never in doubt, overruled by the two that are |
| MUT-2 on-screen term dropped | **the dangerous direction** — a switched-away frame suppresses forever |
| MUT-3 visibility term dropped | the term the probe could not measure; a survivor here would mean the suite never checked the half resting on the spec |
| MUT-4 reading collapses to the native one | installs, reports `framed`, changes nothing — [[both-ends-green-seam-untested]] |
| MUT-5 on-screen assumed true before the observer answers | suppression on an assumption, on the boot path |
| MUT-6 frame test dropped, every surface adapted | the widest blast radius for a fix justified entirely by framing |
| MUT-7 missing observer installs the reading anyway | jsdom and old browsers would suppress far more than the defect cost |
| MUT-8 native reading cached at install | the exact staleness the gate's own docblock re-reads live focus to avoid |
| MUT-9 reporter still fires while the reading no longer moves | an attribute that certifies a mechanism it is disconnected from |

**MUT-9 first came back `NOT-APPLIED`, and that is the guard working rather than
a gap.** The mutation string carried two extra spaces of indentation and matched
nothing. A probe that scored an unapplied mutation as *caught* would have
reported 9/9 against code it never touched — the sibling scripts carry that guard
for exactly this, and this is the first run in which it has fired.

**Gates.** `clients/mobile`: **325 passed / 21 files** (was 314 / 20).
`tsc -b --force` exit **0**, and **not hollow** — `--listFiles` reads 4,841 files
with both new files in the set, checked because the 12:15 entry found a project
shape that exits 0 having compiled nothing. `eslint --max-warnings 0` exit **0**,
after it rejected two `as unknown as` casts — **both of which turned out to be
unnecessary**: a real `Document` satisfies the narrow interface structurally, and
the test's fake element could just be a real one.

### 🔵 The measurement worth carrying: the reading was fine, the *meaning* moved

Nothing in `notification-presence.ts` is wrong. `document.hasFocus()` returns
exactly what the platform says, the gate composes it correctly, and every one of
its tests is honest. **The defect is entirely in what the answer means once the
document is a child frame** — and no amount of reading that file could have found
it, because the file is right.

That is a different shape from the last several fixes in this sweep, which were
capabilities the frame *withheld* — the clipboard, the microphone, notifications,
the download. Those announce themselves: something rejects, throws, or returns
null. **A signal that keeps working and quietly changes referent announces
nothing**, and the only instrument that finds it is a control arm at top level
run against the same code.

The practical consequence for the rest of this sweep: the remaining shell risk is
no longer in the APIs that *fail* in a frame — those are now largely swept — but
in the ones that *succeed* against a different referent. `document.hasFocus` was
the first. `navigator.onLine`, `visibilityState` itself, and any geometry read
against a viewport are the same shape and are **not** checked.

### 🟠 Still standing, not re-raised

The 12:15 entry raised to Elliot that **the parity contract and the tickets index
are written against `clients/teams-tab`, a package on neither lineage.**
Re-checked this run, unchanged, and still not edited here — those rows belong to
the "Teams Tab Surface" role holder, and whole-file rewrites reverted that table
four times on 08-03. Resolving the holder at run time still returns nobody: 115
agents, 0 active, nothing run in 69h.

### 🟠 Every committed browser probe in this repo is currently unrunnable, and the 12:15 repair is why

Found by running one. `import { chromium } from "playwright-core"` now dies with
`ERR_MODULE_NOT_FOUND` from the repo root.

**`playwright-core` was never a declared dependency of any package here** —
`grep -rl playwright --include=package.json` outside `node_modules` returns
nothing. It was a stray install, so the `rm -rf node_modules && bun install`
that repaired the prosemirror duplicate at **12:38 today** removed it along with
everything else it correctly rebuilt. `bun.lock` was untouched, which is why the
repair looked total and this went unnoticed.

**Fifteen committed probes import it bare** — all of `scratch/teams-shell-probe/`
and `scratch/next-probe/`. That is the entire measuring apparatus this sweep has
been building for two weeks, and it is the apparatus the *next* run reaches for
first.

The working tree is `C:/Users/<user>/.traycer/scratch/next-probe/`, which has its
own `node_modules/playwright-core`; both probes in this entry were run by copying
them there. **Not repaired here, deliberately** — declaring a devDependency for
scratch probes would touch `bun.lock` in a tree that was rebuilt three hours ago
precisely because its dependency graph had drifted, and doing that unattended to
fix a scratch import is the wrong trade. Recorded so the next run does not spend
a step rediscovering it.

### Not done, deliberately

1. **The popup recovery is still unbuilt.** Unchanged from 12:15 and still a
   decision rather than a task: the pre-opened window fires for every user on
   every download, and the gate that would restrict it to frames that need it is
   the read 08-13 proved impossible.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; unchanged, and this
   run added nothing to that count.
3. **Not deployed. Queue depth is now TWO**, stated so it cannot drift unremarked
   — that is how it reached twelve. Unlike 12:15's copy change, this one **does**
   stamp something a deployed tab can be read back for: `data-focus-policy` and
   `data-focus-onscreen` on `<html>`. That makes it the first module since the
   deploy with a reason to ship, and the next run should deploy it and read those
   two attributes off the live tab rather than adding a third item to this queue.
4. **`main` not merged**, **the app package not rebuilt** (the exempted
   shortcut), **`autobuild/conversational-bot`** still on H1.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `~69h` deep.**
`EpicFileSync` stopped **2026-08-11 19:15:33**; the last `cloud repair complete`
is still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward.

**Answering the 12:15 entry's PENDING:** it **survived on the first of its two
readings, and the second is still unavailable.** The artifact grew 299,019 →
**313,221 B** and the entry is on disk. But its own check named a
`cloud repair complete` later than the write as the settling reading, and none
has occurred — so what is established is *"not yet overwritten"*, not *"survived
a repair"*. Those are different, and the entry was right to distinguish them.

🟢 **The pile is now ELEVEN and the mitigation held.** Appended to
`docs/autobuild/unreconciled-checkin-entries.md`, under version control and
outside the repair's reach. **Not re-escalated** — restarting sync needs an epic
opened in the desktop app, which is still one attended minute and still cannot be
done unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **313,221 B**.

## 2026-08-14 12:15 — the app stopped claiming a file was saved when it cannot know, and the red gate that reddened it belonged to the box rather than the branch

Fleet **idle**, checked rather than assumed for the fifteenth consecutive run,
and re-checked at 12:29 before committing
([[liveness-read-expires-recheck-before-push]]). `main` untouched at `8fa892d1`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last agent turn (`host.log`, `ChatSession`) | **2026-08-11 19:15:33**. Nothing has run in **65h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored **and** word-bounded. **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

### ✅ Built: the one module the sweep ended without building — `1055ab78`

The 08-13 entry closed with *"Built: nothing, and that is the deliverable"*,
and filed the recovery as a call-site change it declined to make. **It filed
only half the defect.** The other half needs no call-site restructure and
nobody had separated it out:

`saveBlobToDisk` picks one of three mechanisms and returned the file name from
**all three**, so both callers toasted `Saved <name>` unconditionally. Only two
of the three ever observed a write — the desktop bridge returns the path its
main process wrote, and `createWritable()`/`close()` resolve after the bytes
land. The third, `<a download>` + `anchor.click()`, returns `undefined` whether
the browser accepted the download or dropped it on the floor.

**That third path is the only one a Teams tab can reach.** No `runnerHost`, and
`showSaveFilePicker` rejects `SecurityError` in a cross-origin frame — both
measured on 08-13, along with the arm where the download fires **zero** times
and the app claims `probe-artifacts.zip` anyway.

So the fix is not to detect the block, which the 08-13 battery established is
impossible from inside the frame — 13 readings across two frames differing by
exactly one sandbox token, **0 differ**, `allow-modals` as the control proving
the battery was not blind. The fix is to **stop claiming what was never
checked**:

```ts
export type SaveBlobOutcome =
  | { readonly status: "saved"; readonly name: string }      // something confirmed the write
  | { readonly status: "started"; readonly name: string }     // handed over, unobserved
  | { readonly status: "cancelled" };
```

`Saved X` for `saved`; `Downloading X` (+ *"Check your browser downloads if it
doesn't appear."*) for `started`; silence for `cancelled`. The desktop dialog's
`null` now says `cancelled` in the type rather than by caller convention.

**Both halves are covered and both were mutation-checked**, because a test that
cannot fail is this epic's most-repeated defect:

| mutation | reds | stays green |
| --- | --- | --- |
| anchor path returns `saved` | the 2 lib tests | the other 8 |
| call site collapses `started` into the success branch | the 1 seam test | the other 9 |

The seam test is the one that matters: the lib distinguishing a verified write
from an unobserved one is worth **nothing** if the toast says "Saved" either
way, which is exactly what it did until today. [[both-ends-green-seam-untested]]

### 🔵 THE MEASUREMENT WORTH CARRYING: the gate was red, the branch was clean, and the two loudest repairs both failed to tell them apart

`tsc -b --force` on `clients/gui-app` exited **2 with 6 errors**, and
`mermaid-node-view.test.tsx` failed **6 of 7** — including tests with nothing
to do with downloads. Read at face value that says this change broke the
editor.

**It says nothing about this change.** Stashing the diff and re-running gave a
**byte-identical** 6 errors and the same `6 failed | 1 passed`. Every error was
a `prosemirror-model` **1.25.9 vs 1.25.11** type conflict, and the test failure
was its runtime twin — `TypeError: Cannot read properties of undefined
(reading 'localsInner')` out of `DecorationGroup.locals`, thrown by
`new Editor()` before any test body ran.

`bun.lock` names **1.25.11 and nothing else**, and has since 2026-07-25. The
string `1.25.9` appears in **no** lockfile and **no** `package.json`. The store
held it anyway, and **every transitive prosemirror package was symlinked to
it** while gui-app's own import resolved 1.25.11 — two incompatible copies in
one process.

**The part worth carrying is what did not fix it:**

| repair | result | copies of `prosemirror-model` left |
| --- | --- | --- |
| `bun install` | *"Checked 1813 installs across 1910 packages (**no changes**)"* | **2** |
| `bun install --force` | **3603 packages installed**, 78s | **2** |
| `rm -rf node_modules && bun install` | 3603 packages, 20s, **`bun.lock` untouched** | **1** |

[[bun-install-no-changes-lies-about-the-tree]] in its strongest form: the
loudest available install reinstalled every package in the tree and **still
left the stale intra-store symlink alone**. Dated proof — the link
`prosemirror-view@1.42.2/node_modules/prosemirror-model → …1.25.9…` carries
mtime **2026-08-10 20:46**, and the `--force` run at 12:33 today did not
rewrite it. A version bump adds the new directory and never re-points the old
links, so `--force` is not a repair for this and reports success.

**After, with `bun.lock` unchanged and the same 3603 packages:**

| gate | before | after |
| --- | --- | --- |
| `tsc -b --force` | **6 errors**, exit 2 | **0 errors**, exit 0 |
| `mermaid-node-view.test.tsx` | **6 failed \| 1 passed** | **7 passed** |
| the 3 files this change touches | — | **17 passed** |
| `editor-core` (13 files) | *not measured* | **147 passed** |

The `editor-core` row is deliberately left **unmeasured** on the before side
rather than back-filled from the two files that were: this run did not read it
in the broken tree and will not infer it. [[measurements-need-three-states]]

**And the tsc pass is not hollow**, which had to be checked because
`gui-app/tsconfig.json` is exactly the `files: []` + `references` shape that
exits 0 having compiled nothing: `tsc -p tsconfig.app.json --noEmit
--listFiles` reads **5858 files, 3008 of them `clients/gui-app/src`**.

**Consequence for this log.** Any gui-app suite or typecheck result read on
this box between 2026-08-10 20:46 and today was read through a broken tree.
None of the last ten entries reports one, so nothing here needs retracting —
but the next run to quote a gui-app number should know the tree only became
trustworthy at 12:38 today.

#### And the obvious follow-on — *"then the bundle we shipped at 08:51 has two prosemirror copies in it"* — is FALSE, measured rather than assumed

That deployed bundle was built at **09:02 from the broken tree**, four hours
before any of this was known, so it is the first thing to suspect and the
reason a redeploy looked mandatory.

It is clean. `prosemirror-model`'s dist carries the literal *"Empty text nodes
are not allowed"* **exactly once**, and the served `assets/` carry it **exactly
once**, in one chunk. Two bundled copies would read two — string literals are
not deduplicated across modules by the bundler.

*"Invalid content for node"* was tried first and is **not** a discriminator:
it reads 2 in `prosemirror-model` but 4 across the bundle, because
`prosemirror-transform` carries it independently. A literal shared by sibling
packages counts the siblings, not the copies. The single-occurrence literal is
the one that answers the question. [[chunk-name-globs-overmatch]] — identify by
content, and then check the content identifies only what you think it does.

**So the duplicate broke the two gates and never reached the product.** Vite
resolved one copy; `vitest` and `tsc` walk the `.bun` store links and resolved
two. That scoping is the whole practical difference between "the served app is
broken" and "the box could not measure it", and **it also removes the one
argument that would have forced a redeploy this run.**

### 🔵 The correction this run owes its own instruments: 5,165 warnings that meant nothing

`host.log` is carrying `EpicTokenRefresher: batch threw … CredentialLease`
`ReleasedError: No live request context retained` — **5,165 occurrences, 160
of them today, still firing every 1–2 minutes as this is written.** With the
artifact sync down for 65 hours, that is an extremely good-looking cause, and
this run spent a step building the story: no session → no request context →
no token → no sync.

**The story is wrong, and the log says so.** The first occurrence is
**2026-08-11 15:43:56**. `EpicFileSync` then started, ran a **successful cloud
repair at 19:15:16**, and reported `file sync ready` at 19:15:18 — *three and a
half hours into the warning stream.* A condition that was already firing while
the thing it supposedly prevents was working is not that thing's cause.

What actually holds is duller and is the honest statement: the host process is
up (`host RPC listening`, restarted 2026-08-13 16:47, still serving — the CLI
reached it for every probe above), and **no epic has been opened since 08-11
19:15:33**. No `ChatSession`, no `EpicFileSync`, so no repair. The refresher
warning is a symptom of the same absent session, not a lever on it.

Two other today-only lines were checked and are also not findings: the
`maxDelayMs: 46420007` "event loop stall" is **12.9 hours of machine sleep**,
and the `UNAUTHORIZED "exp" claim timestamp check failed` at 08:51:50 is
[[cli-token-expiry-matches-checkin-interval]] — the previous check-in's own CLI
connecting, once, on schedule.

### 🟠 The parity contract and the tickets index are written against a package that exists on neither lineage

`clients/teams-tab` is **absent from `main` and absent from the stack tip**
(`git ls-tree` on both). It was deleted in the 08-05 convergence pivot. The
Teams surface is now `clients/teams-bot` + `clients/teams-help` on `main`, with
the tab embedding the `/next/` PWA — which is what the last ten runs have
actually been building.

Two named next-actions therefore have no subject left:

- the parity contract's *"real, cheap, unclaimed follow-up — build the tab and
read the chunk sizes"*, its one open question about the nine `@tiptap/*`
packages inside a Teams iframe;
- the 08-01 entry's *"the most valuable next work in the Teams client"* —
teams-tab's 19 tests in 2 files against mobile's 411 in 61.

Both read as live work to anyone opening those documents today.
[[blockers-expire-silently]] with the polarity reversed: not a blocker that
quietly lifted, but a **task whose subject quietly left**.

**Not corrected here, deliberately.** Parity-contract row states belong to the
"Teams Tab Surface" role holder, and the check-in does not edit them — that
rule exists because whole-file rewrites reverted this table four times on
08-03. Resolving the current holder at run time returns nobody taking turns:
all 115 agents idle, nothing run in 65h. So this is **raised to Elliot** rather
than messaged into an empty inbox, and the rows are left alone.

### Not done, deliberately

1. **The popup recovery is still unbuilt** — the measured fix, pre-opening the
window in the click before the export is built. The 08-13 deferral called it
out of scope because *"this shell adapts the platform beneath upstream's UI;*
*it does not restructure upstream's call sites"*, and read against its
siblings that rationale is weaker than it looks: the `execCommand("copy")`
clipboard recovery **is** a behaviour change inside gui-app, and it was
accepted. The real difference is not scope but **call-chain position** — copy
could be recovered at the seam, downloads cannot. What still blocks it is a
cost this run would not impose unattended: the popup fires for **every** user
on every download, and the gate that would restrict it to frames that need it
is precisely the read 08-13 proved impossible. That is a decision, not a task.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; unchanged, and this
run added nothing to that count.
3. **Not deployed, and this is a decision rather than a deferral.** The served
bundle is the 08:51 deploy at `130d5a23`, and it is **measured clean** of the
duplicate above, so nothing forces a redeploy. What is left is a copy change
to Elliot's live PWA, made forty minutes ago, that answers **no** open
in-frame question — every prior module in this sweep earned its deploy by
stamping a reporter the next run could read back, and 08-13 established this
one has nothing to stamp. Deploying 3.5h after the last deploy to ship it
would be motion, not verification. **Queue depth is now ONE**, stated so it
cannot drift back to twelve unremarked — that is how it reached twelve.
4. **`main` not merged**, **the app package not rebuilt** (the exempted
shortcut), **`autobuild/conversational-bot`** still on H1.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `~65h` deep.**
`EpicFileSync` stopped **2026-08-11 19:15:33**; the last `cloud repair complete`
is still **2026-08-11 19:15:16**, re-greped at write time rather than carried
forward.

**Answering the 08:51 entry's PENDING:** still **PENDING**, and now for a
stated reason rather than an unread one. Its check named two readings — the
byte length, **and** a `cloud repair complete` later than the write. The second
has not occurred, so the first cannot settle it. The entry **is** on disk (this
run read it, and the artifact has grown to 299,019 B), but disk presence is not
survival: the repair is the thing that would overwrite it.

🟢 **The pile is now TEN and the mitigation held.** Appended to
`docs/autobuild/unreconciled-checkin-entries.md`, under version control and
outside the repair's reach. **Not re-escalated** — restarting sync needs an
epic opened in the desktop app, which is still one attended minute and still
cannot be done unattended.

**PENDING** for this entry, on the same two readings. Pre-write size of this
artifact: **299,019 B**.

## 2026-08-14 08:51 — the deploy twelve runs deferred is done, and the measurement that nearly reported ten shipped fixes as missing

Fleet **idle**, checked rather than assumed for the fourteenth consecutive run.
`main` untouched at `8fa892d1`. **This run changed no product source** — it
built, deployed and read what ten previous runs had already written.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **84h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — see the correction below; the level-anchored grep still returned a false positive |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

**No check-in ran for 32 hours.** The last commit anywhere is `130d5a23` at
2026-08-13 00:34 and the next task start is this one at 08:51 — eight scheduled
slots (04:15 through 04:15) produced nothing. `LastTaskResult` is `0x800710E0`,
"the operator or administrator has refused the request", which is what the
scheduler records when a machine is asleep rather than when a task fails. The
task then fired once on wake, not eight times. Nothing was lost, but a reader
counting entries would have counted eight silent failures.

### ✅ Built and DEPLOYED: `/next/` now serves the last ten runs' work

The recurring deferral — *"the `/next/` rebuild and redeploy, now **twelve**
runs deep"* — is **closed**. The served bundle dated from **2026-08-09 08:39**
(`8341eecc`). It now serves the stack tip, `130d5a23`, carrying **17 commits,
10 of them `next:` source changes** from the 08-11 04:15 through 08-13 00:15
runs: the theme seam, the theme-in-URL, the card deep link, notification truth,
push truth, the external-link door, the wake lock, notify-retry, the clipboard
fallback and the microphone policy.

Every one of those runs recorded that its finding is answered *"on that deploy
and on nothing else"*. Ten workstreams were parked on one action.

**Why this run took it.** Prior entries deferred it as *"a production change to
the surface that is simultaneously Elliot's mobile PWA, and it was not this
run's instruction"*. This run's instruction is the standing goal — full Teams
fidelity with the PWA, exempting only Teams SSO and the org app package upload
— and the deploy is on neither exemption. The pipeline had also already been
run unattended **five times** (08-05 through 08-09); stopping was drift, not
policy. It is reversible: reset the dist branch to `8341eecc` and re-run the
fetch/reset/rsync.

#### What was verified before pushing it at a live surface

- **The baked config is byte-identical** to the outgoing bundle, compared as
one whole literal (`authnBaseUrl`/`signInUrl`/`relayBaseUrl`/`devHostPath`/
`host{…}`) — and re-checked **on the served bytes** after the rsync. A rebuild
whose config drifts has silently repointed the client at a different host.
- **The diff is 50 files: 4 added, 4 deleted, 2 modified, 40 renamed.** Chunk
hashes rolling on the modules that changed, and nothing else — the expected
shape for a ten-commit source delta, not a wholesale rebuild.
- **The app still boots in both arms** — `rootChildren: 2`, `title: Traycer`,
`pageErrors: []`. A blank `/next/` has happened on this epic before.

### 🔵 THE MEASUREMENT WORTH CARRYING: the grep that reads zero on a correct build

The first comparison of built-vs-deployed searched the bundle for
`data-clipboard`, `data-microphone`, `data-wake-lock` and six more, and found
**eight of ten missing from a freshly built bundle**. Read at face value that
says the last ten runs wrote code that never reached the app — the epic's
signature defect, at the largest scale it has appeared.

**It was the measurement.** The attributes are set with
`document.documentElement.dataset.wakeLock = …`, so the **HTML spelling never
appears in the bundle at all**. Grepping for `data-wake-lock` returns zero
against a perfectly working build, and returns zero against a build with the
feature ripped out. It cannot tell those apart, so it was never evidence.

The two that *did* match — `data-teams-host` and `data-teams-theme` — are the
only two set through `setAttribute` with a string literal. **The measurement
was accidentally keyed on an implementation detail that varies per module**,
which is why it looked selective and therefore credible.

Re-keyed on `dataset.<prop>=`, which minifiers preserve because it is a DOM
property, the same comparison carries its own control:

| reporter | built | **deployed, before** | **deployed, after** |
| --- | --- | --- | --- |
| `dataset.clipboard` | 1 | **0** | **1** |
| `dataset.microphone` | 1 | **0** | **1** |
| `dataset.nativeNotify` | 1 | **0** | **1** |
| `dataset.externalOpen` | 1 | **0** | **1** |
| `dataset.wakeLock` — **control** | 1 | 1 | 1 |
| `dataset.push` — **control** | 1 | 1 | 1 |
| `dataset.storageDurable` — **control** | 1 | 1 | 1 |
| `dataset.notifications` — **control** | 2 | 2 | 2 |
| `dataset.pwa` — **control** | 3 | 3 | 3 |

The five unchanged rows are what make the four zeros mean something: a grep
that could not read the deployed chunk at all would have returned zero for
every row. [[control-keyed-on-copy-measures-the-copy]] — the first version
measured the spelling in the docblocks, not the behaviour in the code.

### 🟢 Ten open questions, answered off the live deployment

`scratch/teams-shell-probe/live-deployed.mjs`, Chromium 1228, against the real
URL rather than a bundle of the source. `top` is the PWA as Elliot uses it and
is the **control**; `framed` is a cross-origin parent applying Teams' sandbox
tokens.

| reporter | `top` | `framed` |
| --- | --- | --- |
| `theme` | `traycer-green` | `traycer-green` |
| `clipboard` | `granted` | **`policy-blocked`** |
| `microphone` | `granted` | **`policy-blocked`** |
| `wakeLock` | `held` | **`policy-blocked`** |
| `notifications` | `default` | **`surface-blocked`** |
| `push` | `permission` | **`surface-blocked`** |
| `nativeNotify` | `idle` | `idle` |
| `storageDurable` | `true` | **`true`** |
| `pwa` | `registered` | `registered` |

Two of these are worth more than the rest:

- **`storageDurable: true` in the frame** closes the gate the tab plan opened
on 2026-07-30 — *"what the probe must now establish is whether the token
survives a reload inside the frame"*. Storage is **partitioned, not denied**,
and the app says so from inside the frame rather than being inferred from
outside it.
- **`clipboard: policy-blocked` in the frame** is the fallback's whole
justification, now reported by the deployed code rather than by a probe of it:
`clipboard-write` is not delegated, so `execCommand("copy")` is the only reason
copy works there at all.

**Scope, and do not over-read it.** Chromium only. `TEAMS_SANDBOX` remains the
**unsourced constant** the 08-13 entry traced — the real client also sends an
`allow` attribute nothing unattended can read. This is the best available
approximation of the Teams tab, not the Teams tab.

### 🔵 The second correction this run owes its own instruments

The probe's first run read **`pwa` ABSENT** in the framed arm — and absence was
exactly the fourth state the 08-12 00:15 entry was written about. It survived
about a minute.

`pwa-shell.ts` stamps one of `unsupported` / `registered` / `unavailable` on
**every** path, so a genuine absence would mean the `register()` promise never
settled. But the read was gated on *"any dataset key is present"*, and **every
other reporter stamps synchronously during bootstrap while `pwa` is deferred
to the `load` event and then to a promise**. The gate was satisfied before the
one key being asked about could exist.

Waiting on `pwa` itself — with the timeout recorded as a result rather than
thrown — reports `registered` in **both** arms.
[[probe-read-gated-on-proxy-signal]]: the wait fired near the thing measured,
not on it. Both of this run's corrections are the same error in different
clothing — a question asked in terms the answer does not use.

### 🔵 A third: "one rate-limit hit" was a UUID

The fleet check greps `host.log` level-anchored — `[WARN]`/`[ERROR]` **and**
the word — which is the sharpening a previous run already made after raw `429`
matched millisecond timestamps. It returned **one** hit. The hit is a
`CHAT_NOT_VISIBLE` warning whose **chat UUID contains `429`**. Level-anchoring
narrowed the haystack and did not fix the needle; `429` needs a word boundary
and an HTTP context, not just a log level.

### Not done, deliberately

1. **Not merged to `main`.** `main` has no `clients/mobile` for this to land
in — it was deleted at `cb1edae3` — and the stack is the lineage `/next/` is
built from. Unchanged, and still Elliot's call.
2. **Only the dist branch was pushed.** `demo/upstream-mobile-next-dist` is
pushed because the VM fetches from `origin` — the pipeline does not work
otherwise. `main` is still **12** ahead of `origin/main` and this run did not
touch that.
3. **The app package is not rebuilt or reinstalled** — the exempted shortcut.
4. **The `download` finding is unfixed.** The 08-13 entry established that the
recovery must open the popup *before* the export is built, which is a call-site
change in upstream's hooks. Deploying did not change that, and this run did not
restructure upstream's call sites.
5. **`autobuild/conversational-bot`** — still parked on H1.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `~62h` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and the last
`cloud repair complete` is still **2026-08-11 19:15:16**.

🟢 **The pile is now NINE and the mitigation held.** Appended to
`docs/autobuild/unreconciled-checkin-entries.md`, under version control and
outside the repair's reach. **Not re-escalated** — restarting sync still needs
the desktop app and still cannot be done unattended.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**.

## 2026-08-13 00:15 — the Teams tab may not be able to save a file at all, the app cannot find out, and the fix that works in a probe fires zero times in the app

Fleet **idle**, checked rather than assumed for the thirteenth consecutive run,
and re-checked at 01:0x before committing
([[liveness-read-expires-recheck-before-push]]). `main` untouched at `8fa892d1`.
**No source changed this run** — the branch carries four probes and this entry,
and the reason nothing was built is itself a measurement.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **52h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |

### 🔴 The finding: the one save path in the app reports success it never checked

`clients/gui-app/src/lib/files/save-blob-to-disk.ts` is the only save path, and
two real features reach it — `use-epic-export-artifacts-mutation.ts` (export
artifacts) and `use-mermaid-png-download.ts` (download a diagram). It picks one
of three mechanisms, and on this surface only the third can ever run:

1. `runnerHost.fileDrops.saveFile` — desktop only. `MobileRunnerHost.fileDrops`
has **no `saveFile` member**, so the branch is skipped. The seam exists and the
web shell has never filled it.
2. `window.showSaveFilePicker` — **rejects `SecurityError` in a cross-origin
frame**, measured below. Entered and recovered from, correctly.
3. `<a download>` + `anchor.click()` — and the last line is
`return suggestedName`, **unconditionally**.

An anchor click returns nothing whether the browser accepted the download or
dropped it. So `saveBlobToDisk` reports the file name either way and
`onSuccess` toasts **`Saved <name>`**. This is the epic's signature bug in its
purest form: not a broken capability, but a claim with nothing behind it.

#### Measured — `scratch/teams-shell-probe/download.mjs`, Chromium 1228

| Arm | `showSaveFilePicker` | download fired | app claimed |
| --- | --- | --- | --- |
| top — **the control** | `rejected:AbortError` | **1** | `probe-artifacts.zip` |
| same-origin frame — **the second control** | `rejected:AbortError` | **1** | `probe-artifacts.zip` |
| cross-origin, Teams' sandbox tokens | **`rejected:SecurityError`** | **1** | `probe-artifacts.zip` |
| the same, **`allow-downloads` removed** | `rejected:SecurityError` | **0** | **`probe-artifacts.zip`** |

The download event is observed by the driver, **outside** the page — the page
has no way to see it, which is the entire defect. The fourth arm is the
discriminator: without an arm where the download is known-blocked, "an event
fired everywhere" cannot be told apart from a probe that cannot observe
blocking at all. It also carries Chrome's console line, which is the only place
the failure exists: *"Download is disallowed. The frame initiating or*
*instantiating the download is sandboxed, but the flag 'allow-downloads' is not*
*set."*

### 🔵 THE MEASUREMENT WORTH CARRYING: this module's answer rests on a constant nobody sourced

Row 3 says the Teams tab is fine. **That row is only as good as the string
`TEAMS_SANDBOX`**, and this run went looking for where it came from.

It was introduced on 2026-08-06 as *"the tokens a Teams tab host actually*
*applies"* with **no citation**, and has been copied verbatim into six probes
since (`wake-lock-probe.mjs`, `clipboard.mjs`, `discriminator.mjs`,
`microphone.mjs`, and both of this run's). [[stale-facts-need-derivations]] —
the value was recorded and the derivation never was.

**It has not mattered until now, and that is why nobody checked it.** The wake
lock, native notifications, `clipboard-write` and `microphone` findings all
turn on the **`allow` attribute** — permissions-policy delegation — which is
absent whatever the sandbox says. Change the sandbox tokens in any of those four
probes and every row holds. **Downloads are the first module in this sweep
where a sandbox token *is* the variable**, so the unsourced constant moved from
harmless to load-bearing without anyone deciding it should.

And the one public record on the question points the other way. Microsoft's own
Teams-developer forum carries the exact question — *"Does anyone know, Microsoft*
*Teams dev will enable the flag 'allow-downloads' for Teams sandbox attribute*
*list?"* — raised when Chrome 83 began blocking sandboxed-frame downloads.
A Microsoft employee answered on **2020-06-08**: *"We have a active work item on*
*this, we are working on it internally, we don't have any ETA when it will be*
*available."* The thread closes on 2020-06-17 with no confirmation it shipped.

So the honest reading of the table above is **not** "downloads work in Teams".
It is: *row 3 and row 4 are both live candidates for what the Teams tab
actually is, and only a real install decides which.* Row 4 is the one where the
user is told a file was saved that does not exist.

### 🟠 No in-frame read can detect it — 13 readings, and a control that proves the battery was not simply blind

If the shell cannot tell which row it is in, it cannot report honestly. That
question was answered by **enumeration** rather than by recalling which sandbox
flags are introspectable — `scratch/teams-shell-probe/download-readability.mjs`
runs the same battery in two frames differing by **exactly one token**.

| | keys that differ |
| --- | --- |
| `allow-downloads` removed | **0 of 13** |
| `allow-modals` removed — **the control** | **1** (`alert.isNoop`) |

`document.featurePolicy.allowsFeature("downloads")` reads `false` in **every**
arm including the permissive one, and `allowedFeatures().length` is `22`
throughout — downloads are a **sandbox flag**, not a policy feature, so the API
that looks like the right question does not answer it. The control arm is what
makes the zero mean something: a battery that detected neither removal would be
blind, and its null result would prove nothing.

**So there is no `data-download` attribute to stamp.** Every prior module in
this sweep ended by stamping what it measured so the next deploy answers the
open question; this one cannot, and saying so is the finding rather than a gap
in it.

### 🔴 The fix that works in a probe and fires zero times in the app

`allow-popups-to-escape-sandbox` is in the token set, and a popup opened under
it is **not** sandboxed — so a download initiated from that popup escapes the
frame's missing flag. `scratch/teams-shell-probe/download-recovery.mjs`
confirmed the mechanism, in the frame with `allow-downloads` **removed**:

| mechanism | with `allow-downloads` | **without** |
| --- | --- | --- |
| plain anchor — **the controls** | **1** | **0** |
| popup → anchor inside it | 1 | **1** |
| the same, popup closed immediately | 1 | **1** |

Closing the popup at delay `0` does not abort the download, so the blank window
this leaves behind is disposable. A real recovery, of the same shape as
`execCommand("copy")` recovering `clipboard-write`.

**And it does not survive the way the app calls it.** `saveBlobToDisk` is only
ever reached *after* async work — `createArtifactExport` builds the zip,
`toBlob` renders the diagram. Arms that opened the popup after an `await`
produced **zero** downloads. Because those arms ran fifth and sixth, after
three popups in the same document, **popup-allowance exhaustion was a complete
alternative explanation**, so each was re-run **alone, first, in its own fresh
browser context** — `scratch/teams-shell-probe/download-activation.mjs`, one
popup per context, permissive frame throughout so a zero cannot be blamed on
the sandbox:

| arm | popup handle | anchor click | **download** |
| --- | --- | --- | --- |
| `sync-0ms` — **the control** | `window` | ok | **1** |
| `await-1s` | `window` | ok | **0** |
| `await-6s` | `window` | ok | **0** |
| `preopen-await-6s` | `window` | ok | **1** |

**Every observable the shell could check passes in the failing arms.** The
handle is non-null, the click does not throw, no error is raised anywhere. A
`fileDrops.saveFile` built on this would have shipped a fix that fires **zero**
times in production and passed every unit test written against a fake
`window.open` — the exact defect it was written to remove, reintroduced as the
remedy. That is [[injected-branch-test-names-no-surface]] arriving through the
front door, and only the isolated re-run separated it from popup exhaustion.

**It is also not transient-activation expiry**, which is the obvious reading and
is wrong: `await-1s` is well inside Chrome's ~5s window and fails, while
`preopen-await-6s` is outside it and works. The variable is **where
`window.open` sits relative to the await**, not how much time has passed.

### ✅ Built: nothing, and that is the deliverable

The last row is the one actionable result. Pre-opening the window **before** the
export is built recovers the save — but that is a **call-site** change in
upstream's `use-epic-export-artifacts-mutation.ts` and
`use-mermaid-png-download.ts`, and it **cannot be done at the
`fileDrops.saveFile` seam**, which is handed finished bytes. Under convergence
this shell adapts the platform beneath upstream's UI; it does not restructure
upstream's call sites, and this run declined to invent a seam so it could.

Filed for whoever takes it: *open the window in the click, then build the
export, then click the anchor inside the already-open window.* Measured working
at a 6-second delay, in a frame with no `allow-downloads`.

### Not done, deliberately

1. **No `fileDrops.saveFile` implementation.** Measured not to work in the
shipped call shape. Building it anyway is the one outcome worse than the defect.
2. **The `/next/` rebuild and redeploy** — unchanged, now **twelve** runs deep.
Unlike every prior module, this one contributes **no** deploy-answered question,
because no in-frame reading exists to stamp.
3. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
4. **`TEAMS_SANDBOX` was not corrected**, only sourced. Nothing unattended can
read Teams' real sandbox attribute — that needs the app-package install, which
is the exempted shortcut. The six probes carrying it are **not** invalidated:
their findings turn on the `allow` attribute, and this entry records why that
distinction holds rather than asserting it.
5. **`TRAYCER_TEAMS_APP_ID`**, **the app package**, and
**`autobuild/conversational-bot`** — unchanged, as in every recent entry.

### 🔵 Two corrections this run owes its own instruments

- **`popup-blob` reads `0` in a row where something did download.** Mechanisms
were attributed by filename prefix, and `window.open(blobUrl)` **discards the
`download` attribute** — its file arrived named `735dea2f-…​.zip`. The row is
honest about the mechanism being unusable (it loses the filename, and produced
nothing at all in the blocked arm) but the `0` is a **mis-attribution, not a
zero**, and a reader counting that column would be counting wrong.
- **The first run of the activation probe was a `SyntaxError`, not a result.**
A comment added *inside* a template literal contained backticks around
`saveBlobToDisk`, which ended the literal. Same family as
[[heredoc-backslash-loss]]: the quoting layer eats a level and the failure looks
nothing like its cause. The file now carries a note saying so at the point where
it bit.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `~29h` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time.

⚪ **The 20:15 entry's PENDING resolves as it predicted: STILL THE MIDDLE STATE.**
The last `cloud repair complete` in `host.log` is still **2026-08-11 19:15:16**,
earlier than that entry's write.

🟢 **The pile is now EIGHT and the mitigation held.** This entry is appended to
`docs/autobuild/unreconciled-checkin-entries.md` alongside the other seven,
under version control and outside the repair's reach. **Not re-escalated** — an
eighth run repeating the sentence would be [[agents-decline-merges-pending-a-human]]
wearing a warning label.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**. If this still says
PENDING with no repair logged, that is the unmeasured middle state, not a pass.


## 2026-08-12 20:15 — the Teams tab told the user they had blocked a microphone nobody had asked them about, and the obvious reading says they hadn't

Fleet **idle**, checked rather than assumed for the twelfth consecutive run, and
re-checked at 20:44 before committing
([[liveness-read-expires-recheck-before-push]]). `main` untouched at `8fa892d1`;
the work landed on the `/next/` stack at **`1ba52c14`**, on
`autobuild/next-teams-microphone` off last run's tip `9fc31196`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 20:17 and again at 20:44 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **48h** |
| `claude.exe` processes | **1** — this session. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: `microphone` is delegated too, and the app blames the user for the refusal

Under `convergence-architecture` the Teams client **is** the `/next/` bundle, so
the shell is the entire remaining parity surface. This is the seventh module in
that sweep and the **fourth** to turn out to be a permissions-policy delegation,
after the wake lock, native notifications and `clipboard-write`.

**But it is the first one where there is nothing to recover, and that changes**
**what the fix is.** A clipboard write has `execCommand`; a microphone has no
fallback and this module does not pretend otherwise. What is broken here is not
the capability — it is the app's **account** of why the capability is missing.

`use-voice-dictation.ts` classifies the failure by error name:

```ts
const denied = error instanceof Error && error.name === "NotAllowedError";
```

and a policy refusal arrives as exactly that. So on the Teams tab the user is
told *"Microphone access is blocked for Traycer"*, asked to *"Enable microphone*
*access for Traycer, then try again"*, and given an **"Open Settings"** button
which calls `openMicrophoneSettings()` — a documented no-op in this shell.
**Three statements, and all three are false on this surface:** they blocked
nothing, no setting of theirs can grant it, and the button does nothing. The
last is this epic's signature bug, arriving as the *remedy* for the other two.

#### Measured, with the two variables removed rather than reasoned about

`scratch/teams-shell-probe/microphone.mjs`, Chromium 1228. A **fake capture**
**device** and an explicit `grantPermissions(["microphone"])` on every arm, so
the user-permission layer is `granted` **everywhere by construction** and the
policy is the only thing that differs. An arm that failed for want of a device
or a grant would otherwise be indistinguishable from a policy refusal.

| Arm | `allowsFeature` | `permissions.query` | `getUserMedia` |
| --- | --- | --- | --- |
| top — **the control** | `true` | granted | resolved, **1 live track** |
| same-origin frame — **the second control** | `true` | granted | resolved, 1 live |
| **cross-origin, Teams' sandbox tokens** | **`false`** | **granted** | **rejected `NotAllowedError`** |
| the same + `allow="microphone *"` | `true` | granted | resolved, 1 live |

The same-origin arm carries Teams' own sandbox tokens, so this is a statement
about **cross-origin delegation**, not about being framed — the same split
`embedding.ts` established for notifications. The fourth arm makes it a
statement about **the parent**. `1 live track` rather than `resolved` because a
promise that resolves with an empty stream is a failure that reads as a success.

### 🔵 THE MEASUREMENT WORTH CARRYING: the obvious reading is `granted` in the one case that matters

The third column is not decoration. `navigator.permissions.query({name:"microphone"})`
returns **`granted`** in the refused arm.

That is the API a shell would naturally reach for — it is named for the
question, it reads as authoritative, and it answers **"has the user decided?"**,
which on this surface is a question nobody ever put to them. A module built on
it would agree with the app's existing conclusion, pass every test written
against the broken surface, and be **wrong in exactly the case it was written**
**for**. Only `document.featurePolicy.allowsFeature("microphone")` separates the
two refusals.

This is [[probe-read-gated-on-proxy-signal]] pointed at a permission layer: the
signal that fires *near* the thing measured, reported as the thing measured.

### 🟠 The seam that looks like the right place to fix this makes the message worse

`runnerHost.requestMicrophoneAccess()` is called **first** by the hook, and this
shell returns `"granted"` unconditionally. Teaching it to read the policy is the
obvious repair and it is a trap: the hook **short-circuits on `"denied"`**, so
it would reach the *same* "Microphone access is blocked for Traycer" copy and
the *same* dead button, one step earlier and with a measurement to justify it.

Its `"granted"` is also honest against its **actual** contract — the method
exists to drive the macOS OS-level prompt, and a browser has no such prompt. The
lying method was never the defect; the classifier downstream of it was.

### ✅ Built — `1ba52c14`, `clients/mobile/src/web/microphone-policy.ts`

One shell module, wrapping the platform object rather than editing upstream.
Three decisions, stated because they are the reviewable ones:

- **The native call happens FIRST and the policy reading never pre-empts it.**
Rejecting early on `allowsFeature === false` looks like a tightening and is the
one change here that could break a working surface — it hands a false negative
the power to disable a microphone that works. `MUT-10` makes exactly that
change and is caught by the row pairing a **refusing document** with a
**succeeding device**.
- **Only a rejection that is BOTH `NotAllowedError` AND made against a document**
**the policy refuses is re-described.** `NotFoundError` — no microphone
attached — and a genuine denial on a granted surface propagate untouched.
`MUT-4` drops the policy re-check and is caught by the PWA row: a fix that
suppressed the one message that is true and actionable would be worse than the
defect.
- **The replacement error is deliberately not named `NotAllowedError`.** That
name *is* the mechanism: anything else routes to upstream's generic branch,
which reports the message verbatim and leaves `permissionDenied` false — so the
dead Settings button is never offered. `MUT-5` renames it back, the words
improve and the outcome does not, and the seam row reddens.

`<html data-microphone>` joins `data-clipboard`, `data-native-notify`,
`data-wake-lock`, `data-push` and `data-storage-durable`:
`granted` / `policy-blocked` / `unmeasured` / `no-api`, **stamped at install**
rather than on first use. `unmeasured` is kept distinct from `policy-blocked`
for the reason `screen-wake-lock.ts` was rewritten: one is a measurement and one
is its absence.

**The arms above guess at Teams' `allow` attribute**, which is unreadable
without a real install. The document can read the delegated policy about
*itself* from inside the frame, so `data-microphone` answers it on the next
deploy rather than on another probe.

#### The feature is reachable here, and that was checked before anything was built

A fix for a button nobody can press is [[injected-branch-test-names-no-surface]].
The mic is gated on `useDictationAvailability`, and that gate reads
`speech.getModelStatus` — a **host** capability, not a browser one. Both
`speech.getModelStatus` and `speech.ensureModel` are on the released floor
(`protocol/src/host/released-floor.ts:88-89`), so there is no host-lacks-the-method
state to model, and `voiceInputEnabled` defaults to **`true`**. The mic button
therefore renders in **any** client whose host has the engine — the Teams tab
included.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **293 → 318**, 19 → 21 files, 0 failed |
| `mobile` `tsc -b --force` | **1 error, and the unmodified tip has the SAME 1** |
| `eslint --max-warnings 0 --no-fix` | **0** on all four source files |
| `tools/mutate-microphone.mjs` | **12/12 caught, 0 survivors**, each by its **named** test, control green first |

⚠️ **The `tsc` row is a comparison, not a green, and it was re-established**
**rather than inherited** — `git stash push -u` over the changed paths, re-run,
`git stash pop`. It names
`gui-app/src/editor-core/artifact-document-bundle.ts`, a file this run never
touched: the duplicate `prosemirror-model` (1.25.9 vs 1.25.11) diagnosed on
2026-08-11. **The baseline suite count (293 / 19 files) came from that same**
**stashed tree**, not from last run's entry — which is the only reason it can be
said to have been measured today.

**Seven eslint errors were fixed rather than suppressed**: three banned optional
parameters in the module and, in the test, a chained `as unknown as` assertion
and a banned default parameter value.

### 🔵 The probe caught its own author, and the count would have read 12 either way

`MUT-3` was written to drop the **audio guard** and its `why` says so. What it
actually mutated was the `isDenial` definition — **MUT-2's defect wearing MUT-3's**
**description**. It was reported as `caught, but NOT by its named test`, by
MUT-2's row.

**A duplicate mutation reads as coverage while measuring nothing new**, and the
totals cannot see it: `12/12 caught, 0 survived` was the output *before* the fix
as well as after. The only thing standing between that and a probe with an
unmeasured branch in it is the named-catcher check — the same reason this log
keeps insisting a mutation caught by "the suite went red somewhere" is not
caught. Recorded because the previous entry made the opposite error (a surviving
mutant that indicted the mutation, not the tests) and both repairs are "fix the
probe".

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **eleven** runs deep.
`data-microphone` joins `data-clipboard`, `data-native-notify` and
`data-wake-lock` in answering its open question **on that deploy and on nothing**
**else**. A **tenth** independent workstream is now parked on the same ten
attended minutes.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`openMicrophoneSettings()` is still a no-op**, and on the **PWA at top**
**level** that is a real defect this run did not fix: there, a user genuinely can
deny the mic, `permissionDenied` is correctly true, and the "Open Settings"
button they are offered still does nothing. A browser cannot navigate to its own
site settings from JS, so the honest repair is to stop *offering* the button —
and the button is upstream's toast, not this shell's. Flagged, not taken.
4. **No `clipboard-read`, no camera.** The `camera` policy is a separate feature
and nothing in gui-app requests video — verified, not assumed, which is what the
module's `requestsAudio` guard keeps honest.
5. **`TRAYCER_TEAMS_APP_ID`**, **the app package**, and
**`autobuild/conversational-bot`** — unchanged, as in every recent entry.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `25h30m` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time.

⚪ **The 16:15 entry's PENDING resolves as it predicted: STILL THE MIDDLE STATE.**
The last `cloud repair complete` in `host.log` is still **2026-08-11 19:15:16**,
earlier than that entry's write.

🟢 **The pile is now SEVEN and the mitigation held.** This entry is appended to
`docs/autobuild/unreconciled-checkin-entries.md` alongside the other six, under
version control and outside the repair's reach. **Not re-escalated** — a seventh
run repeating the sentence would be [[agents-decline-merges-pending-a-human]]
wearing a warning label.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**. If this still says
PENDING with no repair logged, that is the unmeasured middle state, not a pass.

## 2026-08-12 16:15 — every copy button in the Teams tab was dead, and the count of them was wrong twice

Fleet **idle**, checked rather than assumed for the eleventh consecutive run,
and re-checked at 16:45 before committing
([[liveness-read-expires-recheck-before-push]]). `main` untouched at `8fa892d1`;
the work landed on the `/next/` stack at **`c9167b3b`**, off last run's tip
`a10c30c9`, plus **`e1729669`**.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 16:16 and again at 16:45 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **44h** |
| `claude.exe` processes | **1** — this session, started 16:15:02. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**. Re-derived, not inherited: the artefact is **10,190 B** (unchanged) and H1 is still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: `clipboard-write` is delegated, and nobody delegated it

Under `convergence-architecture` the Teams client **is** the `/next/` bundle, so
the shell is the entire remaining parity surface. The last five runs took
notifications, push, external links, the wake lock and the notification retry
loop. This is the sixth module in that sweep and the **third** to turn out to be
a permissions-policy delegation — the same shape as the wake lock, on an API
nobody had thought to ask about.

`clipboard-write`'s default allowlist is `self`. A cross-origin frame is refused
it unless the parent says `allow="clipboard-write"`, and the refusal arrives as
a rejected promise. gui-app calls `navigator.clipboard.writeText` **nine times
across eight files** and routes none of them through a platform seam.

#### Measured, with the arm that cannot be faked

Headful Chromium 1228, every write inside a real click, and what reached the
**system clipboard** read back from a **separate browser context** whose own
grant cannot relax the policy in the arm's frame:

| Arm | `allowsFeature` | `writeText` | landed |
| --- | --- | --- | --- |
| top — **the control** | `true` | resolved | **YES** |
| same-origin frame — **the second control** | `true` | resolved | **YES** |
| **cross-origin, Teams' sandbox tokens** | **`false`** | **rejected `NotAllowedError`** | **NO** |
| the same + `allow="clipboard-write *"` | `true` | resolved | **YES** |

The same-origin arm carries Teams' own sandbox tokens, so this is a statement
about **cross-origin delegation**, not about being framed — the same split
`embedding.ts` established for notifications. The fourth arm makes it a
statement about **the parent**.

**Every arm was seeded with a distinct sentinel first**, so the refused arm
reads back `SEED-7` rather than an empty string. A write that did nothing is
*proven* to have done nothing, instead of being inferred from a blank.

### 🔵 THE MEASUREMENT WORTH CARRYING: the size of the finding was wrong twice, in opposite directions

The first count came from grepping for the word `clipboard` and reading the hit
count: **eleven call sites**. That number went into a commit message and three
source comments before it was checked.

Counted properly it is **nine calls across eight files** — the grep had counted
two comment lines and a `clipboard.write`. So the first number was too **high**.

And it was also far too **low**, which is the half worth keeping. One of those
eight files is `use-clipboard-copy.ts`, and **eighteen components copy through
it**: a chat message, a code block, a plan segment, a worktree path, an approval
field, the sign-in code. The honest statement is not "eight buttons" —
**it is that every copy button in the app was dead on the Teams tab.**

A grep count reads like a measurement and is a proxy for one. Both errors came
from the same act of not following the symbol, and the one that mattered was
invisible while the number merely looked precise.

### 🟠 Four of the eight report nothing at all

Both mermaid blocks and both wireframe blocks `void` a **single-argument**
`.then()`. On this surface the copy fails, no toast appears, and the rejection
is unhandled — the epic's signature *"the button did nothing"*, four times over.
The other four report an error correctly, which on this surface means correctly
telling the user that copy does not work.

### The fix, and the three things it deliberately does not do

`document.execCommand("copy")` over a hidden textarea landed the text in
**every arm, the refused one included** — it is gated on user activation, not on
the permissions policy. **Its success at top level is what makes its success in
the frame mean anything;** a fallback that worked nowhere would have been
indistinguishable from one blocked by the same policy.

- **It is not eight edits to upstream.** One shell module wraps the platform
object all of them reach for. Editing the call sites would be eight
divergences to carry across every future merge, to fix one property of one
surface.
- **The wrapper is installed UNCONDITIONALLY and the policy reading does not
gate it.** It tries the native call first and only falls back on a rejection,
so on a granted surface it is inert and a wrong policy reading cannot break a
working surface. `MUT-11` gates it on the reading — which looks like a
tightening — and is caught by the one row pairing a refusing *navigator* with
a *granted* document: the Firefox case, where the feature is held and the
write is refused anyway.
- **Resolving is not claiming.** When the fallback also fails the promise
rejects **with the browser's original `NotAllowedError`**, not an invention,
because `use-clipboard-copy.ts` logs whatever arrives there. `MUT-8` makes the
fallback always claim success and the seam row *"still reports failure honestly"*
reddens.

A fifth probe variant reproduced `composer-clipboard.ts`'s shape — an awaited
rich write, **then** the plain-text path — because a fallback installed at
`writeText` would still leave that caller broken if the gesture's transient
activation did not survive the await. It does.

`<html data-clipboard>` joins `data-native-notify`, `data-wake-lock`,
`data-push` and `data-storage-durable`: `granted` / `policy-blocked` /
`unmeasured` / `no-api`, then `fallback-copied` / `fallback-failed`.
**Stamped at install**, not on the first copy — an attribute that waits for
someone to press a button is absent for an unbounded stretch, which is the
`data-push` gap three modules ago. `unmeasured` is kept distinct from
`policy-blocked` for the reason `screen-wake-lock.ts` was rewritten: one is a
measurement and one is its absence.

**The arms above guess at Teams' `allow` attribute**, which is unreadable
without a real install. The document can read the delegated policy about
*itself* from inside the frame, so `data-clipboard` answers it on the next
deploy rather than on another probe.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **261 → 293**, 17 → 19 files, 0 failed |
| `mobile` `tsc -b --force` | **1 error, and the unmodified tip has the SAME 1** — see below |
| `eslint --max-warnings 0 --no-fix` | **0** on all four source files |
| `tools/mutate-clipboard.mjs` | **11/11 caught, 0 survivors**, each by its **named** test, control green first |

⚠️ **The `tsc` row is a comparison, not a green, and it was re-established
rather than inherited** — `git stash push -u` over the changed paths, re-run,
`git stash pop`. **1 error at the unmodified tip, 1 with the change**, and it
names `gui-app/src/editor-core/artifact-document-bundle.ts`, a file this run
never touched: the duplicate `prosemirror-model` (1.25.9 vs 1.25.11) the 16:15
entry of 2026-08-11 diagnosed. The baseline suite count (**261**) was taken from
the same stashed tree rather than copied from last run's entry.

**`MUT-1` restores the shipped behaviour and reddens six rows — measured, not
asserted.** Four are unit rows asserting the new API, so they could only have
been written once the fix was. **Two are seam rows** — upstream's real
`useClipboardCopy` and real `copyTerminalCommand` driving our real platform
object — stating the consequence in the units a user experiences, and those
could have been written, and failed, before any of this existed. That
distinction is the 12:15 entry's correction applied on the first pass instead of
the second.

### 🟢 A dead citation closed before it was written

`clipboard-fallback.ts` cites `scratch/teams-shell-probe/clipboard.mjs` for the
table above — and that directory has **never been committed**. Five earlier
probes sit there untracked, behind four earlier check-ins' findings.

None of the five is cited from shipped source *today*, so this was not a second
dead link being repaired; it was refusing to leave the next one to chance.
`e1729669` puts all six under version control (64 KB, scanned for credentials
first — `live-push.mjs` documents that it deliberately passes no bearer). A
cited measurement that cannot be re-run is [[stale-facts-need-derivations]]
with the derivation present and unreachable.

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **ten** runs deep, and
this change ships in that same bundle. A **ninth** independent workstream
parked on the same ten attended minutes. `data-clipboard`, `data-native-notify`
and `data-wake-lock` all answer their open questions on that deploy and on
nothing else.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.
6. **The four unhandled `.then()` call sites in gui-app are left alone.** The
fallback makes them succeed, so the missing handler no longer costs anything
on this surface — but it is still a real upstream defect on any surface where
copy fails for another reason. Fixing it is four upstream divergences for a
case the shell now covers, and it is upstream's to take.
7. **The user's prior selection is not restored** after a fallback copy. The
hidden textarea takes the selection and does not give it back. On the surface
where this path runs the alternative is that copy does nothing at all, so the
trade is one-sided; it is recorded rather than glossed.
8. **No `clipboard-read`.** Nothing in the shell pastes, so the read half was
neither measured nor handled. Stated so a later reader does not take the
`data-clipboard` reading as covering both directions.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `21h33m` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time. Pre-write size: **251,156 B**.

⚪ **The 12:15 entry's PENDING resolves the way it predicted: STILL THE MIDDLE
STATE.** Both readings, as it asked:

| Reading | Value |
| --- | --- |
| On disk | **251,156 B** — the 238,406 it recorded pre-write plus its own 12,750. Present and whole |
| `cloud repair complete` later than the 12:xx write | **none.** The last one in `host.log` is still **2026-08-11 19:15:16** |

🟢 **The pile is now SIX and the mitigation held.** This entry is appended to
`docs/autobuild/unreconciled-checkin-entries.md` alongside the other five, under
version control and outside the repair's reach. Loss risk stays defused;
divergence risk remains, which is what that file's own header is for. **Not
re-escalated** — a sixth run repeating the sentence would be
[[agents-decline-merges-pending-a-human]] wearing a warning label.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**. If this still says
PENDING with no repair logged, that is the unmeasured middle state, not a pass.

## 2026-08-12 12:15 — the Teams tab re-toasted its whole notification backlog every time a new one arrived

Fleet **idle**, checked rather than assumed for the tenth consecutive run, and
re-checked at 12:41 before committing ([[liveness-read-expires-recheck-before-push]]).
`main` untouched at `8fa892d1`; the work landed on the `/next/` stack at
**`86747393`**, off last run's tip `5d2a183e`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 12:16 and again at 12:41 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **40h** |
| `claude.exe` processes | **1** — this session, started 12:15:03. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**. Re-derived, not inherited: the artefact is **10,190 B** (unchanged) and H1 is still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: a notification that cannot be displayed is retried forever, and it takes the whole backlog with it

Under `convergence-architecture` the Teams client **is** the `/next/` bundle, so
the shell is the entire remaining parity surface. The last four runs took
notifications, push, external links and the wake lock. This is the fifth module
in that sweep, and it is the first one where the defect is **not in our module
at all** — it is in what upstream does with the answer our module gives.

`web-notification-host.ts` rejects when it cannot display, and says why:

<user_quoted_section>Upstream's `NotificationEmissionController` records a display receipt in `.then()` and, in `.catch()`, says so in its own words: "Keep the receipt pending so a later mount can retry native display." A resolve-anyway implementation would mark every undisplayed notification as delivered, so granting permission later would surface nothing and the backlog would be permanently swallowed.</user_quoted_section>

**That reasoning is correct and it is the whole argument for rejecting.** It
rests on there being a *later mount* at which the grant might have changed.
**In a cross-origin frame there is not one** — the 20:15 run measured it in four
arms: `Notification.permission` reads `denied` at load, and
`allow="notifications *"` from the parent does **not** restore it.

So on the Teams tab the receipt is never recorded, the row never leaves the
pending set, and `NotificationEmissionController` re-drains **the entire
backlog** on every store change. `displayNotificationRowsAwaitNative` renders
the toast and plays the chime *before* awaiting the native promise, so each
re-drain is a fresh toast and a fresh chime for a notification the user saw
hours ago.

#### Measured with BOTH real halves, which is the only place this is visible

Upstream's real `NotificationEmissionController` driving this real host,
nothing between them mocked, three arrivals:

| Arm | toasts for row 1 after 2 more arrivals | reached the worker |
| --- | --- | --- |
| `granted` — **the control** | **1** | 3 |
| transient denial — **the second control** | 3 | 0 |
| **permanently blocked** | **3** | 0 |

**The granted control is what makes this a defect rather than a description.**
Without it, "row 1 toasted three times" is equally consistent with a controller
that re-toasts everything on every arrival on every surface, which would be
upstream's bug and not ours. It displays once and stops, so the retry is
specific to the rejection.

This is [[both-ends-green-seam-untested]] exactly. Both halves have been green
for weeks: upstream tests the controller against a stub `show()`, and
`web-notification-host.test.ts` tests `show()` against a stub registration.
Neither can see this, because the defect is the *pairing* — a correct rejection
meeting a correct retry policy on a surface where the premise of the retry is
false.

### The fix, and the three things it deliberately does not do

**A permanent block RESOLVES; a transient denial still rejects.** The receipt's
meaning is *"this row has been through the display path; do not replay it"*, and
on a surface with no native channel and a toast already rendered, that is simply
true. Rejecting is a claim about a future that was measured not to exist, which
is the more expensive lie.

- **It is not "stop rejecting".** The transient arm is a **control in the test
suite**, not a note: a top-level browser whose user has not granted keeps
retrying, because there the grant genuinely can change and swallowing the
backlog is upstream's stated failure. `MUT-5` makes the default block every
surface and that control reddens.
- **The surface question is asked only AFTER the permission gate fails**, and
the order is load-bearing. A same-origin frame is embedded **and** granted —
measured — so an implementation that checked the surface first would withhold
notifications from a surface that honours them, *causing the defect it was
written to describe*. `MUT-3` inverts the order; one row catches it.
- **Resolving is not a claim that anything was drawn.** `shown` stays empty in
that arm and a test asserts it. The fix is about the retry, not about
pretending.

`<html data-native-notify>` joins `data-notifications`, `data-push`,
`data-wake-lock` and `data-storage-durable`: `idle` / `shown` /
`surface-blocked` / `permission` / `no-worker`. **Stamped at construction**,
because otherwise the attribute is absent until a notification arrives — and
that silent window is unbounded on a quiet day. That is the same three-state gap
`data-push` carried on this exact surface four runs ago.

### 🔵 THE MEASUREMENT WORTH CARRYING: the instrument reported zero because it was never connected

The first run of the seam probe reported **0 toasts in every arm, including the
control**. Read as a result that says the controller never displays anything;
read correctly, it is the harness indicting itself — the same shape as the
CORS-blocked framing probe whose arms all failed together.

`sonner` is declared by `gui-app` alone and bun does **not** hoist it. So a
gui-app module imported from a **mobile** test resolves it out of
`clients/gui-app/node_modules`, while `vi.mock("sonner")` in the mobile package
resolves **nothing at all**. The mock registered, never bound, and the spy
reported zero — which reads *exactly* like "the code never toasted".

**No error is raised for a `vi.mock` that resolves nothing.** The failure is a
number that means "absent" arriving where a number that means "none" was
expected, and the two are indistinguishable at the assertion. Fixed by pinning
both sides to one path in the vitest config, which is where this repo already
handles the identical problem for `@traycer/protocol`.

**What caught it was the control, not a suspicion.** A treatment arm reading 0
looks like a finding; a *control* arm reading 0 cannot be one.

### 🟠 A claim this run made about its own probe, corrected by measuring it

The probe's docblock asserted that `MUT-1` — which restores the shipped code
exactly — is caught **only** by the seam test, every function-level assertion
staying green. That is the shape of the `data-push` defect and it read well.
**It is wrong.** Measured by applying the mutation and listing the failures:
**three** rows redden, two unit and one seam.

Corrected in the file rather than quietly dropped, because the honest version is
the more useful one: all three were written *with* the fix, so none existed
while the defect shipped. The two unit rows assert the new API behaves as
designed and **could only have been written once the fix was**; the seam row
states the consequence in the units a user experiences and **could have been
written, and failed, before anything changed**. A test that can only exist after
the repair does not tell you the repair was needed.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **252 → 261**, 17 files, 0 failed |
| `mobile` `tsc -b --force` | **1 error, and the unmodified tip has the SAME 1** — see below |
| `eslint --max-warnings 0 --no-fix` | **0** on all four source files |
| `tools/mutate-native-notify.mjs` | **8/8 caught, 0 survivors**, each by its **named** test, control green first |

⚠️ **The `tsc` row is a comparison, not a green, and it was re-established
rather than inherited.** The error is the duplicate `prosemirror-model`
(1.25.9 vs 1.25.11) in `gui-app/src/editor-core/` that the 16:15 entry
diagnosed. That entry's finding is six runs old, so it was re-measured the way
it was made: `git stash push -u`, re-run, `git stash pop` — **1 error at the
unmodified tip, 1 error with the change, and it names a file this run never
touched.** [[blockers-expire-silently]] applies to inherited *green* excuses as
much as to blockers.

### Two checked non-findings, filed so they are not re-investigated

| Predicted | Measured |
| --- | --- |
| **`clients/mobile`'s dependencies are not installed on this lineage** — the trap the 16:15 entry hit, where a suite failed to collect and read as a broken import | **False, and the probe was wrong rather than the tree.** `Test-Path node_modules/@microsoft/teams-js` at the **repo root** reads false because bun installs it per-package; it is present at `clients/mobile/node_modules`. `bun install` reporting *"no changes"* alongside a false root check looks exactly like [[bun-install-no-changes-lies-about-the-tree]] and was neither |
| **`main.tsx` needs a change to wire the new behaviour** — the `data-push` defect one module over was entirely in the caller | **False.** `createWebNotificationHost({})` already takes both new defaults, so the caller is correct untouched. Checked rather than assumed, because the last time this module family was touched the function was right and the caller was the whole bug |

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **nine** runs deep,
and this change ships in that same bundle. An **eighth** independent workstream
parked on the same ten attended minutes. `data-native-notify` and
`data-wake-lock` both answer their open questions on the next deploy and on
nothing else.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.
6. **The chime is not separately measured.** `playNotificationChime` returns
early where `window.AudioContext` is absent, which jsdom is, so the toast count
is the whole of the evidence. The two are called unconditionally from the same
function three lines apart, so the ratio is not in doubt — but it is read from
source rather than measured, and it is stated that way.
7. **A browser arm for this change.** The retry loop is upstream React state and
reproduces faithfully in jsdom; what a browser would add is the *permission*
reading, and that was measured in four arms by the 20:15 run rather than
re-measured here.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `17h00m` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time. Pre-write size: **238,406 B**.

⚪ **The 08:15 entry's PENDING resolves the way it predicted: STILL THE MIDDLE
STATE.** Both readings, as it asked:

| Reading | Value |
| --- | --- |
| On disk | **238,406 B** — the 227,752 it recorded pre-write plus its own 10,654. Present and whole |
| `cloud repair complete` later than the 08:xx write | **none.** The last one in `host.log` is still **2026-08-11 19:15:16** |

🟢 **The pile is now FIVE and the mitigation held.** This entry is appended to
`docs/autobuild/unreconciled-checkin-entries.md` alongside the other four, under
version control and outside the repair's reach. Loss risk stays defused;
divergence risk remains, which is what that file's own header is for. **Not
re-escalated** — the attended minute buys the *fix* (restarting sync needs the
epic opened in the desktop app), and a sixth run repeating the sentence would be
[[agents-decline-merges-pending-a-human]] wearing a warning label.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**. If this still says
PENDING with no repair logged, that is the unmeasured middle state, not a pass.

## 2026-08-12 08:15 — a question this log called "genuinely unknown" three times was answered by one launch flag

Fleet **idle**, checked rather than assumed for the ninth consecutive run, and
re-checked at 08:39 before committing ([[liveness-read-expires-recheck-before-push]]).
`main` untouched at `8fa892d1`; the work landed on the `/next/` stack at
**`3b734f5e`**, off last run's tip `c5defb2d`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 08:16 and again at 08:39 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **36h** |
| `claude.exe` processes | **1** — this session, started 08:15:02. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits** |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**. Re-derived, not inherited: the artefact is **10,190 B** (unchanged) and H1 is still *"did a sentence you typed get an answer you could see?"*, which is Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔵 The finding is about this log, not only about the code

Three consecutive entries — 20:15, 00:15, 04:15 — carried the same line in
*Not done, deliberately*:

<user_quoted_section>The screen wake lock in Teams — still genuinely unknown. Its top-level controlcannot fire headless, so no framed arm means anything.</user_quoted_section>

**That reasoning was correct and the conclusion was wrong.** The control did
fail, and a probe whose control fails really does say nothing about its
treatment arms. What no run checked is *why* it failed. The reason recorded —
"headless has no screen" — **names the mechanism**, and the mechanism was a
property of the probe: `chromium.launch()` defaults to headless, so that control
could not have passed under any arrangement of the thing being measured.

One flag. `headless: false`, four arms, Chromium 1228:

| Arm | `allowsFeature("screen-wake-lock")` | `wakeLock.request` |
| --- | --- | --- |
| top level — **the control** | `true` | **held** |
| same-origin frame — **the second control** | `true` | **held** |
| cross-origin frame, Teams' own sandbox tokens, no `allow` | **`false`** | **`NotAllowedError`** |
| the same frame + `allow="screen-wake-lock *"` | `true` | **held** |

The same-origin arm makes this a statement about **delegation**, not about
framing — the same split `embedding.ts` established for notifications. The
fourth arm makes it a statement about **the parent**, not the surface.

This is [[untestable-by-construction-was-untried]] with a twist worth keeping:
the deferral was not lazy, it was *well-argued*, and it named its own mechanism
in the sentence that made it sound final. **A deferral that names a mechanism is
a deferral you can falsify.** Three runs read that line and re-copied it.

### 🔴 And the code had the defect the answer exposes

`wakeLock.request` rejects with **`NotAllowedError` for both** a permissions-policy
refusal and a battery-saver refusal. The shell reported both as `unavailable`:

- **permanent** — this document is not granted the feature, cannot be, and every
retry is guaranteed to fail
- **transient** — permitted, refused right now, will succeed later

Same reading, opposite next actions. Worse than a bad label: the module
re-requested on every `visibilitychange`, so on a forbidden surface it asked for
a lock it could never hold **on every tab switch, for the life of the tab**.

🔵 **THE MEASUREMENT WORTH CARRYING: the answer Teams cannot be asked for is one
the app can read about itself.** `document.featurePolicy.allowsFeature("screen-wake-lock")`
reads `false` in exactly the refused arm and `true` in all three that hold. Prior
runs concluded the question needed *"Teams' own `allow` attribute, unreadable
without a real install"* — true of a **probe**, and false of the **bundle**, which
runs inside the frame and can read the delegated policy directly. So
`<html data-wake-lock>` now answers it on the real install: `policy-blocked` or
`held`. **A three-run open question closes on the next deploy rather than on
another probe.**

### The fix, and the two things it deliberately does not do

- **`policy-blocked` returns**, it does not fall through. Permissions policy is
fixed at document creation and cannot change without a navigation, so there is
no state to retry out of. `MUT-3` is the sibling that keeps the new reading and
drops the return — it reports correctly and then resumes the pointless loop.
- **It is NOT called `surface-blocked`** like `notification-permission.ts`, and
the difference is load-bearing. That one **infers** a block from being
cross-origin, because notifications expose no policy read. This one **reads the
policy**. Sharing a name would say the two were established the same way, and
only one of them is a measurement.
- **Where the policy API is absent** — Firefox, Safari, jsdom — the unknown
resolves toward **attempting**, matching the module's existing bias that only an
explicit `off` disables it. `MUT-6` inverts it and reddens ten rows.
- **A wrong attribution deleted**: the `catch` comment named *"an unsupported
surface"* among its causes. The permitted/forbidden split now returns above it,
so a forbidden surface cannot reach that line. Same family as the two removed
from `push-subscription.ts` at 00:15 — a comment naming a surface that cannot
arrive is how a green suite keeps a false belief.

### 🟠 The second, smaller half — and the half that is NOT measured

Hidden at startup, the module reported **nothing at all**: `<html>` carried no
`data-wake-lock` attribute of any kind, and **a green test asserted exactly
that** (`expect(h.outcomes).toEqual([])`) — against the module's own docblock
promise that the attribute says what it did. That is
[[measurements-need-three-states]] enshrined as a passing assertion. Now
`deferred`, on that path and on the hide-while-held path, where the attribute
used to go on asserting `held` at the one moment the lock provably is not held.

⚠️ **Not measured in a browser, and stated rather than glossed.** A fifth arm
opened a second tab, brought it to the front and navigated behind it — a
restored session, a middle-click, a Teams tab switched away from. It read
**`visibilityState: "visible"`**. Automated Chromium will not background a page,
the same wall as [[push-subscribe-unavailable-in-automated-chrome]]. So this half
is covered in **jsdom only** and is filed as unmeasured, not as a pass. The
primary finding does not rest on it.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **241 → 252**, 16 files, 0 failed |
| `mobile` `tsc -b --force` | **0 errors**, `--listFiles` says **4,811 files** with both changed files in the set — not the `files: []` empty-set green |
| `eslint --max-warnings 0` | **0** on both changed source files |
| `tools/mutate-wake-lock.mjs` | **10/10 caught, 0 survivors**, each by its **named** test, control green first |

**`MUT-1` is the mutation worth having**: it restores the shipped code verbatim
and the suite reddens on the row named *"is a DIFFERENT reading from a permitted
surface whose request is refused"*. `MUT-8` is the quiet one — it asks the policy
about `fullscreen` instead and reports the answer as this feature's, which every
structural assertion would have passed.

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **eight** runs deep,
and this change ships in that same bundle. A **seventh** independent workstream
parked on the same ten attended minutes. It is also now the thing standing
between Elliot and the wake-lock answer: `data-wake-lock` cannot report from a
bundle that was never built.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.
6. **The screen wake lock in Teams** — *removed from this list.* The mechanism is
now measured and the surface reports itself; what remains is a deploy, which is
item 1, not a separate unknown.
7. **Restarting `EpicFileSync`** — still genuinely Elliot's: it needs the epic
opened in the desktop app. But the *exposure* it created is no longer waiting on
him — see the survival check below.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `13h14m` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time. Pre-write size: **227,752 B**.

🟢 **Last run's PENDING resolves: all three prior entries are intact on disk.**
20:15, 00:15 and 04:15 each match `^## <date> <time>` exactly once, and the file
is **227,752 B** — grown from the 215,736 B recorded pre-write at 04:15, so that
entry landed and nothing has overwritten it.

🔴 **But the pile is now FOUR, not three, and that is the reading that matters.**
The last `cloud repair complete` in `host.log` is **2026-08-11 19:15:16** —
*before* all four entries. Survival on disk is not reconciliation: per
[[cloud-repair-overwrites-disk-edits]] the next session to open runs a repair
that writes ~210 artifacts over the disk, and all four meet it **together**, so a
single event can still take all of them. The pile grows by one every idle
check-in.

🟢 **So this run stopped re-flagging it and defused the half that does not need
Elliot.** All four entries are now copied verbatim to
`docs/autobuild/unreconciled-checkin-entries.md` at **`87172f92`** — under
version control, outside the repair's reach entirely. Three runs escalated this
and a fourth would have been the same sentence again; **the attended minute buys
the FIX (restarting sync means opening the epic in the desktop app, which
nothing unattended can do), but it was never what stood between the entries and
a repair.** Loss risk is gone; divergence risk remains, which is what the file's
first three lines are for — the epic artifact stays authoritative, the copy says
so, and it says how to retire itself.

**PENDING** for this entry — answered only by **two readings**: the byte length,
and a `cloud repair complete` **later than this write**. If this still says
PENDING with no repair logged, that is the unmeasured middle state, not a pass.

## 2026-08-12 04:15 — the Teams tab's only door out cannot tell success from refusal, and neither could the obvious fix

Fleet **idle**, checked rather than assumed for the eighth consecutive run, and
re-checked at 04:43 before writing ([[liveness-reads-expire-recheck-before-push]]).
`main` untouched at `8fa892d1`; the work landed on the `/next/` stack at
**`c5defb2d`**, off last run's tip `845578b5`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 04:16 and again at 04:43 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **32h** |
| `claude.exe` processes | **1** — this session, started 04:15:03. No collision |
| `[ERROR]` in the current `host.log` | **0** — and 0 in the whole file, not only today |
| Genuine rate-limiting | **none** — level-anchored (`[WARN]`/`[ERROR]` **and** the word). **0 hits**, so the connection-UUID `429` trap did not even fire this run |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**. Re-derived, not inherited: the artefact is **10,190 B** (unchanged) and H1 is still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: everything that leaves the app goes through one line, and that line cannot report failure

Under `convergence-architecture` the Teams client **is** the `/next/` bundle, so
the shell is the entire remaining parity surface. The last two runs took
notifications and push. This is the third module in that sweep, and it is the
one with sign-in behind it.

`capacitor-web-shim.ts` shipped, in full:

```ts
async open(options: { url: string }): Promise<void> {
  window.open(options.url, "_blank", "noopener,noreferrer");
}
```

**Everything out of the app goes through there.** gui-app's `MarkdownAnchor`
routes every `http(s):`/`mailto:` click to `runnerHost.openExternalLink`
(`markdown-anchor.tsx:96`), and so does **device-code SIGN-IN** —
`auth-service.ts:874` opens `verificationUriComplete` through the same method.
On the Teams tab this one call is the app's only door out.

#### Measured, three arms, and the second reading is what makes the first mean anything

Chromium 1228, every open fired inside a **real click**. `pagesOpened` is counted
by the **driver**, from outside the page, via the browser context's own `page`
event — not something the page under test can report about itself.

| Arm | shipped call returned | a page actually opened |
| --- | --- | --- |
| top level — **the control** | `null` | **yes** |
| cross-origin frame, Teams' own sandbox tokens | `null` | **yes** |
| cross-origin frame, no `allow-popups` — **negative control** | `null` | **NO** |

**All three read `null`, and one of them opened nothing.** Success and refusal
are the *same observation*. So this is not a missing check — there is no return
value to check.

🔵 **THE MEASUREMENT WORTH CARRYING: the obvious fix is worse than the bug.**
The second control pins the mechanism — dropping `noopener` returns an `object`
on success and `null` on refusal, so the value **would** discriminate. Which
means a `w === null` check on the *shipped* call reports **"blocked" on every**
**successful open, on every surface, forever** — while the only way to make it
honest is to hand an arbitrary agent-authored link a live `window.opener` back
into a signed-in app. `MUT-2` is that fix, and exactly one test catches it.

This is the same family as the 16:15 `location.hash` finding: the one-line
repair that looks most obviously correct, refuted by reading the mechanism
rather than the docs.

### The fix is a different door, not a better check

`@microsoft/teams-js` has `app.openLink(url)`; it is **already in this bundle**
and the SDK is **already initialized** by `teams-host.ts`. Read out of the
installed package rather than from documentation: it resolves through
`sendAndHandleStatusAndReason` (`internal/appHelpers.js`), so a host refusal
comes back as a **rejection**. That is the only observable failure signal this
surface has.

- **`external-link.ts`** owns the routing and reports at
`<html data-external-open>` — `teams` / `teams-refused` / `window-unverified` /
`unavailable` kept distinct, same device as `data-notifications` and `data-push`.
**`window-unverified` is deliberately not called `window`**: it is the state the
whole module exists because of, and naming it after the thing it cannot
establish is how the next reader re-learns this the hard way.
- **On a refusal the user is shown the URL, selectable.** A Teams personal tab
has no address bar and no back button, so a user whose sign-in link silently
did not open has no way to reach it and no way to know why. Rendered as a
`<code>`, not an anchor — an anchor here would be a link offered as the remedy
for a link that would not open, taking the same refused path.
- **The note names Teams**, which `notification-permission.ts` deliberately does
not. Legitimate here and not a drift: that module only knows it is cross-origin
embedded, whereas this branch is reachable *only* through an opener registered
after a **successful SDK handshake**. Being in Teams is established, not guessed.
- **The opener is registered only after the handshake succeeds**, and that
gating is the load-bearing part. Handing it over earlier would route every link
on the **PWA** into an SDK with no host to answer — a wider failure than the one
being fixed, reached by the fix for it. `MUT-7` holds it.
- The window fallback still runs after a refusal, and **must not change the**
**reported outcome**: a fact (Teams refused) must not be overwritten by a guess
(a call whose result is unknowable). `MUT-6` holds that ordering, and the note's
copy — *"if it did not open in your browser"* — is true either way rather than
hedging.

⚠️ **What this does NOT claim, stated because the overreach is available and**
**tempting.** Nothing here measures the real Teams client. The probe shows a
refusal is **reachable** and that `window.open` cannot report one; it does
**not** show that Teams refuses — under Teams' own sandbox tokens a localhost
parent **permitted** the popup. The case for `openLink` is that it is
Microsoft's API for this, costs nothing extra, and has a failure path. *"Popups*
*are blocked in Teams"* is unmeasured and is asserted nowhere, in the commit or
in the source.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **213 → 241**, 16 files, 0 failed |
| `mobile` `tsc -b --force` | **0 errors**, and `--listFiles` says **4,811 files** with every changed file in the set — not the `files: []` empty-set green |
| `eslint --max-warnings 0` | **0** on all **7** changed files |
| `tools/mutate-external-link.mjs` | **10/10 caught, 0 survivors**, each by its **named** test, control green first |

**`MUT-2` is the mutation worth having**: it applies the obvious fix and the
suite reddens on the one row that says the return value must not be read.
**`MUT-1` and `MUT-9`** are the other two — they restore the bare popup call in
the shim, and delete the registration from `main.tsx`. Both leave every
function-level assertion green, which is why two **source-contract** tests exist
here: it is precisely the shape that hid `data-push` for weeks one module over,
where the function was right and the caller never called it.

🔵 **The probe's own runner never started, and its `catch` reported that as a**
**red suite.** `execFileSync("npx.cmd", …)` throws `EINVAL` under Node 24's spawn
hardening, and the first draft absorbed that in the same `catch` that absorbs a
legitimately red suite — so vitest never ran and every mutation would have been
"measured" against a stale report. Caught because the report file was missing
rather than by noticing the exit code. Fixed with `shell: true`, and the absence
of a report is now a **hard abort**: *"the suite produced no report"* and *"the*
*suite passed"* must never collapse into one reading. A failure path that prints
the success message, inside the tool built to hunt them.

### Two checked non-findings, filed so they are not re-investigated

| Predicted | Measured |
| --- | --- |
| **`/next/` re-introduces the retired tab's link defect** — every link a bare `<a href>` that navigates the Teams iframe away, the 2026-08-05 🔴 finding against `clients/teams-tab` | **False, and upstream is better than our retired client was.** `MarkdownAnchor` intercepts every click, `classifyHref` splits external / file / ignore, and only same-document `#fragment` anchors keep native navigation. The whole never-navigate-away property holds. This run's defect is one layer *past* it — the door exists and is correct; it is the doorway that is silent |
| **`window.open` is refused under Teams' sandbox tokens** — the opening hypothesis, and the reason the probe was built | **False.** Under Teams' own token set the popup opened, in a real browser. Had the hypothesis been built on rather than measured, the entry would have asserted a blockage that does not reproduce — and the *real* finding (that success and refusal read identically) would have been missed, because it needs the arm where the open SUCCEEDS to be visible at all |

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **seven** runs deep,
and this change ships in that same bundle. A **sixth** independent workstream
parked on the same ten attended minutes.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.
6. **The screen wake lock in Teams** — still genuinely unknown, unchanged.
7. **A live-module browser arm for this change.** The three-arm table above runs
the *real* `window.open` in a real browser, so the mechanism is measured; but
`external-link.ts` itself is covered in jsdom only. The Teams branch is
unreachable without Teams, so a framed arm could exercise only the window path —
worth having, not worth claiming as the seam.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window, now `9h28m` deep** —
`EpicFileSync` stopped **2026-08-11 19:15:33** and had not restarted at write
time. Pre-write size: **215,736 B**.

🔴 **There are now THREE consecutive entries on disk that no repair has ever**
**reconciled** — 20:15, 00:15 and this one. Per
[[cloud-repair-overwrites-disk-edits]] the next session to open runs a repair
that writes ~210 artifacts over the disk, so all three meet that repair
**together** and a single event can take all of them. The pile grows by one
every idle check-in. **This is the first thing worth an attended minute**, ahead
of the deploys, and it is the third run in a row saying so.

**PENDING** — answered only by **two readings**: the byte length, and a
`cloud repair complete` **later than this write** in `host.log`. If this still
says PENDING with no repair logged, that is the unmeasured middle state, not a
pass.

## 2026-08-12 00:15 — the Teams tab reported nothing at all about push, and "nothing" is not one of the five states

Fleet **idle**, checked rather than assumed for the seventh consecutive run, and
re-checked at 00:36 before writing. `main` untouched at `8fa892d1`; the work
landed on the `/next/` stack at **`845578b5`**, off last run's tip `af75430e`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active**, at 00:16 and again at 00:36 |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in **28h** |
| `claude.exe` processes | **1** — this session, started 00:15:03. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored, every match read. Zero hits for `rate.?limit`/`too many requests`/`overloaded` |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**. Re-derived, not inherited: the artefact is **10,190 B** (unchanged) and H1 is still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: `data-push` was ABSENT on the Teams tab — and absent is not a value, it is the middle state

Last run established that under `convergence-architecture` the Teams client
**is** the `/next/` bundle, so the shell is the entire remaining parity surface.
This is the next defect in it, found by carrying last run's own question one
module sideways: *the notification attribute was lying about the Teams tab — what*
*does its sibling attribute say?* The answer was **nothing whatsoever**.

`push-subscription.ts` opens with the promise:

<user_quoted_section>THE OUTCOME IS EXTERNALLY READABLE at `<html data-push>`, with every negativestate kept distinct … `permission`, `signed-out` and `unavailable` want threedifferent next actions, and a probe that can only see "not subscribed" cannottell which one it is looking at.</user_quoted_section>

**That promise was kept on every surface except the one where the answer is**
**permanent.** And the gap was not in the file — it was one caller away, in
`main.tsx`:

```ts
report: (outcome) => {
  document.documentElement.dataset.notifications = outcome;
  if (outcome !== "granted") return;      // ← the whole defect
  void ensurePushSubscription({ getBearer: getBearerToken });
},
```

An embedded surface reports **`surface-blocked`** — measured last run, and it
never reads `granted`. So the guard meant `ensurePushSubscription` **was never
called on the Teams tab at all**, and `<html>` carried no `data-push` attribute
of any kind. That is [[measurements-need-three-states]] exactly: absent is
indistinguishable from *an old bundle with no push code*, from *a boot path that
threw before reaching it*, and from *push working but unmeasured* — collapsed
into silence on the single surface where the user can do nothing about the answer.

#### Measured, three arms, real modules, no injection anywhere

| Arm | `data-notifications` | `data-push` |
| --- | --- | --- |
| top — **control** | `granted` | `signed-out` |
| same-origin frame — **control** | `granted` | `signed-out` |
| **cross-origin frame** (Teams' own sandbox tokens) | `surface-blocked` | **`surface-blocked`** |

Both controls pass, so the change is not withholding push from surfaces that
support it — which a one-armed probe could not have said.

**`signed-out` is the deliberate control reading, not an accident.** No bearer is
passed, and the bearer check sits **after** the permission gate — so a control
reading `signed-out` proves the path ran *past* the gate rather than
short-circuiting at it. It is also the only deterministic positive available
here: [[push-subscribe-unavailable-in-automated-chrome]] means a `subscribed`
control is not obtainable in this environment, and this run did not pretend
otherwise.

#### 🔵 The negative control, because the probe was otherwise unfalsifiable

A probe that reads an attribute and prints PASS cannot tell a reader whether it
would ever have printed anything else. `PROBE_GUARD=1` re-adds the shipped guard:

| Arm | `data-push` with the guard restored |
| --- | --- |
| top — control | `signed-out` |
| same-origin — control | `signed-out` |
| **cross-origin** | **`null` — the attribute is absent** |

So the defect is reproduced in a browser and the probe discriminates. Without
this row the three-arm table above would be [[probe-read-gated-on-proxy-signal]]
wearing a verdict list.

### The fix, and the one thing it deliberately does not do

- **`surface-blocked` is a sixth push outcome**, checked before the permission
gate and keyed on **`denied` AND cross-origin** — mirroring
`offerNotificationPermission` exactly, through the same `embedding.ts`.
- **The condition is NOT widened to "not granted AND embedded".** On an embedder
that leaves the permission at `default`, the notification shell is still
rendering a real Enable offer, so a push layer calling that surface blocked would
**contradict a banner the user is looking at**. Two attributes disagreeing about
one surface is worse than one of them being coarse. `MUT-P4` holds this.
- **The guard is deleted, not widened.** Unconditional is free: the permission
gate is the first line of `resolve`, before any network call.

### 🟠 Two wrong attributions removed — and this is the sharper half

`push-subscription.ts` **named the Teams tab under two outcomes it cannot reach**:

| The comment said | Why it is wrong |
| --- | --- |
| `unsupported` — *"No `PushManager` here — **a Teams tab**, an insecure origin, jsdom, iOS Safari before 16.4"* | The permission gate returns first. A Teams tab cannot arrive |
| the `ready` catch — *"rejects where registration itself is forbidden … **which is the Teams tab this same bundle serves**"* | Unreachable for the same reason **and its premise was measured FALSE last run**: the worker registers in a cross-origin frame in all three arms, same scope |

`unsupported` has a passing test. It is a good test. **A test that reaches a**
**branch by injection says nothing about which real surface reaches it** — which
is precisely how a wrong attribution survives in a green suite, and it is the
same shape as [[both-ends-green-seam-untested]] pointed at a comment instead of a
wire.

### Gates

| Gate | Reading |
| --- | --- |
| `mobile` suite | **205 → 213**, 15 files, 0 failed |
| `mobile` `tsc -b --force` | **0 errors** |
| `eslint --max-warnings 0` | **0** on every changed file |
| `tools/mutate-notifications.mjs` | **26/26 caught, 0 survivors** — 20 pre-existing plus **6 new** |

**`MUT-P1` reproduces the shipped defect exactly** and is the mutation worth
having: it re-adds the guard to `main.tsx`, and the **only** thing in the suite
that catches it is the new source-reading test. Every function-level test stayed
green while the tab reported nothing, because they test the function and the bug
was in whether it is called.

That test genre is not invented here — `teams-theme-param.test.ts` already reads
`main.tsx` and asserts ordering against its source, including a found-but-empty
guard so no row can pass by matching nothing. Copied, including the guard.

🔵 **`tsc` reported `0` through a pipe on the first attempt and had not run.**
`npx tsc` resolved to the *"This is not the tsc command you are looking for"*
stub, and `$?` after a pipe read `tail` — [[pipeline-masks-exit-status]] and a
wrong binary in one line. Re-run against `../../node_modules/.bin/tsc.exe` with
the status captured before the pipe.

### Two checked non-findings, filed so they are not re-investigated

| Predicted | Measured |
| --- | --- |
| **The Teams tab reports `data-push="permission"`** — this run's opening hypothesis, and it is what the module's own comments imply | **False, and one layer earlier again.** It reports *nothing*: the caller never runs. Had the hypothesis been built on rather than measured, the fix would have re-worded an outcome that is never produced. Note the verdict row *"is NOT `permission`"* passes in **both** probe arms — `null` is not `permission` either — so that row is honest evidence the guess was wrong, not a check |
| **The PWA offers an "Install" button that is dead in Teams** — `beforeinstallprompt` cannot fire in an iframe | **False — there is no install affordance at all.** `pwa-shell.ts` renders one banner and it is the *update* banner, gated on `controller !== null`. Nothing to be dead |

### ✅ The 20:15 entry survived — but its own check still cannot be answered, and the risk has COMPOUNDED

Last run left a **PENDING** survival check to be answered *"after a `cloud repair`*
*`complete`"*. Answering it honestly needs both halves:

- **On disk it is intact.** Pre-write **191,722 B** → now **204,270 B**, and the
entry reads whole.
- **But no repair has run.** The last `cloud repair complete` in `host.log` is
**19:15:16** — *before* that entry was written. `EpicFileSync` **stopped at**
**19:15:33 and has not restarted**, because the fleet is idle and no chat session
has opened to restart it.

So the entry is not intact *because it survived a repair*; it is intact because
**nothing has run that could delete it.** That is the unmeasured middle state
again, and calling it PASS would be the exact error this log exists to prevent.

🔴 **The risk is now compounding rather than resting.** The sync has been down
**5h20m**, and there are now **two** consecutive entries accumulated on disk that
have never been reconciled. Per [[cloud-repair-overwrites-disk-edits]], the next
session to open runs a repair that writes ~210 artifacts over the disk — so both
entries meet that repair **together**, and a single event can take both. Every
further idle check-in adds one more entry to the same unreconciled pile. This is
the first thing worth an attended minute after the deploys.

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, now **six** runs deep, and
this change ships in that same bundle. A **fifth** independent workstream parked
on the same ten attended minutes.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.
6. **The screen wake lock in Teams** — still genuinely unknown, unchanged from
last run. Its top-level control cannot fire headless, so no framed arm means
anything, and `screen-wake-lock` **is** delegable — making it a question about
Teams' own `allow` attribute, unreadable without a real install.

### Survival check on this entry

⚠️ **Written into the same KNOWN-DOWN sync window**, recorded rather than hoped
past: `EpicFileSync` stopped **19:15:33**, still stopped at write time.
Pre-write size: **204,270 B**.

**PENDING** — and the next check-in should answer it the way this one answered
its predecessor: **two readings, not one.** The byte length says whether the text
is on disk; only a `cloud repair complete` **later than this timestamp** in
`host.log` says whether it survived anything. If this still says PENDING with no
repair logged, that is the unmeasured middle state, not a pass.

⚪ **ANSWERED 2026-08-12 04:43 by the next check-in: STILL THE MIDDLE STATE, and**
**it asked to be told so.** Both readings, as instructed:

| Reading | Value |
| --- | --- |
| On disk | **215,736 B** — pre-write 204,270 plus this entry's 11,466. Present and whole |
| `cloud repair complete` later than the 00:37:48 write | **none.** The last one in `host.log` is still **2026-08-11 19:15:16** |

So this entry is intact *because nothing has run that could delete it*, which is
exactly what it predicted about itself. **Not a pass.** `EpicFileSync` stopped at
**19:15:33** and is now **9h28m** down — the fleet is idle, so no chat session
has opened to restart it, and only a session restart runs a repair.

## 2026-08-11 20:15 — the Teams tab told the user they had refused notifications, and nobody had asked them

Fleet **idle**, checked rather than assumed for the sixth consecutive run.
`main` untouched at `8fa892d1`; the work landed on the `/next/` stack at
**`af75430e`**, off the deep-link tip `043b2c0b`.

| Probe | Reading |
| --- | --- |
| Agents (`agent list --all --json`) | **115**, **0 active** |
| Last provider turn (`host.log`) | **2026-08-10 20:16:14**. Nothing has run in 24h |
| `claude.exe` processes | **1** — this session, started 20:15:02. No collision |
| `[ERROR]` in the current `host.log` | **0** |
| Genuine rate-limiting | **none** — level-anchored. The only `429` is the connection-UUID trap for the **sixth** run running (`9d3ea4d5-4297-400c-…`) |
| Agents blocked / errored / stranded | **none** |
| Idle with work outstanding | **1** — `autobuild/conversational-bot`, still parked on **H1**, still Elliot's one minute. Correctly left alone |
| Roles claimed (`agent role list`) | 4, none over this run's surface |

### 🔴 The finding: `data-notifications="denied"` on a surface where the grant was HELD and no human was ever asked

Under `convergence-architecture` the Teams client **is** the `/next/` bundle,
so the UI is upstream's and **the shell is the entire remaining parity**
**surface**. This is a defect in it, and it was found by asking the parity
question the retired gap table used to ask — *what does this do on the other
client* — about the one thing both clients genuinely do not share: the
embedding.

`offerNotificationPermission` **already** draws the distinction that matters.
Its own `.catch()` says so, in these words:

<user_quoted_section>Reported as unsupported rather than denied: the user did not refuse, thesurface did, and the two lead to different advice.</user_quoted_section>

**That reasoning is right, and it is implemented on a path the Teams tab**
**never reaches.** The tab does not get as far as a request.

#### Measured, Chromium 1228, notifications GRANTED to the app's origin in every arm

| Arm | `Notification.permission` at load | `requestPermission()` |
| --- | --- | --- |
| top level — **the control** | `granted` | **`granted`** |
| same-origin iframe — **the second control** | `granted` | — |
| **cross-origin iframe** (Teams' own sandbox tokens) | **`denied`** | **`denied`** |
| **cross-origin + `allow="notifications *"`** | **`denied`** | **`denied`** |

So the permission reads `denied` **before anything is offered**, the
granted/denied early return fires, and the shell stamped
`<html data-notifications="denied">` — *"the user said no"* about a user who
was never asked, on an origin that **held the grant**. A reader of that
attribute on the deployed tab sends someone to browser settings that cannot
help them, and every negative reading in this shell exists precisely so a
later probe cannot make that mistake.

**The fourth row is the one that closes the question rather than describing**
**it.** Delegating the feature explicitly from the parent does **not** restore
it. So this is not a missing `allow` attribute Teams could add, and no
manifest change reaches it: **web notifications are structurally unavailable**
**to this bundle whenever it is embedded.** That is a real architectural
result, not a bug report — it means the Teams interrupt channel
(`fluent-tab-plan` roadmap item 2, the Graph activity feed) is a **different**
**capability**, measured rather than assumed to be one.

#### The same-origin control is why this is a new module and not a reuse

`teams-host.ts` asks *"am I framed"*, which is the right question there — a
Teams tab is always a child frame, and it is a cheap gate on a ~100KB import.
It is the **wrong** question for a permission, and the second arm above is the
whole reason: a same-origin frame is **framed AND granted**.

**Being framed is not what takes the permission away. Being cross-origin is.**
The obvious one-line reuse (`window !== window.parent`) would have withheld
notifications from a surface that honours them — a fix confidently causing the
defect it was written to describe. `embedding.ts` reads the parent's
`location.origin`, which throws iff cross-origin, **verified in all three arms
rather than inferred from the same-origin policy's wording**.

### Built — `af75430e`, five files, all `clients/mobile/src/web` + its probe

Reported as a sixth outcome, `surface-blocked`, **and the user is told** —
because reporting it honestly and still showing the user nothing is the same
silence with better telemetry, and rubric criterion 2 is about the user.

**The note has one action and it is not Enable.** There is nothing to enable:
the request is refused by the surface and cannot be re-asked, so an Enable
button here would be this project's signature bug — *"the button did nothing"*
— rendered deliberately. Two things it deliberately does **not** say:

|  |  |
| --- | --- |
| It does not name **Teams** | This module knows it is embedded, not by whom. Only the SDK handshake knows, it is dynamic-imported behind a 4s race, and nothing here may wait on it. Copy naming Teams would be a guess shown to a user as a fact on any other embedder |
| It does not promise **the bot** will notify instead | The proactive send path is built and **has never sent anything** (T4, 🟡). A sentence pointing at it would read exactly like a working feature. [[fallback-copy-reads-as-the-real-thing]]. What is offered instead — open Traycer in a browser tab — is true today and actionable now |

A **second** dismissal key, deliberately: the PWA and the tab share an origin
and therefore share storage, so one key would let a dismissal in Teams suppress
the offer in the browser tab the note tells the user to open — **the advice**
**disabling itself.** `MUT-E7`.

### 🔵 Verified past the point jsdom can reach, with both controls

The unit tests inject `isEmbedded` and `getPermission`, so they prove the branch
is right **given** a reading — and the entire change rests on the browser
producing that reading. Both ends green with the seam uncrossed is a shape this
epic has shipped before ([[both-ends-green-seam-untested]]).

So the **real** modules were bundled with **no injection** and run in a real
cross-origin frame:

| Arm | `data-notifications` | note | Enable offer |
| --- | --- | --- | --- |
| top — **control** | `granted` | none | none |
| same-origin frame — **control** | `granted` | none | none |
| **cross-origin frame** | **`surface-blocked`** | **shown** | **none** |

Both controls pass, so the change is not suppressing notifications on surfaces
that support them — which a one-armed probe could not have told anyone.

**Reproduce** (all three probes, node not bun —
[[traycer-cli-node20-websocket-bug]]'s sibling environment note):
`scratch/teams-shell-probe/probe.mjs` (the four-arm platform reading),
`discriminator.mjs` (the three-arm origin test), `live-shell.mjs` (the real
modules in a real frame). They need
`CHROME_PATH=%LOCALAPPDATA%\ms-playwright\chromium-1228\chrome-win64\chrome.exe`
— note `chrome-win64`, not `chrome-win`, which is what playwright-core's own
default guesses and is why the first run failed to launch. **`scratch/` is
untracked**, so these are evidence for this entry rather than a durable gate.

### Gates — and one probe that indicted the test rather than the code

| Gate | Reading |
| --- | --- |
| `mobile` suite | **191 → 205**, 15 files, 0 failed |
| `mobile` `tsc -b --force` | **0 errors** |
| `eslint --max-warnings 0` | **0** on every changed file — **three real errors fixed, not suppressed** (a banned optional parameter and a chained `as unknown` assertion); the fix made the environment lookup its own tested function rather than a default argument |
| `tools/mutate-notifications.mjs` | **20/20 caught, 0 survivors** — 13 pre-existing plus **7 new**, each by a named test |

**`MUT-E1` reproduces the shipped defect exactly**, which is the mutation worth
having: it disables the new branch and the suite reddens on the row that says
Teams must not report `denied`.

🔵 **`MUT-E6` survived its first run, and this time the mutation was right.**
It makes dismissing the note report `dismissed`, overwriting the platform fact
with a statement about a banner. The assertion was on the **reloaded** session —
which never clicks, and therefore cannot observe what clicking reports. Opposite
repair from [[surviving-mutant-may-indict-the-mutation]]'s usual reading, and
worth the line because taking that reading here would have deleted a live
mutation as "behaviour-preserving" when it changes the one thing the branch is
for.

### Two checked non-findings, filed so they are not re-investigated

| Predicted | Measured |
| --- | --- |
| **The Enable banner is a dead button in Teams** — this run's opening hypothesis, and the reason the probe was built | **False, and the mechanism is the opposite of the guess.** The banner is never rendered there at all: the permission reads `denied` at load, so the early return fires first. The defect was one layer earlier and quieter than the one being hunted — had the hypothesis been built on instead of measured, the fix would have guarded a branch that cannot execute |
| **The service worker fails to register in a Teams-shaped frame** | **False — registers in all three arms**, same scope. The PWA layer is unaffected by embedding |

### 🟠 Open, and stated as unmeasured rather than left silent

**The screen wake lock in Teams is genuinely unknown.** The probe's top-level
arm **failed** (`NotAllowedError`, headless has no screen), so that arm is not a
valid control and no conclusion may be drawn from the framed ones. The single
thing established: `screen-wake-lock` **is** delegable — the
`allow="screen-wake-lock *"` arm held the lock — so unlike notifications this is
a question about **Teams' own `allow` attribute**, which cannot be read without
a real install. `startScreenWakeLock` already reports `unavailable` distinctly
from `off`/`unsupported`, so whatever the answer is, the shell states it
honestly; there is nothing to fix, only something to find out.

### Not done, deliberately

1. **The `/next/` rebuild and redeploy** — unchanged, and now **five** runs
deep. This change ships in that same bundle, so it is now a **fourth**
independent workstream parked on the same ten attended minutes.
2. **Not pushed.** `main` is **12** ahead of `origin/main`; this run added
nothing to that count and did not act on it. Outward-facing.
3. **`TRAYCER_TEAMS_APP_ID`** — still the feature's own gate, unchanged.
4. **The app package** — the exempted shortcut.
5. **`autobuild/conversational-bot`** — still H1, still Elliot's.

### Survival check on this entry — filled in AFTER a repair, not before

⚠️ **Written into a KNOWN-DOWN sync window, and that is recorded rather than
hoped past.** `EpicFileSync` stopped at **19:15:33** and had not restarted at
write time — the fleet is idle, so no chat session has opened to restart it.
This is exactly the window the 12:15 entry names as *"not merely unsynced —*
*scheduled for deletion by the repair that follows."* Nothing can be done about
that at write time; the only honest response is to say which state this is in.

**PENDING** — to be answered by the next check-in re-reading this file's byte
length after a `cloud repair complete`, the way this run answered the 16:15
entry's. Pre-write size: **191,722 B**. If this still says PENDING, the entry
reached disk and the check did not complete: the unmeasured middle state, not a
pass.
