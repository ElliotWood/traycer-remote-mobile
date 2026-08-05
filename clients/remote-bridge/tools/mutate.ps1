# Breaks one load-bearing behaviour at a time and asserts a NAMED test reddens.
#
# Verifies the edit LANDED (occurrence count before and after) before believing
# any result. A mutation that silently fails to apply reports SURVIVED for
# something that was never measured -- which is the same false green this
# package's tests exist to prevent, one level up.
#
# Targets are line-ending agnostic single-line substrings, after the first
# version of this script matched on CRLF against an LF file and aborted three
# times out of three.
$ErrorActionPreference = "Stop"
$src = "src/adapters/watch-events.ts"

$mutations = @(
  @{ name  = "drop the ChatStatus.connected guard"
     find  = "!status.connected"
     repl  = "false"
     count = 1
     expect = "does NOT resolve on a disconnected chat" },
  @{ name  = "stop de-duplicating across ticks"
     find  = "if (this.open.has(eventId)) continue;"
     repl  = "if (false) continue;"
     count = 2
     expect = "emits on the tick it appears and nothing on identical later ticks" },
  @{ name  = "resolve from chats that were never observed"
     find  = "!usableChats.has(record.chatId)"
     repl  = "false"
     count = 1
     expect = "does NOT resolve a chat that was absent" }
)

$original = Get-Content $src -Raw
$i = 0
foreach ($m in $mutations) {
  $i++
  $before = ([regex]::Matches($original, [regex]::Escape($m.find))).Count
  if ($before -ne $m.count) {
    Write-Host ("M{0}  ABORT - target appears {1}x, expected {2}x: {3}" -f $i, $before, $m.count, $m.name)
    continue
  }
  $mutated = $original.Replace($m.find, $m.repl)
  Set-Content -Path $src -Value $mutated -NoNewline
  $after = ([regex]::Matches((Get-Content $src -Raw), [regex]::Escape($m.find))).Count
  if ($after -ne 0) {
    Write-Host ("M{0}  ABORT - edit did not land" -f $i)
    Set-Content -Path $src -Value $original -NoNewline
    continue
  }

  $out = & node ../../node_modules/vitest/vitest.mjs run 2>&1 | Out-String
  $red = $LASTEXITCODE -ne 0
  $named = $out -match [regex]::Escape($m.expect)
  $verdict = if ($red -and $named) { "CAUGHT" } elseif ($red) { "RED, but not by the named test" } else { "SURVIVED" }
  Write-Host ("M{0}  [{1}]  {2}" -f $i, $verdict, $m.name)
  ($out -split "`n" | Select-String -Pattern 'Tests +\d' | Select-Object -First 1) | ForEach-Object { "        $_".TrimEnd() }

  Set-Content -Path $src -Value $original -NoNewline
}

Write-Host "restored - re-verifying green"
& node ../../node_modules/vitest/vitest.mjs run 2>&1 | Select-String -Pattern 'Tests +\d' | ForEach-Object { "        $_".TrimEnd() }
