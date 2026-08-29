# Ticket — Tests workflow flakes on identical docs-only trees

Filed 2026-08-27 08:15 by the autobuild check-in, executing the 00:15
entry's own rule (*"a ticket if it fires again"* — it fired). GitHub
issues are disabled on the fork (`gh api repos/ElliotWood/traycer-remote-mobile
--jq .has_issues` → `false`), so the ticket lives here, beside the ledger
whose pushes produced the evidence. Close it by deleting this file in the
fixing commit.

## The observation

Six consecutive pushes to `main` are each a single-file delta to
`docs/autobuild/unreconciled-checkin-entries.md` (verified with
`git diff-tree --name-only` on all six, not inferred from the commit
messages), so the code tree is identical across all six. Their Tests
runs alternate:

| Commit | Tests, attempt 1 | Failing jobs |
| --- | --- | --- |
| `2c5dc114` | ❌ | `desktop darwin + packaging` — 1 of 25 in `src/electron-main/ipc/__tests__/host-management-channel.test.ts` (*"returns installVersion's committed ok outcome when its post-pin registry projection rejects"*) — plus `traycer-clients-gui-app shard 2` |
| `7f0ee0ab` | ✅ | — |
| `244ef823` | ❌ (run 32957853364) | the same pair — and the shard-2 log, re-read 2026-08-29 20:15 from `attempts/1/jobs`, **does** name its file: `providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 21,882 ms, the identical 39 as `fff118e2d` below |
| `77d276159` | ✅ (run 32979891662) | — |
| `98bfd7e01` | ✅ (run 32980641738) | — |
| `9cb18d9b2` | ❌ (run 32999100333) | `traycer-clients-gui-app shard 4` — a **third** distinct job |
| `b21d05c00` | ❌ (run 33122275631) | `traycer-clients-gui-app shard 4` again — the family's first **repeat** member; `gh run rerun --failed` at 12:19 AEST, attempt 2 green (shard 4 passed 12:25:51 AEST). Filed by the 16:15 run; the 12:15 run that caught it ended before the rerun finished |
| `1d5f3b88d` | ❌ (run 33147777425) | `traycer-clients-gui-app shard 3` — a **fourth** distinct shard; the failed step's log again names no test (NX-collapsed, read not assumed). `gh run rerun --failed` at 20:18:45 AEST by the 20:15 run; attempt 2 green (shard 3 passed 20:24:16 AEST), read at landing time from `actions/runs/33147777425/attempts/2/jobs` |
| `f961c985e` | ❌ (run 33228761908) | `desktop darwin + packaging` — a **fifth** distinct member and a **second** darwin test: 1 of 25 in `src/electron-main/host/__tests__/host-lifecycle.test.ts` (*"forced reload emits null for unchanged unreachable pid metadata and restores the same host id when it is reachable again"*), named by the job log (darwin is not NX-collapsed). Upstream-inherited (authors Anurag Sharma / Hardik Shingala, last touched on `main` 2026-08-03 by #913; not in the fork's 545 since-base paths). All four gui-app shards green on attempt 1. `gh run rerun --failed` at 16:19:24 AEST by the 16:15 run; attempt 2 green (darwin passed 16:21:35 AEST), read by the 20:15 run from `actions/runs/33228761908/attempts/2/jobs` |
| `fff118e2d` | ❌ (run 33238440979) | `traycer-clients-gui-app shard 2` — the shard-2 member's second appearance, and the log names it: `src/components/settings/panels/__tests__/providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 22,172 ms — the **same 39 tests by name** as run 32957853364 (the two `×` lists diffed: identical; 13 over 1 s and 26 under, in both). The assertion text is cut by Nx's replay cap in both logs. Passes **74/74 locally** on this tree (`fff118e2d`, 103.9 s, 20:24 AEST). Upstream-inherited (Hardik Shingala / Anurag Sharma, last touched on `main` 2026-08-05 by #976; not in the fork's 545 since-base paths; upstream has moved it ten times since — blob `a341e87ca` ours vs `b1509b9d1` theirs — so the fork merge replaces it). All other 13 jobs green on attempt 1. `gh run rerun --failed` at 20:20:31 AEST by the 20:15 run; attempt 2 green (shard 2 passed 20:26:26 AEST), read at landing. A two-file docs delta (this ticket + the ledger), still no code. **2026-08-30 00:15:** the exact CI invocation (`vitest run --config vitest.config.ts --shard=2/4`) run locally in `wt-guiapp-main` at `b88160082` → **264 files / 2904 tests, all passed**, the same set as CI's shard 2, in 901.58 s (import 642.36 s vs CI's 170.04 s) — a run 3.5× slower than CI's passed all 74, so speed alone does not select the 39. |

Identical trees, seven red runs, five distinct failing members (two darwin tests, three gui-app shards), shard 4 twice and shard 2 twice — and shard 2's is the one member that is now **named and repeatable**: the same 39 of 74 in `providers-settings-panel.test.tsx` on both of its appearances, green on every rerun and locally.
A flake family, not a regression. Prior recorded member: gui-app **shard 1**, on
2026-08-24 (run 32682942738, green on attempt 2) — so gui-app shards have
now flaked at 1, 2, 3 and 4.

