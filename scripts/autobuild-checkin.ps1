# Traycer autobuild check-in.
#
# Runs headless Claude every 4 hours to pick up blocked or stalled autobuild
# work while nobody is at the keyboard. Created 2026-07-30 at Elliot's request
# ("make sure you have a scheduled windows task to check in every 4 hours to
# pick up any blocked activities") because the interactive session can end or
# exhaust tokens overnight, and the /loop wakeup dies with it.
#
# Remove with:  schtasks /delete /tn "Traycer-Autobuild-Checkin" /f

$ErrorActionPreference = 'Continue'

$WorkDir = 'C:\Users\gigaf\.traycer\worktrees\elliotwood__traycer-remote-mobile\traycer-traycer-remote-mobile-electric-stork'
$LogDir  = Join-Path $WorkDir 'logs'
$Claude  = 'C:\Users\gigaf\.local\bin\claude.exe'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$Stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$Log   = Join-Path $LogDir "autobuild-checkin_$Stamp.log"

# Single-instance guard: a previous run that is still going must not be
# doubled up on. Two agents editing the same worktree is the collision we
# already hit once today.
$Lock = Join-Path $LogDir '.checkin.lock'
if (Test-Path $Lock) {
    $age = (Get-Date) - (Get-Item $Lock).LastWriteTime
    if ($age.TotalHours -lt 3.5) {
        "[$Stamp] previous run still active (lock age $([math]::Round($age.TotalMinutes))m) - skipping" |
            Out-File -FilePath $Log -Append
        exit 0
    }
    # Older than the interval: the previous run died without cleaning up.
    Remove-Item $Lock -Force
}
New-Item -ItemType File -Path $Lock -Force | Out-Null

$Prompt = @'
You are picking up an unattended autobuild check-in. Nobody is at the keyboard.

Context lives in the Traycer epic artifacts at
C:\Users\gigaf\.traycer\epics\9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef\artifacts\
Read traycer-remote-teams/parity-contract and traycer-remote-teams/fluent-tab-plan first.

Standing goal: the Teams client must reach full UI and functional fidelity with
the Traycer Remote mobile PWA. No shortcuts except Teams SSO and the org app
package upload. After that, work the other open tickets.

Do this:
1. Find agents that are blocked, errored, rate-limited, or idle with work
   outstanding.

   THE traycer_* MCP TOOLS DO NOT EXIST IN THIS ENVIRONMENT. They are desktop-app
   tools; headless `claude -p` launched by this script gets no Traycer MCP server,
   and there is no traycer binary on PATH. Runs before 2026-08-01 wasted their
   whole budget discovering this. Use the CLI binary directly instead:

     $T = "C:\Users\gigaf\.traycer\cli\bin\traycer.exe"
     $env:TRAYCER_EPIC_ID   = "9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef"
     $env:TRAYCER_AGENT_ID  = "29feb5f0-b273-4906-a87b-a8a71038952c"  # "Testing and
                              # Running Traycer" - the supervisor, parent of every
                              # pair. A sender id is REQUIRED and must be a real
                              # agent; synthetic ids are refused.

     & $T agent list --all [--json]        # traycer_list_agents
     & $T agent transcript --agent-id <id> # traycer_get_transcript. Prints a PATH,
                                           # not the text; read the file it names.
     & $T agent configure --help           # traycer_configure_agent
     & $T agent list-profiles claude       # profile health
     & $T agent send --help                # to re-authorise / answer an agent

   Two traps in `agent list --json`: `active` is true ONLY for the calling agent,
   so it does not mean "running" - do not read `active:false` as "idle", that is
   the defect the parity contract already records once. And `capabilities` is
   reported RELATIVE to the sender id you passed, so it describes the sender's
   reach, not the listed agent's. Run state comes from transcripts, not the list.
2. Unblock them. Rate limits: check `agent list-profiles claude` and move the
   agent to whichever profile is actually healthy - do NOT assume. As of
   2026-08-01 08:30 the healthy one is `ambient` (5-hour 4%, 7-day 1%, resets
   Aug 7); Altra (fc88ec7d-e3d7-45b1-b144-987f6b4ea727) is at 54% of its 7-day
   and resets Aug 2, so the long-standing "move it to Altra" advice is
   backwards. Note that `agent profile-rate-limits` returns the CACHED capture
   timestamp even though it advertises a fresh read - check the timestamp
   before trusting it. The syntax is
   `agent profile-rate-limits claude --profile <ambient|id>`: the harness is a
   POSITIONAL argument, and omitting it fails with "missing required argument
   'harness'" rather than defaulting.
   Questions they raised: answer from the artifacts, and record the reasoning.
3. Keep execution SERIAL - one generator/evaluator pair at a time. Token budget
   is constrained.
4. Verify claims rather than trusting reports. This epic has produced repeated
   "checks that report success while measuring nothing". Grep locates; it does
   not establish. Confirm deploys by checking a property only the new build has.
