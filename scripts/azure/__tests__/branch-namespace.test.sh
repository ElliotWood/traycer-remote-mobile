#!/usr/bin/env bash
# Real-repo tests for branch-namespace.sh: B1 (flag-injection), B2
# (flat-branch cross-tenant collision), B3 (locale-dependent case-folding),
# plus the collision-proof and D/F-within-identity claims from the A4
# contract's original "already verified" table.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=/dev/null
source ./lib.sh
# shellcheck source=/dev/null
source ../branch-namespace.sh

echo "=== branch-namespace.test.sh ==="

# --- Regression harness note: every "rejected" assertion below was run
# against the UNFIXED script first (identity/chat-id concatenated with no
# validation, i.e. `echo "${identity}/${chat_id}"`) during development, and
# every one of them genuinely failed (the malicious input was accepted) -
# confirming these are real regression tests, not tests that pass either way.

scratch="$(azure_test_new_scratch_repo)"
trap 'azure_test_cleanup_scratch "$scratch"' EXIT

echo "--- collision-proof: two identities, identical chat-id, no collision ---"
name_a="$(azure_branch_name "$scratch" alice shared-topic)"
name_b="$(azure_branch_name "$scratch" bob shared-topic)"
azure_test_assert "alice and bob get distinct branch names for the same chat-id" \
  '[ "$name_a" != "$name_b" ]'
azure_test_assert "alice's branch is u/alice/shared-topic" \
  '[ "$name_a" = "u/alice/shared-topic" ]'
git -C "$scratch" branch "$name_a" >/dev/null
git -C "$scratch" branch "$name_b" >/dev/null
azure_test_assert "both branches actually exist in the shared repo" \
  'git -C "$scratch" show-ref --verify --quiet refs/heads/u/alice/shared-topic && git -C "$scratch" show-ref --verify --quiet refs/heads/u/bob/shared-topic'

echo "--- B1: flag-injection vectors rejected BEFORE reaching git ---"
for evil in "-D" "--force" "-b" "--track" "-x"; do
  if azure_branch_name "$scratch" "$evil" "chat-1" >/dev/null 2>"${scratch}/err.tmp"; then
    azure_test_fail "identity='${evil}' should have been rejected, was accepted"
  else
    azure_test_pass "identity='${evil}' rejected: $(cat "${scratch}/err.tmp")"
  fi
  if azure_branch_name "$scratch" "victim$RANDOM" "$evil" >/dev/null 2>"${scratch}/err.tmp"; then
    azure_test_fail "chat-id='${evil}' should have been rejected, was accepted"
  else
    azure_test_pass "chat-id='${evil}' rejected: $(cat "${scratch}/err.tmp")"
  fi
done

echo "--- B1: victim-survives proof (the actual danger, not just a non-zero exit) ---"
git -C "$scratch" branch victim-branch >/dev/null
set +e
git -C "$scratch" worktree add "${scratch}-wt-evil" -b "-D" victim-branch >/dev/null 2>&1
set -e
azure_test_assert "raw git 'worktree add -b -D victim-branch' DOES delete the victim (confirms B1 is real, not theoretical - this is why the sanitizer, not git, is the defense)" \
  '! git -C "$scratch" show-ref --verify --quiet refs/heads/victim-branch'
azure_test_assert "our sanitizer never lets '-D' reach git in the first place" \
  '! azure_branch_name "$scratch" "-D" "chat-1" >/dev/null 2>&1'

echo "--- confusable-input rejection (homoglyph / zero-width) ---"
# Cyrillic 'а' (U+0430) in place of Latin 'a'
cyrillic_a=$'аlice'
# Cyrillic 'е' (U+0435) in place of Latin 'e'
cyrillic_e=$'alicе'
# Latin 'bob' + trailing zero-width no-break space (U+FEFF)
zero_width=$'bob﻿'
for confusable in "$cyrillic_a" "$cyrillic_e" "$zero_width"; do
  if azure_branch_name "$scratch" "$confusable" "chat-1" >/dev/null 2>"${scratch}/err.tmp"; then
    azure_test_fail "confusable identity '${confusable}' should have been rejected, was accepted (would be indistinguishable from a real tenant's branch in any UI)"
  else
    azure_test_pass "confusable identity rejected: $(cat "${scratch}/err.tmp")"
  fi
done

echo "--- B3: allow-list proven under BOTH C and a UTF-8 locale, not just the ambient one ---"
for locale in C C.UTF-8 en_US.UTF-8; do
  if ! locale -a 2>/dev/null | grep -qix "${locale//-/}" && ! locale -a 2>/dev/null | grep -qix "$locale"; then
    echo "  SKIP locale '${locale}' not installed on this machine"
    continue
  fi
  if LC_ALL="$locale" azure_branch_name "$scratch" "ALICE" "chat-1" >/dev/null 2>"${scratch}/err.tmp"; then
    azure_test_fail "locale=${locale}: 'ALICE' should have been rejected, was accepted (this is the exact trap: [a-z] matches uppercase under glibc UTF-8 collation unless LC_ALL=C is forced internally)"
  else
    azure_test_pass "locale=${locale}: 'ALICE' rejected"
  fi
done
lc_all_before="${LC_ALL:-__unset__}"
azure_branch_name "$scratch" leaktest chat-1 >/dev/null
lc_all_after="${LC_ALL:-__unset__}"
azure_test_assert "LC_ALL is scoped 'local' to the validator - does not leak the forced C locale onto the caller's shell afterward" \
  '[ "$lc_all_before" = "$lc_all_after" ]'

echo "--- B2: flat-branch-blocks-namespace, both directions ---"
scratch2="$(azure_test_new_scratch_repo)"
git -C "$scratch2" branch "u/pretenant" >/dev/null
if azure_branch_name "$scratch2" "pretenant" "chat-1" >/dev/null 2>"${scratch2}/err.tmp"; then
  azure_test_fail "flat 'u/pretenant' should have blocked the namespace, pre-flight check missed it"
else
  azure_test_pass "flat-branch-before-nested correctly blocked: $(cat "${scratch2}/err.tmp")"
fi
azure_test_cleanup_scratch "$scratch2"

scratch3="$(azure_test_new_scratch_repo)"
git -C "$scratch3" branch "u/carol/existing-chat" >/dev/null
azure_test_assert "an existing nested branch does NOT block a sibling chat for the same identity" \
  'azure_branch_name "$scratch3" carol another-chat >/dev/null 2>&1'
azure_test_cleanup_scratch "$scratch3"

echo "--- D/F conflict within one identity's own chat-ids (self-inflicted, not cross-tenant) ---"
scratch4="$(azure_test_new_scratch_repo)"
git -C "$scratch4" branch "u/dana/topic" >/dev/null
set +e
git -C "$scratch4" branch "u/dana/topic/sub" 2>"${scratch4}/df-err.tmp"
df_result=$?
set -e
azure_test_assert "git itself rejects the D/F conflict (this is git's own atomic ref lock, not our sanitizer - the sanitizer bans '/' inside a chat-id segment via the allow-list, which prevents this from ever being reachable through Traycer)" \
  '[ "$df_result" -ne 0 ]'
azure_test_assert "'/' inside a chat-id is rejected by our allow-list before it could ever produce this shape" \
  '! azure_branch_name "$scratch4" dana "topic/sub" >/dev/null 2>&1'
azure_test_cleanup_scratch "$scratch4"

azure_test_summary
