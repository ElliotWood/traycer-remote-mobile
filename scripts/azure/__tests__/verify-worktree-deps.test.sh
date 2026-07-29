#!/usr/bin/env bash
# Real-filesystem tests for verify-worktree-deps.sh, including the exact
# regression the Evaluator's eval-round-01 addendum B3 found: the original
# version scanned for EXISTING node_modules entries via `find` and only
# checked those for a dangling symlink, which cannot see a nested
# node_modules that is simply ABSENT - find cannot enumerate a path that was
# never created. That is precisely the documented incident
# (`clients/mobile/node_modules` missing, root node_modules present) this
# script exists to catch, and the scan-based version missed it entirely
# (reported "healthy", rc=0). The fix uses a POSITIVE expectation - derived
# from the root package.json's `workspaces` globs - instead of scanning for
# brokenness. This test proves the fix against that exact shape.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

echo "=== verify-worktree-deps.test.sh ==="

script="../verify-worktree-deps.sh"

new_fixture() {
  local root
  root="$(mktemp -d)/wt"
  mkdir -p "${root}/protocol" "${root}/clients/mobile" "${root}/.traycer"
  cat >"${root}/package.json" <<'EOF'
{"name":"root","workspaces":["protocol","clients/*"]}
EOF
  cat >"${root}/protocol/package.json" <<'EOF'
{"name":"protocol"}
EOF
  cat >"${root}/clients/mobile/package.json" <<'EOF'
{"name":"mobile"}
EOF
  cat >"${root}/.traycer/environment.json" <<'EOF'
{"setup":{"default":"touch REPAIRED.marker","macos":null,"windows":null,"linux":null},"teardown":{"default":"","macos":null,"windows":null,"linux":null}}
EOF
  printf '%s' "$root"
}

echo "--- healthy: root + every workspace member has node_modules ---"
wt1="$(new_fixture)"
mkdir -p "${wt1}/node_modules" "${wt1}/protocol/node_modules" "${wt1}/clients/mobile/node_modules"
out1="$(bash "$script" "$wt1" 2>&1)"
rc1=$?
azure_test_assert "healthy worktree reports healthy" 'echo "$out1" | grep -q "looks healthy"'
azure_test_assert "healthy worktree exits 0" '[ "$rc1" -eq 0 ]'
rm -rf "$(dirname "$wt1")"

echo "--- THE REGRESSION CASE: root present, nested clients/mobile/node_modules ABSENT ---"
wt2="$(new_fixture)"
mkdir -p "${wt2}/node_modules" "${wt2}/protocol/node_modules"
# clients/mobile/node_modules deliberately never created - this is the
# documented incident shape, and what eval-round-01 found the original
# script silently passed.
out2="$(bash "$script" "$wt2" 2>&1)"
azure_test_assert "regression case is detected as broken, not reported healthy" \
  '! echo "$out2" | grep -q "looks healthy"'
azure_test_assert "the specific missing path is named in the output" \
  'echo "$out2" | grep -q "clients/mobile/node_modules"'
azure_test_assert "self-heal ran (the setup command executed)" \
  '[ -f "${wt2}/REPAIRED.marker" ]'
rm -rf "$(dirname "$wt2")"

echo "--- dangling symlink (the original, already-covered incident shape) ---"
symlink_probe_dir="$(mktemp -d)"
if ln -s "${symlink_probe_dir}/nonexistent-target" "${symlink_probe_dir}/probe-link" 2>/dev/null; then
  wt3="$(new_fixture)"
  mkdir -p "${wt3}/node_modules" "${wt3}/protocol/node_modules"
  ln -s "${wt3}/clients/mobile/does-not-exist-target" "${wt3}/clients/mobile/node_modules"
  out3="$(bash "$script" "$wt3" 2>&1)"
  azure_test_assert "dangling symlink is detected as broken" \
    '! echo "$out3" | grep -q "looks healthy"'
  azure_test_assert "dangling symlink case self-heals" \
    '[ -f "${wt3}/REPAIRED.marker" ]'
  rm -rf "$(dirname "$wt3")"
else
  echo "  SKIP: this machine cannot create symlinks without elevated privileges (Windows without"
  echo "        Developer Mode/admin) - not a defect in the script, a platform limitation of this"
  echo "        dev environment. The [ ! -e ] check this relies on is standard POSIX behavior and"
  echo "        expected to work identically on the Linux target; not independently verified here."
fi
rm -rf "$symlink_probe_dir"

echo "--- root node_modules missing entirely (still covered) ---"
wt4="$(new_fixture)"
mkdir -p "${wt4}/protocol/node_modules" "${wt4}/clients/mobile/node_modules"
# root node_modules never created
out4="$(bash "$script" "$wt4" 2>&1)"
azure_test_assert "missing root node_modules is detected as broken" \
  '! echo "$out4" | grep -q "looks healthy"'
rm -rf "$(dirname "$wt4")"

echo "--- non-workspace directory (no root package.json): skipped gracefully, not an error ---"
wt5="$(mktemp -d)"
set +e
out5="$(bash "$script" "$wt5" 2>&1)"
rc5=$?
set -e
azure_test_assert "no package.json exits 0 (nothing to verify), not a failure" '[ "$rc5" -eq 0 ]'
rm -rf "$wt5"

azure_test_summary
