#!/usr/bin/env bash
# Real-repo concurrency proof: N simulated identities' host processes running
# `git worktree add` against ONE shared `.git` at the same instant, plus a
# `git gc --auto` racing the burst (A4 contract required addition #3 -
# untested by either generator or evaluator before this sprint).
#
# Parameterize N via AZURE_TEST_CONCURRENCY (default 8, matching the
# contract's original probe).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=/dev/null
source ./lib.sh
# shellcheck source=/dev/null
source ../branch-namespace.sh

N="${AZURE_TEST_CONCURRENCY:-8}"
echo "=== concurrency.test.sh (N=${N}) ==="

scratch="$(azure_test_new_scratch_repo)"
trap 'azure_test_cleanup_scratch "$scratch"' EXIT
worktree_root="$(mktemp -d)"

echo "--- N-way concurrent worktree add, distinct identities ---"
declare -a pids=()
# NOT `declare -a` - this is a single scratch directory PATH (a scalar), not
# an array. A leftover `declare -a results_dir` here was a genuine copy-paste
# bug (caught by shellcheck SC2178/SC2128 in eval round 4): it worked
# functionally by accident (bash treats a bare `$var` on a one-element array
# as index 0, same as a scalar), but every subsequent `${results_dir}` use
# was flagged as "expanding an array without an index." Fixed by removing
# the incorrect declaration rather than indexing every use.
results_dir="$(mktemp -d)"
for i in $(seq 1 "$N"); do
  (
    identity="identity${i}"
    chat_id="chat-${i}"
    branch="$(azure_branch_name "$scratch" "$identity" "$chat_id")"
    path="${worktree_root}/${identity}-${chat_id}"
    start=$(date +%s%N)
    if git -C "$scratch" worktree add -q -b "$branch" "$path" main >"${results_dir}/${i}.log" 2>&1; then
      end=$(date +%s%N)
      echo "OK ${branch} elapsed_ms=$(( (end - start) / 1000000 ))" >>"${results_dir}/${i}.result"
    else
      end=$(date +%s%N)
      echo "FAIL ${branch} elapsed_ms=$(( (end - start) / 1000000 ))" >>"${results_dir}/${i}.result"
    fi
  ) &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done

fail_count=0
for i in $(seq 1 "$N"); do
  line="$(cat "${results_dir}/${i}.result")"
  echo "  ${line}"
  case "$line" in
    OK*) : ;;
    *) fail_count=$((fail_count + 1)) ;;
  esac
done
azure_test_assert "all ${N} concurrent worktree-add calls succeeded (git's own ref locking, no app-level mutex)" \
  '[ "$fail_count" -eq 0 ]'
azure_test_assert "git fsck reports the shared repo is not corrupted after the burst" \
  'git -C "$scratch" fsck --no-progress >/dev/null 2>&1'
azure_test_assert "all ${N} worktrees are actually registered" \
  '[ "$(git -C "$scratch" worktree list | wc -l)" -eq "$((N + 1))" ]'

echo "--- git gc --auto racing a fresh burst of worktree adds ---"
gc_scratch="$(azure_test_new_scratch_repo)"
gc_worktree_root="$(mktemp -d)"
( git -C "$gc_scratch" gc --auto >/dev/null 2>&1 || true ) &
gc_pid=$!
gc_results="$(mktemp -d)"
for i in $(seq 1 "$N"); do
  (
    identity="gcidentity${i}"
    branch="$(azure_branch_name "$gc_scratch" "$identity" "chat-${i}")"
    if git -C "$gc_scratch" worktree add -q -b "$branch" "${gc_worktree_root}/${identity}" main >"${gc_results}/${i}.log" 2>&1; then
      echo "OK" >"${gc_results}/${i}.result"
    else
      echo "FAIL" >"${gc_results}/${i}.result"
    fi
  ) &
done
wait
wait "$gc_pid" 2>/dev/null || true
gc_fail=0
for i in $(seq 1 "$N"); do
  [ "$(cat "${gc_results}/${i}.result")" = "OK" ] || gc_fail=$((gc_fail + 1))
done
azure_test_assert "worktree-add survives a concurrent 'git gc --auto' with no failures" '[ "$gc_fail" -eq 0 ]'
azure_test_assert "repo is not corrupted after gc raced worktree creation" \
  'git -C "$gc_scratch" fsck --no-progress >/dev/null 2>&1'
azure_test_cleanup_scratch "$gc_scratch"
rm -rf "$gc_worktree_root" "$results_dir" "$gc_results"

rm -rf "$worktree_root"

azure_test_summary
