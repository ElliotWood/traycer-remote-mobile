# Traycer autobuild check-in.
#
# Runs headless Claude every 4 hours to pick up blocked or stalled autobuild
# work while nobody is at the keyboard. Created 2026-07-30 at Elliot's request
# ("make sure you have a scheduled windows task to check in every 4 hours to
# pick up any blocked activities") because the interactive session can end or
# exhaust tokens overnight, and the /loop wakeup dies with it.
#
# Remove with:  schtasks /delete /tn "Traycer-Autobuild-Checkin" /f
#
# THE SCHEDULER READS THIS FILE FROM `C:\repo\wt-guiapp-main`, NOT FROM $WorkDir.
# Retargeted 2026-09-20 16:15. Until then the task's -File pointed into $WorkDir,
# whose branch (`traycer/chat-transfer`) last took a commit to this script on
# 09-09 and is 538 behind `main` - so the six improvements that landed between
# 09-16 and 09-20, the missed-window detector among them, reached the unattended
# scheduler ONLY as uncommitted working-tree state. That state was load-bearing
# and nothing said so: one `git checkout -- scripts/` there would have silently
# reverted the every-four-hours run by eleven days, and the run would still have
# looked healthy, because a script that is merely OLD fails nothing.
#
# Consequence to respect when editing: $WorkDir stays the work area (a run must
# not churn the `main` checkout), so editing $WorkDir's copy of THIS file now
# changes nothing about what runs. Land script edits on `main` - the task picks
# them up on the next window with no copy step.

$ErrorActionPreference = 'Continue'

# The work area - deliberately NOT where this script is read from; see above.
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
     & $T agent profile-rate-limits claude --profile ambient
                                           # profile health - LIVE read. The
                                           # `list-profiles` cache answers
                                           # "unknown"; see step 2.
     & $T agent send --help                # to re-authorise / answer an agent

   Two traps in `agent list --json`: `active` is true ONLY for the calling agent,
   so it does not mean "running" - do not read `active:false` as "idle", that is
   the defect the parity contract already records once. And `capabilities` is
   reported RELATIVE to the sender id you passed, so it describes the sender's
   reach, not the listed agent's. Run state comes from transcripts, not the list.

   A THIRD trap, and it is the bearer rather than the list: the CLI token lives
   four hours and this check-in runs every four hours, so a window's first call
   lands near `exp` by construction. Decode it BEFORE you call - `token` in
   `%USERPROFILE%\.traycer\cli\credentials` is a JWT; read its `exp` claim.
   Inside the token's life the call simply works and does not refresh. More than
   ~40 s past `exp` the CLI refreshes in-command and the call works. In between -
   roughly 8 to 37 s past `exp` - it HARD-FAILS: exit 1, `status 401`,
   `credentials` NOT rewritten, and that reading is lost. Measured 2026-09-19
   20:17:43 at +28.1 s (exit 1) against the same command at +161.2 s (exit 0, new
   token). So place the call, and if one does return that 401, wait past 40 s and
   repeat it rather than re-planning around a missing reading.
2. Unblock them. Rate limits: the check is
   `agent profile-rate-limits claude --profile <ambient|id>` - NOT
   `agent list-profiles claude`. Measured 2026-09-20 08:18: `list-profiles`
   is the CACHED view and the cache is empty, so it answers
   `rateLimitStatus:"unknown"`, `usageUpdatedAt:null` for every profile - it
   cannot report a rate limit at all, and reading it as "no limit hit" is the
   same hollow probe as `[ERROR] in host.log = 0`. The older warning here said
   `profile-rate-limits` only replays a cached capture; that is FALSE. Two
   calls 5 s apart returned `usageUpdatedAt` 5 s apart, each equal to the call
   clock to the second (08:18:42, 08:18:47) - it is a live read. Derive the
   verdict, do not quote this file's numbers: `usedPercent` under `fiveHour`
   and `sevenDay`, and `available` before either.
   Both profiles, same run: `ambient` ("Terminal account",
   `isEffectiveLastUsed:true`) is `subscriptionType:"max"`, 5-hour 3%, 7-day
   9% - healthy, and the effective profile already. Altra
   (fc88ec7d-e3d7-45b1-b144-987f6b4ea727) answers
   `available:false, reason:"rate_limits_not_available"` with
   `authStatus:"unauthenticated"` - it reports no capacity because nobody is
   signed in to it, not because it is busy. So do NOT fail over to Altra: the
   standing "move it to Altra" advice would move a blocked agent onto a
   profile that cannot authenticate. Re-read both before acting.
   Syntax: the harness is a POSITIONAL argument, and omitting it fails with
   "missing required argument 'harness'" rather than defaulting.
   Questions they raised: answer from the artifacts, and record the reasoning.
3. Keep execution SERIAL - one generator/evaluator pair at a time. Token budget
   is constrained.
