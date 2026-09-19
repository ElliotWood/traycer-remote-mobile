# Self-check for the MISSED WINDOWS block in autobuild-checkin.ps1.
#
# Replays the real 2026-09-19 outage - the one the old gap arithmetic reported
# as "~1" - plus the two shapes that must stay quiet. Run it directly:
#   pwsh -File scripts/autobuild-checkin.missed-windows.test.ps1

$ErrorActionPreference = 'Stop'

# The block under test, verbatim in structure, with $LogDir/$Now injected.
function Measure-MissedWindows {
    param([string]$LogDir, [string]$SelfName, [datetime]$Now)

    $Logs = Get-ChildItem $LogDir -Filter 'autobuild-checkin_*.log' -ErrorAction Stop |
        Where-Object { $_.Name -ne $SelfName }
    $Seen = @{}
    foreach ($f in $Logs) { $Seen[($f.BaseName -replace '^autobuild-checkin_', '')] = $true }
    $PrevLog = $Logs | Sort-Object Name -Descending |
        Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match '- ran, ' } |
        Select-Object -First 1
    if (-not $PrevLog) { return $null }

    $PrevStamp = [datetime]::ParseExact(
        ($PrevLog.BaseName -replace '^autobuild-checkin_', ''), 'yyyy-MM-dd_HHmm', $null)
    $Slots = @()
    $W = $PrevStamp.Date.AddMinutes(15)
    while ($W -le $Now) {
        if ($W -gt $PrevStamp) { $Slots += $W }
        $W = $W.AddHours(4)
    }
    $Lost  = @($Slots | Select-Object -SkipLast 1)
    $NoOp  = @($Lost | Where-Object { $Seen.ContainsKey($_.ToString('yyyy-MM-dd_HHmm')) }).Count
    [pscustomobject]@{ Anchor = $PrevLog.Name; Lost = $Lost.Count; NoOp = $NoOp; Never = $Lost.Count - $NoOp }
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("missed-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
function Add-Log { param($Stamp, $Verdict)
    "[$Stamp] check-in starting`n[$Stamp] check-in finished $Verdict" |
        Out-File -FilePath (Join-Path $Tmp "autobuild-checkin_$Stamp.log")
}

$Fail = 0
function Check { param($Name, $Got, $Want)
    if ("$Got" -ne "$Want") { Write-Host "FAIL $Name : got '$Got' want '$Want'"; $script:Fail++ }
    else { Write-Host "ok   $Name" }
}

try {
    # 1. The real 2026-09-19 outage. Anchor is 09-18 08:15 (the last productive
    #    run); 12:15/16:15/20:15/00:15 ran and hit the weekly limit; 04:15 never
    #    fired (S3 sleep); this run is the late catch-up for 08:15.
    Add-Log '2026-09-18_0815' '(exit 0) - ran, 18 lines of output'
    foreach ($s in '2026-09-18_1215','2026-09-18_1615','2026-09-18_2015','2026-09-19_0015') {
        Add-Log $s '(exit 1) - NO-OP: RATE LIMITED - You''ve hit your weekly limit'
    }
    Add-Log '2026-09-19_0959' '(exit 0) - ran, 40 lines of output'
    $r = Measure-MissedWindows $Tmp 'autobuild-checkin_2026-09-19_0959.log' ([datetime]'2026-09-19 09:59')
    Check 'anchors on the last PRODUCTIVE run' $r.Anchor 'autobuild-checkin_2026-09-18_0815.log'
    Check 'counts every lost slot (old code said 1)' $r.Lost 5
    Check 'splits out the rate-limited no-ops'      $r.NoOp 4
    Check 'splits out the window that never fired'  $r.Never 1

    # 2. A late run after a healthy predecessor must stay silent. This is the
    #    case gap arithmetic got wrong in the other direction.
    Remove-Item "$Tmp\*" -Force
    Add-Log '2026-09-19_0415' '(exit 0) - ran, 22 lines of output'
    Add-Log '2026-09-19_0959' '(exit 0) - ran, 22 lines of output'
    $r = Measure-MissedWindows $Tmp 'autobuild-checkin_2026-09-19_0959.log' ([datetime]'2026-09-19 09:59')
    Check 'a 5.7h gap from a late start is not a miss' $r.Lost 0

    # 3. No productive run on record at all: report nothing rather than guess.
    Remove-Item "$Tmp\*" -Force
    Add-Log '2026-09-19_0415' '(exit 1) - NO-OP: RATE LIMITED - You''ve hit your weekly limit'
    $r = Measure-MissedWindows $Tmp 'autobuild-checkin_2026-09-19_0959.log' ([datetime]'2026-09-19 09:59')
    Check 'no anchor -> no claim' $r $null
}
finally { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }

if ($Fail) { Write-Host "`n$Fail check(s) failed"; exit 1 }
Write-Host "`nall checks passed"