5. Write what you did into the epic artifacts so the next run and the human can
   both pick it up.
   BUT: you read those artifacts at the START of a turn that runs for a long
   time, and other agents edit them WHILE you work. A whole-file Write of a
   copy you read an hour ago succeeds silently and destroys everything since -
   no conflict, no error, no diff anyone sees. On 2026-08-03 this reverted
   parity-contract FOUR times, including a row saying a shipped, deployed
   feature "does not exist", and including the note added to warn about it.
   So: RE-READ immediately before you write, and use targeted edits, never a
   whole-file Write, on any artifact you did not create in this turn.
   parity-contract row states are owned by the agent holding the "Teams Tab
   Surface" role. DO NOT hardcode an agent id - resolve the CURRENT holder
   at run time with `& $T agent list --all --json` and match on the role,
   because an id written into this file goes stale the moment an agent is
   replaced, which has already happened twice (50886d43 ran out of context
   and stood down; its successor was named here and went stale in turn).
   An agent id in a durable file is a measurement whose method is gone.
   If you believe a row is wrong, MESSAGE the role holder - it holds the
   measurement behind each one. Do not correct the row yourself.
   A parity table that says a shipped feature is missing is worse than no
   table: it retires the question instead of raising it.

6. "NOBODY IS AT THE KEYBOARD" DOES NOT MEAN THE FLEET IS IDLE. The Traycer
   desktop host keeps running and its agents resume on their own - in
   particular, a rate-limit reset that unblocks THIS check-in unblocks THEM at
   the same moment. On 2026-08-01 the check-in started at 04:15 and the
   supervisor and Teams P0 Generator both resumed at 04:16; the check-in then
   committed into a worktree while that Generator was running `git
   filter-branch` in it. Nothing was lost, but only by luck of ordering.

   BEFORE writing to any worktree, establish whether an agent is live in it:

     & $T agent list --all          # worktree paths per agent
     Select-String -Path C:\Users\gigaf\.traycer\host\host.log `
       -Pattern 'active turn|status=running' | Select-Object -Last 20

   If an agent has taken a turn there in the last few minutes, TREAT THAT
   WORKTREE AS OWNED. Read it, do not write it. Use `traycer.exe agent send` to
   hand the finding to whoever owns it instead - and say plainly in the message
   that it comes from the automated check-in, because you will be sending under
   the supervisor's agent id and it must not read as the supervisor's own
   direction.

   The `.checkin.lock` in this script guards only against a second check-in. It
   knows nothing about the desktop fleet.

7. Beware timestamps from git plumbing. A `filter-branch: rewrite` reflog entry
   carries the REPLAYED commit's committer date, not wall-clock, so a rewrite
   that just ran can appear hours old. Establish ordering from state that cannot
   lie (presence of `refs/original`, actual parent hashes), not from dates.

Do not wait for human input. Decide, act, and document what you decided.
'@

"[$Stamp] check-in starting" | Out-File -FilePath $Log -Append

# Where the run's own output starts, so the completion line below can describe
# what actually happened instead of only that something did.
#
# WHY: seven consecutive runs (2026-07-31 00:15 → 2026-08-01 00:15) died on the
# first token with "You've hit your weekly limit", and every one still wrote
# "check-in finished (exit 1)". A glance at the log directory showed eight runs
# that all finished; the no-op was visible only by opening each 300-byte file.
# Nothing alerted and 32 hours of unattended build time was lost silently.
$Before = if (Test-Path $Log) { (Get-Content $Log).Count } else { 0 }

try {
    Push-Location $WorkDir
    & $Claude -p $Prompt --permission-mode bypassPermissions 2>&1 |
        Out-File -FilePath $Log -Append
    $Code = $LASTEXITCODE

    # Read back what the run itself emitted. Streaming above is kept so a hung
    # run is still inspectable while it hangs; this only re-reads the tail.
    $Body = @(Get-Content $Log -ErrorAction SilentlyContinue | Select-Object -Skip $Before)
    $Text = $Body -join "`n"

    # The marker is the provider's own wording, matched loosely because the
    # exact sentence has changed before.
    $Limit = [regex]::Match(
        $Text,
        "(?im)^.*(hit your (weekly|5-hour|usage) limit|usage limit reached|rate.?limit(ed)?).*$")

    # SIZE decides, and the marker only explains a size that is already
    # suspicious. Grepping the whole body for the phrase does not work: a
    # PRODUCTIVE run that reports on rate limits quotes it, and the 04:15 run
    # of 2026-08-01 — the one that finally did work — was flagged as a no-op
    # by exactly that rule while being 8.4kB of real output. Matching a shape
    # without regard to where it appears is the defect this epic keeps
    # producing; here it would have inverted the original bug rather than
    # fixing it. A genuine no-op dies on the first token, so its entire body
    # IS the marker line.
    $Verdict =
        if ($Body.Count -ge 5) { "ran, $($Body.Count) lines of output" }
        elseif ($Limit.Success) { "NO-OP: RATE LIMITED - $($Limit.Value.Trim())" }
        else { "SUSPECT: only $($Body.Count) lines of output" }

    "[$Stamp] check-in finished (exit $Code) - $Verdict" | Out-File -FilePath $Log -Append
}
catch {
    "[$Stamp] check-in FAILED: $_" | Out-File -FilePath $Log -Append
}
finally {
    Pop-Location
    Remove-Item $Lock -Force -ErrorAction SilentlyContinue
}

# Keep a fortnight of logs, no more.
Get-ChildItem $LogDir -Filter 'autobuild-checkin_*.log' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