## The observability defect that is half of this ticket

**Corrected 2026-08-29 20:15 — it is not "NX collapses the reporter"; it is
Nx's default output style.** With `--tui=false` Nx still buffers the child's
stdout into an internal stream and replays it **after** the failure banner,
**capped** — upstream's own diagnosis, written into its `test.yml` at #951.
Read from `attempts/1/jobs` for every red run in the table (the run's default
`jobs` is the latest attempt, which is all green after a rerun): the shard-3
and shard-4 logs (runs 33147777425, 32999100333, 33122275631) and shard 1's
in run 32682942738 (the matrix entry whose name carries no suffix runs
`--shard=1/4`) end mid-write with no `×` line and no vitest summary — the
signature that reads like a killed process; the two shard-2 logs got as far
as the `❯ file (74 tests | 39 failed)` and `×` lines but are cut before the
assertion text. The darwin job's log is complete both times because the
desktop suite's output is small enough to fit under the cap.

**Fixed on `main` in `3013bdd95` (2026-08-29 20:15 run):** `--outputStyle=stream`
on both `run:` lines, replacing `--tui=false` — the two are mutually
exclusive in Nx (exit 1 before any test runs; verified on this tree's
`nx ^22.7.8`, which is upstream's too). Upstream made the same change in
#951 (`test`, 2026-08-11) and #1552 (darwin, 2026-08-29).

**Mechanism verified 2026-08-30 00:15 on a green pair.** The first Tests run
under the flag (`33248191528` on `b88160082`) was green on attempt 1, so no
red shard has been read under it yet — but its shard-2 job log against the
previous run's green shard-2 log (attempt 2 of `33238440979`, `--tui=false`)
is a controlled pair, and the API's per-line timestamps say *when* each
line reached the log:

| | `--tui=false` (job `99087680293`) | `--outputStyle=stream` (job `99089193089`) |
| --- | --- | --- |
| job log | 688 lines | 1,838 lines |
| vitest per-file lines | **7** | **262** |
| arrival | all seven within 15 ms at 10:26:22Z — replayed after the run | across 170 distinct seconds, 10:36:29Z → 10:40:31Z — live |
| vitest summary | absent | `Test Files 264 passed (264)` / `Tests 2904 passed (2904)` / `Duration 254.00s (… import 170.04s, tests 145.89s …)` |

So the buffered style was dropping 257 of 264 file lines and the summary on
a **green** run — every shard log in the table looked like a killed process
because that is what the old style shows for any gui-app shard. Under
`stream` there is no replay and nothing to cap; a red shard's `×` lines and
assertion text come from the same reporter on the same stream. The red-shard
read is now confirmation, not the proof.

**Where the shards actually run (measured 20:15):** GitHub-hosted 2-core
`ubuntu-latest` — every gui-app job since 08-24 shows `runner_name`
`GitHub Actions N` with label `ubuntu-latest`; `vars.GUI_APP_RUNNER` is
unset (404) and the fork has **zero** self-hosted runners (repo-level,
checked across all of ElliotWood's repos; the AltraCloud org's list is 403
to this token). Upstream runs the same shards on `ubuntu-latest-8-cores`.
So `altra-vm-runner-demo-aue` is **not** what answers these jobs, whatever
else it serves.

## Consequences while open

Red CI on `main` is non-discriminating. Standing practice has been
`gh run rerun --failed` (reruns show as "ElliotWood" — the recorded
attribution quirk), which converts a flake into a green tick and a real
regression into a second identical failure — but only if someone reads
attempt 2, and the ledger has already recorded one red run that no entry
saw.

## Ask

Two independent halves; either alone helps:

1. **Make shard failures observable** — vitest reporter output (or at
   minimum the failing file list) must survive NX into the job log.
   **Landed in `3013bdd95`; mechanism verified on a green pair 2026-08-30
   00:15 (7 → 262 per-file lines, summary present, lines live). Confirm
   the assertion text on the next red shard, then close this half.**
2. **Deflake or quarantine the members** — the two darwin tests
   (`host-management-channel` and `host-lifecycle`, both upstream-inherited
   desktop code, not fork-authored), the named shard-2 member
   (`providers-settings-panel.test.tsx`, the same 39 of 74 both times, green
   locally and on every rerun — its assertion text is what (1) will surface),
   and whatever shards 1, 3 and 4 turn out to be once (1) has caught one.
3. **Decide the runner** — either register `altra-vm-runner-demo-aue` to the
   fork and set `vars.GUI_APP_RUNNER`, or accept 2-core `ubuntu-latest` for a
   suite upstream sizes for 8 cores. The VM is running and this fork's CI
   does not use it. Measured on the green shard 2 of `33248191528`:
   `import 170.04s` of `Duration 254.00s` — two thirds of the shard is
   module import on the 2-core box.

Verify any fix against the runs in the table — same tree, so a rerun of
those exact commits is a controlled experiment.
