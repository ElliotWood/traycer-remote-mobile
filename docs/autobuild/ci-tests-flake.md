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
| `2033ae2ba` | ❌ (run 33426074181) | `traycer-clients-gui-app shard 4` — the shard's **third** appearance, and the family's **first red under `--outputStyle=stream`**: the job log (job `99599830543`) names everything ask (1) said it would — `src/components/home/host-workspace-selector/__tests__/workspace-folders-refresh.test.tsx` > *"folder-mapping refresh affordance > re-derives on R while the picker is open"*, `AssertionError: expected +0 to be 1 // Object.is equality` with the expected/received diff and the code frame at `:117:7` (`fireEvent.keyDown(document.body, { key: "r" })` … `.toBe(1)` — a listener-registration race by shape), plus the full summary: `Test Files 1 failed \| 263 passed (264)`, `Tests 1 failed \| 2638 passed (2639)`, `Duration 304.29s (import 243.25s, tests 101.04s)` — **80% of the red shard is module import** on the 2-core box. Upstream-inherited (Hardik Shingala, #852/#878; fork last touched it 2026-08-01; upstream has rewritten it three times since — #1188, #1310, #1514 — so the fork merge replaces this file too). Not in the merge map's 51. All other 13 jobs green on attempt 1; a one-file docs delta (the 04:15 ledger entry). `gh run rerun --failed` at 08:25:12 AEST by the 08:15 run; attempt 2 green (shard 4 passed 08:29:16 AEST, 3 m 53 s), read by the same run from `attempts/2/jobs` |
| `8750f8db4` | ❌ (run 33463226096) | `traycer-clients-gui-app shard 2` — the shard-2 member's **third** appearance and its first under `--outputStyle=stream`: `src/components/settings/panels/__tests__/providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 21,989 ms — the **same 39 tests by name** as runs 32957853364 and 33238440979 (the `×` list, timings stripped, diffed against the saved `fff118e2d` list: identical). The stream log carries what the replay cap cut twice: the first failure, *"edits and switches the default account"* (1,378 ms), is `AssertionError: expected "vi.fn()" to be called at least once`, and its DOM dump shows `<body data-scroll-locked="1" style="pointer-events: none;">`, a `data-radix-focus-guard` span and the panel's `<header aria-hidden="true">` — a Radix overlay still mounted over the panel — after which the remaining 38 read as its wake: 22 × `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name …`, 13 × `waitFor` timeouts, 10 × *"expected vi.fn() to be called at least once"*, 3 × *"called 1 times, but got 0 times"*, 2 × *"Unable to find a label with the text of: Profile name"* (counted per line; a block can carry both a `waitFor` frame and its assertion). Shape, not proof: a dialog one test opened and did not close, and every later test querying a tree it cannot reach — ask (2)'s first concrete target. Summary: `Test Files 1 failed \| 263 passed (264)`, `Tests 39 failed \| 2865 passed (2904)`, `Duration 318.48s (import 217.63s, tests 174.45s, environment 180.73s)` — import 68 % of wall, against 80 % / 81 % on the two shard-4 readings. Blob unchanged since the row above (`a341e87ca` ours / `b1509b9d1` theirs; 16 upstream commits since the merge-base, 0 this window). A one-file docs delta (the 12:15 ledger entry); all other 13 jobs green on attempt 1. `gh run rerun --failed` at 16:19:54 AEST by the 16:15 run; attempt 2 green (shard 2 job `99758684448` passed 16:24:49 AEST, 4 m 49 s), read by the same run from `attempts/2/jobs` |
| `ad0a7e38d` | ❌ (run 33520784905) | `desktop darwin + packaging` — **not a test failure, and not a member: the job never acquired a runner.** From `attempts/1/jobs` (job `99899196641`): created 00:38:54 AEST, `runner_name` empty, `steps` 0, log URL **404 `BlobNotFound`** (no log was ever written), conclusion **`cancelled`** at 00:53:57 (**15 m 3 s**), check-run annotation *"The job was not acquired by Runner of type hosted even after multiple attempts"*. Control in the same run's neighbour: the *Real supervisor* workflow's `CLI real-launchd rows (macOS)` job on the same tip and the same `macos-latest` label, created the same second (00:38:54), acquired `GitHub Actions 1000004788` in **5 s** and passed at 00:39:59 — hosted macOS capacity existed; one of two identical-label jobs was never assigned. All thirteen ubuntu jobs green on attempt 1 (23 s – 5 m 21 s). `githubstatus.com`: no incident over 00:38–00:54 AEST (Actions `operational`). The `queued-job-reads-as-cancelled` shape at fifteen minutes instead of twenty-four hours. `gh run rerun --failed` at 04:20:38 AEST by the 04:15 run; attempt 2 acquired `GitHub Actions 1000004808` in **3 s** and went green (darwin job `99973819815` 04:20:43 → 04:23:54, 3 m 11 s; run `success` 04:23:55), read by the same run from `attempts/2/jobs`. A one-file docs delta (the 00:15 ledger entry) |
| `d1cf952c8` | ❌ (run 33940178078) | `traycer-clients-gui-app shard 2` — the shard-2 member's **fourth** appearance and its second under stream: `providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 19,680 ms — the **same 39 by name** (× list, timings stripped, sorted-diffed against the saved 09-01 list: identical), first failure *"edits and switches the default account"* (1,287 ms, `expected "vi.fn()" to be called at least once`) with the same Radix overlay DOM (`data-scroll-locked="1"`, `pointer-events: none`), the other 38 its wake. Summary: `Test Files 1 failed \| 263 passed (264)`, `Tests 39 failed \| 2865 passed (2904)`, `Duration 258.11s (import 175.42s)` — import 68 % of wall, in family range. Ours' blob unchanged (`a341e87ca` — four reds on identical bytes); upstream's copy has moved again (`f78fbd45f` at `a87f530e4`), so the fork merge still replaces it. A one-file docs delta (the 12:15 ledger entry); all other 13 jobs green on attempt 1. `gh run rerun --failed` at 16:18 AEST by the 16:15 run; attempt 2 green (shard 2 job `101261398063` 16:18:57 → 16:24:44, 5 m 47 s), read by the same run from `attempts/2/jobs` |
| `36803293d` | ❌ (run 33960887230) | `traycer-clients-gui-app shard 2` — the shard-2 member's **fifth** appearance and its third under stream: `providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 22,553 ms — the **same 39 by name** (FAIL-line list, sorted-diffed against the saved 09-01 list: identical), first failure *"edits and switches the default account"* (1,414 ms, `expected "vi.fn()" to be called at least once`) with the same Radix overlay DOM (`data-scroll-locked="1"`, `pointer-events: none`), the other 38 its wake. Summary: `Test Files 1 failed \| 263 passed (264)`, `Tests 39 failed \| 2865 passed (2904)`, `Duration 335.53s (import 230.06s)` — import 69 % of wall, in family range. Ours' blob unchanged (`a341e87ca` — five reds on identical bytes); upstream's copy sat still this window (`f78fbd45f` at both `696c694fa` and `c3f733113`), so the fork merge still replaces it. A one-file docs delta (the 20:15 ledger entry); all other 13 jobs green on attempt 1. `gh run rerun --failed` at 00:22:36 AEST by the 00:15 run; attempt 2 green (shard 2 job `101321052207` 00:22:41 → 00:26:44, 4 m 3 s; run success 00:26:45), read by the same run from `attempts/2/jobs` |
| `f3a107b72` | ❌ (run 34016639301) | `traycer-clients-gui-app shard 2` — the shard-2 member's **sixth** appearance and its fourth under stream: `providers-settings-panel.test.tsx` (74 tests \| **39 failed**) — the **same 39 by name** (FAIL-line list from the stream log, sorted-diffed against the saved 09-06 16:15 list after line-ending normalisation: identical — both normalise to git blob `7470fb701`), first failure *"edits and switches the default account"* (1,435 ms) with the same Radix overlay DOM (`data-scroll-locked="1"`), the other 38 its wake. Summary: `Test Files 1 failed \| 263 passed (264)`, `Duration 324.32s (import 220.65s, tests 178.17s, environment 184.05s)` — import 68 % of wall, in family range. Ours' blob unchanged (`a341e87ca` — six reds on identical bytes); upstream's copy sat still this window (`f78fbd45f` at `4fa18be1f`), so the fork merge still replaces it. A two-commit, one-file docs delta (the posthumous 08:15 entry + the 16:15 entry); all other 13 jobs green on attempt 1 (shard 2 red 16:30:03 → 16:35:51 AEST). `gh run rerun --failed` at 00:26:18 AEST **by the 00:15 run, nine minutes before the box slept under it** — the run was reaped without recording the rerun it fired; attempt 2 green (shard 2 job `101502636355` 00:26:22 → 00:31:01, 4 m 39 s; run success 00:31:02), read by the 10:01 catch-up run from `attempts/2/jobs` |
| `14f6779b8` | ❌ (run 34069518595) | `traycer-clients-gui-app shard 2` — the shard-2 member's **seventh** appearance and its fifth under stream: `providers-settings-panel.test.tsx` (74 tests \| **39 failed**) in 22,395 ms — the **same 39 by name** (FAIL-line list from the stream log, sorted-diffed against the saved 09-07 00:15 list after line-ending normalisation: identical — both normalise to git blob `7470fb701`), first failure *"edits and switches the default account"* (1,424 ms) with the same Radix overlay DOM (`data-scroll-locked="1"`), the other 38 its wake. Summary: `Test Files 1 failed \| 263 passed (264)`, `Tests 39 failed \| 2865 passed (2904)`, `Duration 336.06s (import 230.67s, tests 182.13s, environment 190.99s)` — import 69 % of wall, in family range. Ours' blob unchanged (`a341e87ca` — seven reds on identical bytes); upstream's copy sat still this window (`f78fbd45f` at `011293a54`), so the fork merge still replaces it. A two-file docs delta (the 10:01 catch-up entry + its flake row); all other 13 jobs green on attempt 1. `gh run rerun --failed` at 12:19 AEST by the 12:15 run; attempt 2 green (shard 2 job `101601855494` 12:19:37 → 12:25:22 AEST, 5 m 45 s; run success 12:25:22), read by the same run from `attempts/2/jobs` |

Identical trees, fourteen red runs (the tenth with no test in it: a `macos-latest` job never acquired a runner and was cancelled by GitHub at fifteen minutes, rerun green), five distinct failing members (two darwin tests, three gui-app shards), shard 4 three times and shard 2 seven times — and two members are now **named**: shard 2's (the same 39 of 74 in `providers-settings-panel.test.tsx` on all seven of its appearances, green on every rerun and locally) and, as of 2026-09-01, shard 4's (`workspace-folders-refresh.test.tsx`, one test, named with assertion text on its first stream-era appearance).
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

1. ✅ **CLOSED 2026-09-01 08:15 — make shard failures observable.**
   Landed in `3013bdd95`; mechanism verified on a green pair 2026-08-30
   00:15 (7 → 262 per-file lines, summary present, lines live). The
   condition this half set for itself — *"confirm the assertion text on the
   next red shard"* — was met by run `33426074181` (shard 4, the `2033ae2ba`
   row): file, full test title, assertion with expected/received, code
   frame and summary all present in the job log. Nothing further to do.
