# Self-check for the TRAYCER HOST WAS DOWN block in autobuild-checkin.ps1.
#
# Replays the three things `traycer host ensure` actually prints, captured
# 2026-09-23 08:17-08:20 against a dead host and then a live one. Run it:
#   pwsh -File scripts/autobuild-checkin.host-ensure.test.ps1

$ErrorActionPreference = 'Stop'

# The block under test, with the CLI call injected so no host is needed.
function Test-HostRevived {
    param([string]$Ensure)
    return ($Ensure.Trim() -notmatch 'already ready')
}

$Fail = 0
function Check { param($Name, $Got, $Want)
    if ("$Got" -ne "$Want") { Write-Host "FAIL $Name : got '$Got' want '$Want'"; $script:Fail++ }
    else { Write-Host "ok   $Name" }
}

# 1. The live host, measured 08:20. This is the every-four-hours case: it must
#    stay silent, or the log grows a false outage six times a day.
Check 'a live host reports nothing' `
    (Test-HostRevived 'host already ready (version=1.1.10)') $false

# 2. The dead host, measured 08:17 - the 8-hour outage this block exists for.
#    Two lines, and the second is the one that differs by only two letters
#    from "starting", which is why the discriminator keys on "already ready"
#    rather than trying to spot the revive.
Check 'a revived host is reported' `
    (Test-HostRevived "starting the registered host service`nstarted the registered host service (version=1.1.10)") $true

# 3. `ensure` failing outright. Must report, not fall through quiet: an
#    unparseable answer is a host we cannot vouch for.
Check 'an error is reported, not swallowed' `
    (Test-HostRevived 'error: traycer: host not running [code=E_HOST_NOT_RUNNING]') $true
Check 'empty output is reported, not swallowed' (Test-HostRevived '') $true

# 4. The above tests a COPY of the block, so it would keep passing if the
#    script's own discriminator were changed or deleted. Tie the two together:
#    assert the real file still keys on the same phrase, and still refuses to
#    key on $LASTEXITCODE - `ensure` exits 0 whether it revived the host or
#    found it already up, so an exit-code test here would read health off a
#    constant.
$Script = Join-Path $PSScriptRoot 'autobuild-checkin.ps1'
$Body = Get-Content $Script -Raw
$Block = [regex]::Match($Body, '(?s)\$Ensure = .*?\n\}').Value
Check 'the script still keys on "already ready"' ($Block -match "notmatch 'already ready'") $true
Check 'the script does not key on the exit code' ($Block -match 'LASTEXITCODE') $false

if ($Fail) { Write-Host "`n$Fail check(s) failed"; exit 1 }
Write-Host "`nall checks passed"
