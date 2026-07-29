#!/bin/bash
# Enforces the ONE invariant A2's `buildTenantEnvironment`
# (clients/shared/identity-registry/tenant-environment.ts) and A1's
# systemd generator are both required to derive independently (see
# vm.bicep's comment on why this unit template calls that function's
# CONTRACT, not the function itself): HOME and USERPROFILE are both set to
# the tenant's home directory, unconditionally, last - nothing upstream of
# that assignment may override it.
#
# WHY THIS IS A SHELL SCRIPT, NOT A VITEST TEST: `tenant-environment.ts`
# lives on origin/traycer-azure-identity-registry (A2's own branch/ticket),
# not on this branch. This branch's dependency graph does not contain that
# module - a vitest test importing it would fail to resolve, not fail the
# assertion. This script fetches the file's source via `git show` against
# the known ref instead, so the check is real today rather than deferred
# indefinitely. ACCEPTED SHORTFALL, stated plainly rather than left
# implied: this is a grep-based structural check, not a type-checked
# import - it can be fooled by a change that keeps the same substrings in
# a different arrangement. Once A2 merges and clients/shared/identity-
# registry is part of this branch's own build graph, replace this with a
# real vitest test that imports buildTenantEnvironment directly and
# asserts its output against a parsed unit file - tracked, not silently
# forgotten, in infra/azure/README.md's known-gaps section.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
UNIT_FILE="${REPO_ROOT}/infra/azure/systemd/traycer-host@.service"
A2_REF="origin/traycer-azure-identity-registry"
A2_PATH="clients/shared/identity-registry/tenant-environment.ts"

fail() {
  echo "verify-tenant-env-parity: FAIL - $1" >&2
  exit 1
}

[ -f "$UNIT_FILE" ] || fail "unit file not found at ${UNIT_FILE}"

grep -qE '^Environment=HOME=__TRAYCER_HOME_ROOT__/%i$' "$UNIT_FILE" || \
  fail "unit file does not set HOME=<home-root>/%i exactly - see traycer-host@.service's [Service] section"
grep -qE '^Environment=USERPROFILE=__TRAYCER_HOME_ROOT__/%i$' "$UNIT_FILE" || \
  fail "unit file does not set USERPROFILE=<home-root>/%i exactly - matching HOME"

A2_SOURCE="$(git -C "$REPO_ROOT" show "${A2_REF}:${A2_PATH}" 2>/dev/null)" || \
  fail "could not fetch ${A2_PATH} from ${A2_REF} - run 'git fetch origin ${A2_REF#origin/}' first, or A2 has been renamed/moved and this script's paths need updating"

echo "$A2_SOURCE" | grep -qE '^\s*env\.HOME = options\.tenant\.home;\s*$' || \
  fail "buildTenantEnvironment no longer sets env.HOME = options.tenant.home - the systemd unit's HOME= line assumes this exact rule"
echo "$A2_SOURCE" | grep -qE '^\s*env\.USERPROFILE = options\.tenant\.home;\s*$' || \
  fail "buildTenantEnvironment no longer sets env.USERPROFILE = options.tenant.home - the systemd unit's USERPROFILE= line assumes this exact rule"

# Both assignments must be the LAST two non-blank statements in the
# function body (before its closing brace) - i.e. nothing after them can
# override HOME/USERPROFILE. A crude but real check: the line indices of
# both assignments must be within the final 3 non-blank lines before
# `return env;`.
last_lines="$(echo "$A2_SOURCE" | grep -vE '^\s*$' | tail -n 4)"
echo "$last_lines" | grep -q 'env.HOME = options.tenant.home;' || \
  fail "env.HOME assignment is no longer near the end of buildTenantEnvironment - something may now run after it and override it"
echo "$last_lines" | grep -q 'env.USERPROFILE = options.tenant.home;' || \
  fail "env.USERPROFILE assignment is no longer near the end of buildTenantEnvironment - something may now run after it and override it"

echo "verify-tenant-env-parity: PASS - systemd unit and buildTenantEnvironment derive HOME/USERPROFILE identically"