4. Verify claims rather than trusting reports. This epic has produced repeated
   "checks that report success while measuring nothing". Grep locates; it does
   not establish. Confirm deploys by checking a property only the new build has.

   THE `[ERROR]` COUNT IN host.log IS ONE OF THOSE CHECKS. 70 entries reported
   it as `0` and called that health. It is 0 because this host has never
   logged at ERROR at all: across host.log + host.log.1 (26 days, 34.8 MB)
   the level census is 163,773 WARN / 82 INFO / **0 ERROR**. A permanent
   failure loop ran under that clean reading for 25 days. Worse, those same
   entries quoted the line-count growth ("+477 since the 04:15 anchor") as
   context - and 99.8% of that growth WAS the failure retrying.

   So do not count a level. Count what DOMINATES, and name it:

     $h = 'C:\Users\gigaf\.traycer\host\host.log'
     Get-Content $h | ForEach-Object {
         $_ -replace '^\[[\d\- :\.]+\]\s*','' -replace "'[^']*'",'X' `
            -replace '[0-9a-f]{16,}','X' -replace '[0-9A-Z]{20,}','X'
     } | Group-Object | Sort-Object Count -Descending |
       Select-Object -First 5 Count,Name

   Read the top FIVE as a group, not the top one. On 2026-09-19 the top line
   was only 43.1% and the leading five were 94.4% - all five lines of one
   failure, split across rooms. A single-line threshold would have read clean
   on the exact defect it was written for. If the five together are >50% and
   tell one story, that is the host's actual state and it belongs in the entry
   whatever its level. A log that is 99% one warning is not a quiet log, it is
   a stuck one.
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

8. THIS IS A ONE-SHOT RUN: ending your turn ends the process, and the exit
   kills every background task, timer, and watcher with it. Nobody calls you
   back. Five runs (08-24, 08-27, 08-28, 09-02, 09-06) died by ending their
   turn "standing by" on something backgrounded, and 09-06's had its entire
   entry drafted and its commit message staged when it died six minutes short
   of its own timer. So: land what you have (splice -> commit -> push) BEFORE
   placing any delayed read, word placeholder rows so the NEXT run can fill
   them from cli.log/host.log/the credentials file, and if a wait is genuinely
   required, wait in the FOREGROUND (a blocking sleep inside a tool call), not
   by ending the turn.

Do not wait for human input. Decide, act, and document what you decided.
'@

"[$Stamp] check-in starting" | Out-File -FilePath $Log -Append

# Say so when a window never fired, instead of leaving it to be found by hand.
#
# WHY: 2026-09-16 - Windows Update rebooted the box three times at 03:29-03:31
# and nothing logged on until 09:20:24. This task is registered "Interactive
# only", so 04:15 and 08:15 could not launch and left NO log of any kind - not
# even the "starting" line above, which every other failure mode does write.
# StartWhenAvailable is True and made up neither, because its make-up path
# covers an unavailable COMPUTER, not an absent SESSION. Eight hours of
# unattended build time vanished with nothing recording that it had; the gap
# was only found because someone counted the files in this directory. The real
# fix is an S4U principal and needs elevation - this makes the loss report
# itself in the meantime, with the two facts that diagnose it. Never let this
# block a run: the whole thing is best-effort.
#
# AMENDED 2026-09-19, after this check reported "~1" for a 25.7h outage that
# cost SIX windows. Both of its terms were wrong, and in the same direction:
#
#  1. It anchored on the last log FILE. A run that starts and dies writes a
#     log, so the four windows of 09-18 12:15..09-19 00:15 that hit Anthropic's
#     WEEKLY limit - "check-in finished (exit 1) - NO-OP: RATE LIMITED" - each
#     looked like a healthy predecessor. The work outage was 25.7h; the check
#     measured 9.7h to the newest no-op and never saw the rest. Anchor on the
#     last run that PRODUCED something ("- ran, "), which is the only thing
#     this warning is about.
#  2. It divided elapsed hours by four. That charges a late run's own lateness
#     against the count: this run was a StartWhenAvailable catch-up 1h44m after
#     its slot, so round(9.7/4)-1 lost a whole window. Count the scheduled
#     SLOTS between the anchor and now instead - they are what was missed.
#
# Splitting "ran but produced nothing" from "never fired" is the point: they
# have opposite fixes (wait out a provider limit vs. an S4U principal), and
# the single number could not tell them apart.
try {
    $Logs = Get-ChildItem $LogDir -Filter 'autobuild-checkin_*.log' -ErrorAction Stop |
        Where-Object { $_.Name -ne (Split-Path $Log -Leaf) }
    $Seen = @{}
    foreach ($f in $Logs) { $Seen[($f.BaseName -replace '^autobuild-checkin_', '')] = $true }
    $PrevLog = $Logs | Sort-Object Name -Descending |
        Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match '- ran, ' } |
        Select-Object -First 1
    if ($PrevLog) {
        $PrevStamp = [datetime]::ParseExact(
            ($PrevLog.BaseName -replace '^autobuild-checkin_', ''), 'yyyy-MM-dd_HHmm', $null)
        $Now = Get-Date
        # The grid is every 4h from 00:15, so walk it from the anchor's midnight.
        $Slots = @()
        $W = $PrevStamp.Date.AddMinutes(15)
        while ($W -le $Now) {
            if ($W -gt $PrevStamp) { $Slots += $W }
            $W = $W.AddHours(4)
        }
        # The newest slot is the one THIS run is serving, late or not.
        $Lost = @($Slots | Select-Object -SkipLast 1)
        if ($Lost.Count -ge 1) {
            $NoOp  = @($Lost | Where-Object { $Seen.ContainsKey($_.ToString('yyyy-MM-dd_HHmm')) }).Count
            $Never = $Lost.Count - $NoOp
            $Boot  = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).LastBootUpTime
            $Logon = (Get-Process explorer -ErrorAction SilentlyContinue |
                Sort-Object StartTime | Select-Object -First 1).StartTime
            "[$Stamp] MISSED WINDOWS: $($Lost.Count) since $($PrevLog.Name) - $NoOp ran but produced nothing, $Never never fired (gap $([math]::Round(($Now - $PrevStamp).TotalHours,1))h) - last boot $Boot, interactive logon $Logon" |
                Out-File -FilePath $Log -Append
        }
    }
} catch {
    "[$Stamp] missed-window check skipped: $_" | Out-File -FilePath $Log -Append
}

# Where the run's own output starts, so the completion line below can describe
# what actually happened instead of only that something did.
#
# WHY: seven consecutive runs (2026-07-31 00:15 → 2026-08-01 00:15) died on the
# first token with "You've hit your weekly limit", and every one still wrote
# "check-in finished (exit 1)". A glance at the log directory showed eight runs
# that all finished; the no-op was visible only by opening each 300-byte file.
# Nothing alerted and 32 hours of unattended build time was lost silently.
$Before = if (Test-Path $Log) { (Get-Content $Log).Count } else { 0 }

# Wait for the network before launching, and retry a run that dies on it.
#
# WHY: eleven consecutive runs (2026-08-15 00:15 → 2026-08-18 12:15) died on the
# first token with "API Error: Unable to connect to API (ENOTFOUND)", ~44 hours
# of unattended build time. The box was AWAKE for every one of them - host.log
# logged continuously through each of those minutes - so this was not a sleeping
# machine, it was name resolution. The root cause is no longer recoverable (the
# System event log only reaches back to 2026-08-18 04:04), and this fix
# deliberately does not depend on knowing it: whatever takes DNS away, a
# check-in that waits for it to come back loses minutes instead of days.
#
# The probe is a TCP CONNECT, not a name lookup. ENOTFOUND is a resolver
# failure and `Resolve-DnsName` can answer out of cache while the connection
# that matters still fails, which would hand back a green reading for the exact
# condition being tested for. Test-NetConnection does resolution AND reach.
function Test-ApiReachable {
    try {
        Test-NetConnection -ComputerName 'api.anthropic.com' -Port 443 `
            -InformationLevel Quiet -WarningAction SilentlyContinue
    } catch { $false }
}

