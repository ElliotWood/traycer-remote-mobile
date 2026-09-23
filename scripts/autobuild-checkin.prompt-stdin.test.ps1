# Self-check: the check-in must hand claude its prompt on STDIN, not argv.
# powershell.exe 5.1 does not escape a native argument's inner `"`, so argv
# delivered 1126 of 12393 prompt chars (measured 2026-09-24). Run it:
#   powershell -File scripts/autobuild-checkin.prompt-stdin.test.ps1

$Src = Get-Content (Join-Path $PSScriptRoot 'autobuild-checkin.ps1') -Raw
$Fail = 0
if ($Src -notmatch '\$Prompt \| & \$Claude -p ') { Write-Host 'FAIL prompt is not piped to claude'; $Fail++ }
if ($Src -match '\$Claude -p \$Prompt')          { Write-Host 'FAIL prompt is passed as argv'; $Fail++ }
if ($Fail) { exit 1 }
Write-Host 'all checks passed'