2. **Deflake or quarantine the members** — the two darwin tests
   (`host-management-channel` and `host-lifecycle`, both upstream-inherited
   desktop code, not fork-authored), the named shard-2 member
   (`providers-settings-panel.test.tsx`, the same 39 of 74 both times, green
   locally and on every rerun), the named shard-4 member
   (`workspace-folders-refresh.test.tsx` > *"re-derives on R while the
   picker is open"*, caught 2026-09-01 — upstream-inherited and rewritten
   upstream since, so the fork merge replaces it), and whatever shards 1
   and 3 turn out to be. Note the pattern: every named member so far is
   upstream-inherited and superseded by the pending fork merge — the merge
   is also the deflake.
3. **Decide the runner** — either register `altra-vm-runner-demo-aue` to the
   fork and set `vars.GUI_APP_RUNNER`, or accept 2-core `ubuntu-latest` for a
   suite upstream sizes for 8 cores. The VM is running and this fork's CI
   does not use it. Measured on the green shard 2 of `33248191528`:
   `import 170.04s` of `Duration 254.00s` — two thirds of the shard is
   module import on the 2-core box. Re-measured on the red shard 4 of
   `33426074181`: `import 243.25s` of `Duration 304.29s` — **80%**.

Verify any fix against the runs in the table — same tree, so a rerun of
those exact commits is a controlled experiment.
