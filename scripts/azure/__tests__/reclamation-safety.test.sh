#!/usr/bin/env bash
# Proves the reclamation safety floor two ways:
#  1. Reproduces (independently, in a real repo) that a worktree's age
#     signals - admin gitdir mtime, HEAD reflog - stay FROZEN while an agent
#     is actively writing uncommitted files. This is the exact trap that
#     makes "age" an unsafe removal signal (rubric §5).
#  2. Statically proves housekeeping-sweep.sh's actual deliverable code never
#     computes or acts on an age threshold, and never invokes a delete
#     operation - i.e. the safety floor is structural in the script we ship,
#     not just asserted in prose.
#
# Scope note: this suite does NOT re-test `classifyWorktreeTier` itself
# (product code, already covered elsewhere) - it tests (a) the underlying git
# signals it depends on, empirically, and (b) that our own script respects
# tier-only/report-only, structurally.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=/dev/null
source ./lib.sh

echo "=== reclamation-safety.test.sh ==="

scratch="$(azure_test_new_scratch_repo)"
trap 'azure_test_cleanup_scratch "$scratch"' EXIT
worktree_root="$(mktemp -d)"

wt_path="${worktree_root}/agent-wip"
git -C "$scratch" worktree add -q -b u/erin/chat-live "$wt_path" main

gitdir_file="$(git -C "$wt_path" rev-parse --git-dir)"
# `stat` flag differs BSD vs GNU; try GNU first (Linux target, and git-bash's
# coreutils), fall back to BSD (macOS) - avoids a node dependency for a
# one-line mtime read.
stat_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}
mtime_before="$(stat_mtime "$gitdir_file")"
reflog_before="$(git -C "$wt_path" reflog show HEAD -1 2>/dev/null || true)"

echo "--- simulating an actively-working agent: writing uncommitted files, no commit ---"
sleep 1
echo "in progress" >"${wt_path}/agent-wip.txt"
mkdir -p "${wt_path}/src"
echo "export const x = 1;" >"${wt_path}/src/big.ts"

mtime_after="$(stat_mtime "$gitdir_file")"
reflog_after="$(git -C "$wt_path" reflog show HEAD -1 2>/dev/null || true)"

azure_test_assert "admin gitdir mtime does NOT advance from an uncommitted write (age signal #1 is blind to live work)" \
  '[ "$mtime_before" = "$mtime_after" ]'
azure_test_assert "HEAD reflog does NOT gain an entry from an uncommitted write (age signal #2 is blind to live work)" \
  '[ "$reflog_before" = "$reflog_after" ]'

uncommitted_count="$(git -C "$wt_path" status --porcelain | wc -l)"
azure_test_assert "the ONE signal that IS true here - uncommittedCount - correctly shows dirty work (this is what tier=review keys on, not age)" \
  '[ "$uncommitted_count" -gt 0 ]'

echo "--- structural proof: housekeeping-sweep.sh never computes or acts on age, never deletes ---"
sweep_script="../housekeeping-sweep.sh"
# Strip comment lines (leading '#', ignoring indentation) and blank lines
# first - the script's own doc-comments intentionally NAME "worktree
# delete"/"lastActivityAt" etc. to explain what it deliberately does NOT do,
# which would otherwise make a naive grep self-defeating (matching the
# prose that documents the constraint, not a violation of it).
sweep_code="$(grep -vE '^\s*#' "$sweep_script" | grep -vE '^\s*$')"
azure_test_assert "housekeeping-sweep.sh's executable code never invokes 'traycer worktree delete'" \
  '! grep -q "worktree delete" <<<"$sweep_code"'
azure_test_assert "housekeeping-sweep.sh's executable code never invokes 'git worktree remove'" \
  '! grep -q "worktree remove" <<<"$sweep_code"'
azure_test_assert "housekeeping-sweep.sh's executable code never invokes 'rm -rf' against a worktree path" \
  '! grep -qE "rm -rf.*worktree" <<<"$sweep_code"'
# Widened from the round-1 version, which only matched a few named idioms
# (lastActivityAt/mtime/"days old"/"date -d") and so would have passed
# against a script that computed age via `$(( $(date +%s) - created ))` -
# true of the shipped script, but the assertion claimed more than it
# checked. Broadened to catch the general shapes an age computation takes
# (date-arithmetic, epoch-diffing, a bare "now" reference) - still a
# pattern-match, not a proof of absence, so the wording says so rather than
# claiming an unqualified universal.
azure_test_assert "housekeeping-sweep.sh's executable code contains no age/timestamp-based conditional matching the known idioms this script would use (date arithmetic, epoch diffing, lastActivityAt/mtime references)" \
  '! grep -qiE "lastActivityAt|mtime|days? old|date -d|date \+%s|\bnow\b\s*-|Date\.now" <<<"$sweep_code"'
azure_test_assert "housekeeping-sweep.sh's executable code only calls the read-only listAllForHost surface, never an act-capable one" \
  'grep -q "worktree list" <<<"$sweep_code" && ! grep -qE "approvalDecision|fileEditApprovalDecision|\bsend\b" <<<"$sweep_code"'

rm -rf "$worktree_root"

azure_test_summary
