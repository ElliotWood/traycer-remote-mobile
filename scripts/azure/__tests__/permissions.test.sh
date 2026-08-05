#!/usr/bin/env bash
# Confirms (does not assume) the decision log's claim that same-OS-user
# removes `safe.directory` / cross-ownership friction from the shared-clone
# design. Simulates two identities purely via distinct HOME directories
# (matching A1's actual isolation mechanism) while running as the same OS
# account throughout - which is exactly the deployed shape (one OS user, N
# HOMEs).
#
# Scope note (stated explicitly per the A4 contract): this test says NOTHING
# about credential separation - that risk is already named and accepted in
# the decision log ("any process under that user can read any other
# tenant's ~/.traycer/cli/credentials"). This test only exercises git's own
# ownership check.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=/dev/null
source ./lib.sh

echo "=== permissions.test.sh ==="

scratch="$(azure_test_new_scratch_repo)"
trap 'azure_test_cleanup_scratch "$scratch"' EXIT

home_alice="$(mktemp -d)"
home_bob="$(mktemp -d)"
worktree_root="$(mktemp -d)"

echo "--- worktree created under identity 'alice' (HOME=${home_alice}), zero safe.directory config ---"
alice_path="${worktree_root}/alice-chat"
HOME="$home_alice" git -C "$scratch" worktree add -q -b u/alice/chat-1 "$alice_path" main
azure_test_assert "worktree creation succeeded under alice's HOME with no safe.directory entry" \
  '[ -d "$alice_path" ]'

echo "--- same worktree read/operated on 'as' identity 'bob' (HOME=${home_bob}), same OS account ---"
set +e
HOME="$home_bob" git -C "$alice_path" status --porcelain >"${scratch}/bob-status.log" 2>&1
bob_rc=$?
set -e
azure_test_assert "bob's HOME can run git status against alice's worktree with NO ownership error (proves same-OS-user removes safe.directory friction)" \
  '[ "$bob_rc" -eq 0 ]'
azure_test_assert "no 'detected dubious ownership' error appears" \
  '! grep -qi "dubious ownership" "${scratch}/bob-status.log"'

echo "--- same check the other direction: bob creates, alice reads ---"
bob_path="${worktree_root}/bob-chat"
HOME="$home_bob" git -C "$scratch" worktree add -q -b u/bob/chat-1 "$bob_path" main
set +e
HOME="$home_alice" git -C "$bob_path" log --oneline -1 >"${scratch}/alice-log.log" 2>&1
alice_rc=$?
set -e
azure_test_assert "alice's HOME can read bob's worktree with no ownership error" \
  '[ "$alice_rc" -eq 0 ]'

echo "--- explicit scope statement (not a test, a documented boundary) ---"
echo "  This suite does not and cannot test credential separation - same-OS-user"
echo "  means any process can already read any other identity's ~/.traycer/cli/credentials."
echo "  That is an accepted risk from the decision log, not something A4 changes."

rm -rf "$home_alice" "$home_bob" "$worktree_root"

azure_test_summary