$Waited = 0
while (-not (Test-ApiReachable) -and $Waited -lt 1800) {
    Start-Sleep -Seconds 120
    $Waited += 120
}
if ($Waited -gt 0) {
    "[$Stamp] api unreachable at start; waited $([math]::Round($Waited/60))m before launching" |
        Out-File -FilePath $Log -Append
}

try {
    Push-Location $WorkDir

    # Up to three attempts, but ONLY for a run that died on the network. The
    # discriminator is the same one the rate-limit verdict below already had to
    # get right: size first, marker second. A productive run that merely QUOTES
    # a connection error - this entry does, at length - must not be retried, and
    # matching the phrase anywhere in the body would retry it three times.
    # A genuine no-op dies on the first token, so its whole body IS the marker.
    $Attempt = 0
    do {
        $Attempt++
        $Mark = @(Get-Content $Log -ErrorAction SilentlyContinue).Count

        & $Claude -p $Prompt --permission-mode bypassPermissions 2>&1 |
            Out-File -FilePath $Log -Append
        $Code = $LASTEXITCODE

        $Attempted = @(Get-Content $Log -ErrorAction SilentlyContinue | Select-Object -Skip $Mark)
        $DiedOnNetwork = ($Attempted.Count -lt 5) -and
            (($Attempted -join "`n") -match '(?i)ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Unable to connect to API')

        if ($DiedOnNetwork -and $Attempt -lt 3) {
            "[$Stamp] attempt $Attempt died on the network; retrying in 10m" |
                Out-File -FilePath $Log -Append
            Start-Sleep -Seconds 600
        }
    } while ($DiedOnNetwork -and $Attempt -lt 3)

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
    #
    # The network branch MUST come first, and not because it is more important.
    # $Body is measured from $Before, so it now spans all the attempts and the
    # retry notices between them: three dead attempts plus two "retrying in 10m"
    # lines is FIVE lines, which the size rule would report as "ran, 5 lines of
    # output" - a no-op described as a working run, the original 2026-07-31 bug
    # reintroduced by the fix for it. $DiedOnNetwork is read off the last
    # attempt alone, so it is the only term here that still means anything once
    # retries can pad the body.
    $Verdict =
        if ($DiedOnNetwork) { "NO-OP: NO NETWORK - api.anthropic.com unreachable, $Attempt attempts" }
        elseif ($Body.Count -ge 5) { "ran, $($Body.Count) lines of output" }
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
