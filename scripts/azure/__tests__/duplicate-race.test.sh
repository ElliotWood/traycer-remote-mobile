#!/usr/bin/env bash
# Two processes racing to create the exact same branch name (e.g. a retried
# RPC after a timeout, or two host processes both reacting to the same
# `epic.createChat` idempotency key). Proves git's own ref lock is atomic -
# exactly one winner, the loser fails loudly - and that the failure is
# recognizable so a caller can treat it as "adopt the existing worktree"
# rather than crash.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

echo "=== duplicate-race.test.sh ==="

scratch="$(azure_test_new_scratch_repo)"
trap 'azure_test_cleanup_scratch "$scratch"' EXIT
worktree_root="$(mktemp -d)"
results="$(mktemp -d)"

for i in 1 2; do
  (
    if git -C "$scratch" worktree add -q -b "u/dupidentity/dup-chat" "${worktree_root}/dup-attempt-${i}" main >"${results}/${i}.log" 2>&1; then
      echo "OK" >"${results}/${i}.result"
    else
      echo "FAIL" >"${results}/${i}.result"
    fi
  ) &
done
wait

winners=0
for i in 1 2; do
  [ "$(cat "${results}/${i}.result")" = "OK" ] && winners=$((winners + 1))
done

azure_test_assert "exactly one of the two duplicate-branch attempts wins (not zero, not both)" \
  '[ "$winners" -eq 1 ]'
azure_test_assert "the loser's failure is git's own atomic ref-lock rejection, recognizable by callers" \
  'grep -qi "already exists\|cannot lock ref" "${results}/1.log" "${results}/2.log"'
azure_test_assert "exactly one worktree is bound in the repo afterward - no silent duplicate, no silent loss" \
  '[ "$(git -C "$scratch" worktree list | grep -c dup-attempt)" -eq 1 ]'

# A SEPARATE, non-racing "already exists" case: a caller retries after its
# own earlier request already succeeded (not a race - a genuine resend, per
# the bridge's dedup findings on other RPCs). This must be distinguishable
# from a real conflict so a provisioning wrapper can adopt-existing instead
# of failing the operator's request outright.
echo "--- non-racing resend: same branch requested again after it already exists ---"
set +e
git -C "$scratch" worktree add -q -b "u/dupidentity/dup-chat" "${worktree_root}/resend-attempt" main 2>"${results}/resend.log"
resend_rc=$?
set -e
azure_test_assert "a resend against an already-created branch fails the same recognizable way" \
  '[ "$resend_rc" -ne 0 ] && grep -qi "already exists" "${results}/resend.log"'
azure_test_assert "the ORIGINAL worktree is untouched by the resend attempt" \
  'git -C "$scratch" show-ref --verify --quiet refs/heads/u/dupidentity/dup-chat'

rm -rf "$worktree_root" "$results"

azure_test_summary
