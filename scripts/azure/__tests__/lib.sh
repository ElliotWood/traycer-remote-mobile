#!/usr/bin/env bash
# Shared helpers for the scripts/azure test suite. Every test in this suite
# runs against a REAL, disposable git repository created under a temp
# directory - never a mock or a fixture that stands in for git's actual
# behavior (A4 ticket requirement: "tests that exercise the concurrency and
# naming rules against a real git repository - not mocks").
set -euo pipefail

AZURE_TEST_FAILURES=0
AZURE_TEST_COUNT=0

azure_test_pass() {
  AZURE_TEST_COUNT=$((AZURE_TEST_COUNT + 1))
  echo "  PASS: $1"
}

azure_test_fail() {
  AZURE_TEST_COUNT=$((AZURE_TEST_COUNT + 1))
  AZURE_TEST_FAILURES=$((AZURE_TEST_FAILURES + 1))
  echo "  FAIL: $1"
}

azure_test_assert() {
  local description="$1" condition="$2"
  if eval "$condition"; then
    azure_test_pass "$description"
  else
    azure_test_fail "$description ($condition)"
  fi
}

azure_test_summary() {
  echo ""
  echo "$(basename "$0"): ${AZURE_TEST_COUNT} checks, ${AZURE_TEST_FAILURES} failed (git: $(git --version))"
  if [ "$AZURE_TEST_FAILURES" -ne 0 ]; then
    exit 1
  fi
  exit 0
}

# Creates a fresh, disposable git repo with one commit on `main` under a new
# temp directory and prints the directory path. Caller is responsible for
# cleanup (azure_test_cleanup_scratch).
azure_test_new_scratch_repo() {
  local scratch
  scratch="$(mktemp -d)"
  git -C "$scratch" init -q -b main
  git -C "$scratch" config user.email "test@example.com"
  git -C "$scratch" config user.name "Test"
  echo "seed" >"${scratch}/seed.txt"
  git -C "$scratch" add seed.txt
  git -C "$scratch" -c commit.gpgsign=false commit -q -m "init"
  printf '%s' "$scratch"
}

azure_test_cleanup_scratch() {
  local scratch="$1"
  rm -rf "$scratch"
}

# Runs a command under a forced locale, so the suite proves its claims under
# more than the ambient locale (A4 contract required addition: the allow-list
# must be proven under both `C` and a UTF-8 locale, not just whichever locale
# happens to be active on the machine running the suite).
azure_test_under_locale() {
  local locale="$1"
  shift
  LC_ALL="$locale" "$@"
}
