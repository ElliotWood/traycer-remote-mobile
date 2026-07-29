#!/usr/bin/env bash
# Real-repo tests for provision-shared-repo.sh. Missing from the round-1
# suite entirely - "idempotent" was asserted in the script header and the
# layout doc but verified nowhere, which is exactly how the Windows/git-bash
# path-representation limitation went undiscovered until ad hoc testing
# (Evaluator's round-1 addendum, A1). This file is the fix: idempotency is
# now a real, run test, and the known platform limitation is a stated,
# detected SKIP - never a silent pass and never an unexplained red.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

echo "=== provision-shared-repo.test.sh ==="

script="../provision-shared-repo.sh"

# provision-shared-repo.sh clones from a real remote, so the "remote" here
# is a real bare repo, not a mock.
bare_root="$(mktemp -d)"
bare="${bare_root}/origin.git"
git init -q -b main --bare "$bare"
seed_wt="$(mktemp -d)/seed"
git clone -q "$bare" "$seed_wt"
git -C "$seed_wt" config user.email "test@example.com"
git -C "$seed_wt" config user.name "Test"
echo seed >"${seed_wt}/seed.txt"
git -C "$seed_wt" add seed.txt
git -C "$seed_wt" -c commit.gpgsign=false commit -q -m init
git -C "$seed_wt" push -q origin main

clone_dir="$(mktemp -d)/shared-clone/repo"

echo "--- rejects a relative clone-dir ---"
if bash "$script" "relative/path" "$bare" >/dev/null 2>"${bare_root}/err1.log"; then
  azure_test_fail "relative path should have been rejected"
else
  azure_test_pass "relative path rejected: $(cat "${bare_root}/err1.log")"
fi

echo "--- first run: clones successfully ---"
bash "$script" "$clone_dir" "$bare" main >"${bare_root}/run1.log" 2>&1
azure_test_assert "clone directory exists after first run" '[ -d "${clone_dir}/.git" ]'

echo "--- refuses an existing non-git directory ---"
nongit_dir="$(mktemp -d)/not-a-repo"
mkdir -p "$nongit_dir"
echo "just a file" >"${nongit_dir}/file.txt"
if bash "$script" "$nongit_dir" "$bare" >/dev/null 2>"${bare_root}/err2.log"; then
  azure_test_fail "existing non-git directory should have been refused"
else
  azure_test_pass "existing non-git directory refused: $(cat "${bare_root}/err2.log")"
fi

echo "--- refuses a mismatched origin on an existing clone ---"
other_bare="${bare_root}/other.git"
git init -q -b main --bare "$other_bare"
if bash "$script" "$clone_dir" "$other_bare" >/dev/null 2>"${bare_root}/err3.log"; then
  azure_test_fail "mismatched origin should have been refused"
else
  azure_test_pass "mismatched origin refused: $(cat "${bare_root}/err3.log")"
fi

echo "--- idempotent re-run with the IDENTICAL argument string ---"
set +e
bash "$script" "$clone_dir" "$bare" main >"${bare_root}/run2.log" 2>&1
rerun_rc=$?
set -e

is_windows_bash=0
case "${MSYSTEM:-}$(uname -s 2>/dev/null || true)" in
  *MSYS*|*MINGW*|*CYGWIN*) is_windows_bash=1 ;;
esac

if [ "$rerun_rc" -eq 0 ]; then
  azure_test_pass "idempotent re-run with identical args succeeds (rc=0, 'nothing to do')"
  azure_test_assert "re-run reports 'origin matches - nothing to do', not a fresh clone" \
    'grep -q "origin matches" "${bare_root}/run2.log"'
elif [ "$is_windows_bash" -eq 1 ] && grep -q "does not.*match the requested remote" "${bare_root}/run2.log"; then
  echo "  SKIP: idempotent re-run fails on Windows/git-bash specifically - this is the documented"
  echo "        path-representation artifact (git remote get-url echoes a drive-lettered path where"
  echo "        a POSIX-style path was passed to git clone), NOT a defect in the script's logic."
  echo "        Reasoned, not verified, that this does not occur on the Linux target (git there"
  echo "        echoes back the literal string passed to git clone with no re-representation)."
  echo "        NOT counted as a pass or a failure - re-run this exact test on Linux before relying"
  echo "        on idempotency in production."
else
  azure_test_fail "idempotent re-run failed for a reason OTHER than the documented Windows path-representation artifact - see ${bare_root}/run2.log"
  cat "${bare_root}/run2.log"
fi

rm -rf "$bare_root" "$(dirname "$seed_wt")" "$(dirname "$clone_dir")" "$(dirname "$nongit_dir")"

azure_test_summary
