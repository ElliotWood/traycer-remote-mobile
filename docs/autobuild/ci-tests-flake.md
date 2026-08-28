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
| `244ef823` | ❌ (run 32957853364) | the same pair |
| `77d276159` | ✅ (run 32979891662) | — |
| `98bfd7e01` | ✅ (run 32980641738) | — |
| `9cb18d9b2` | ❌ (run 32999100333) | `traycer-clients-gui-app shard 4` — a **third** distinct job |
| `b21d05c00` | ❌ (run 33122275631) | `traycer-clients-gui-app shard 4` again — the family's first **repeat** member; `gh run rerun --failed` at 12:19 AEST, attempt 2 green (shard 4 passed 12:25:51 AEST). Filed by the 16:15 run; the 12:15 run that caught it ended before the rerun finished |
| `1d5f3b88d` | ❌ (run 33147777425) | `traycer-clients-gui-app shard 3` — a **fourth** distinct shard; the failed step's log again names no test (NX-collapsed, read not assumed). `gh run rerun --failed` at 20:18:45 AEST by the 20:15 run; attempt 2 green (shard 3 passed 20:24:16 AEST), read at landing time from `actions/runs/33147777425/attempts/2/jobs` |

Identical trees, five red runs, four distinct failing jobs, shard 4 twice.
A flake family, not a regression. Prior recorded member: gui-app **shard 1**, on
2026-08-24 (run 32682942738, green on attempt 2) — so gui-app shards have
now flaked at 1, 2, 3 and 4.

## The observability defect that is half of this ticket

For the gui-app shards, **the failed-step log does not name the failing
test.** NX collapses the vitest reporter; what survives is
`NX Running target test for project traycer-clients-gui-app failed` and
`Process completed with exit code 1`. The darwin member is triagable
(its log names the test); the shard members are not. A red shard that
cannot name its test cannot be attributed, deflaked, or told apart from
a real regression.

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
2. **Deflake or quarantine the members** — the darwin
   `host-management-channel` test (upstream-inherited desktop code, not
   fork-authored) and whatever the shards turn out to be once (1) lands.

Verify any fix against the runs in the table — same tree, so a rerun of
those exact commits is a controlled experiment.
