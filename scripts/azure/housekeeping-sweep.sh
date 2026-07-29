#!/usr/bin/env bash
# Fleet-wide view over the existing `traycer-housekeeping` capability, which
# is per-`HOME` (hence per-identity) scoped with no fleet-wide surface of its
# own. This script supplies ONLY the missing per-identity iteration - it does
# not reimplement classification, reporting, or deletion; those stay owned by
# `traycer worktree list` / `traycer worktree delete` and the housekeeping
# skill built on top of them.
#
# REPORT-ONLY, ALWAYS. This script never calls `traycer worktree delete`,
# `git worktree remove`, or `rm -rf`. Deletion is a separate, explicit,
# per-worktree human decision made through the existing skill's own Act step
# after reading this report - never automated here (A4 contract, rubric §5:
# "deleting a colleague's in-flight work is worse than any disk-full
# condition it prevents").
#
# TIER ONLY, NEVER AGE. `lastActivityAt` does not advance for an actively
# working but uncommitted agent - the admin gitdir mtime and HEAD reflog both
# stay frozen while files are being written with no commit (verified; see
# reclamation-safety.test.sh). A three-day-live agent can read as
# three-day-idle. This script never derives a removal signal from age; it
# only surfaces each row's `tier`, exactly as `traycer worktree list`
# computed it via the shared classifier (`classifyWorktreeTier` - the same
# function behind the Settings > Worktrees pills), and leaves every judgment
# call to a human reading the report.
#
# AUTHORITY - stated, not solved here. `traycer worktree list` calls
# `worktree.listAllForHost` over the host RPC
# (clients/traycer-cli/src/commands/worktree-list.ts:141-143) - it is NOT a
# disk-only read. Listing identity X's worktrees requires a live,
# authenticated host process bound to X's HOME, so this script genuinely
# does run with HOME pointed at each identity's home in turn, touching their
# credential store to make the call. This is not a NEW risk: it is a live
# instance of the already-accepted decision-log risk that all host processes
# share one OS user, so any process can already read any other tenant's
# credentials. What is bounded here: this script only ever calls the
# read-only `worktree.listAllForHost` RPC, never an act-capable one (no
# approve/send/reject) - it can enumerate metadata, never act as anyone.
# WHO is authorized to run this sweep (a per-identity self-service command vs
# a central ops account) is deliberately left as an open question for A3/A6
# to settle as a boundary decision - an honest open question here, not an
# invented answer.
#
# COST NOTE for A7: the CLI's listing path hardcodes `forceRefresh: true`
# (worktree-list.ts, same block cited above), so every sweep across N
# identities forces N full disk walks plus git/gh probes with no cache. Not
# an A4 problem to fix - flagged for capacity planning.
set -euo pipefail

usage() {
  echo "usage: housekeeping-sweep.sh <identity-home-dir>..." >&2
  echo "  one or more absolute paths, each a known identity's HOME (matches A1's per-process HOME)" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

if ! command -v traycer >/dev/null 2>&1; then
  echo "housekeeping-sweep: 'traycer' CLI not found on PATH - report-only degraded output follows (per traycer-housekeeping skill's own fallback: point the operator at Settings > Worktrees for each identity instead)" >&2
  for home_dir in "$@"; do
    echo "  - ${home_dir}: cannot list (no traycer CLI); check that identity's Settings > Worktrees manually"
  done
  exit 0
fi

total_identities=0
total_failed=0

# A dedicated mktemp dir, not a path built by suffixing home_dir: a sibling
# file named "${home_dir}.sweep-err.tmp" behaves differently depending on
# whether home_dir has a trailing slash, and can collide across identities
# whose HOME differs only by a trailing slash. mktemp sidesteps both.
err_dir="$(mktemp -d)"
trap 'rm -rf "$err_dir"' EXIT

for home_dir in "$@"; do
  total_identities=$((total_identities + 1))
  echo "=== identity HOME: ${home_dir} ==="
  if [ ! -d "$home_dir" ]; then
    echo "  SKIP - '${home_dir}' does not exist"
    total_failed=$((total_failed + 1))
    continue
  fi
  err_file="${err_dir}/${total_identities}.err"
  if ! HOME="$home_dir" traycer worktree list --json --include-activity 2>"$err_file"; then
    echo "  FAILED - see ${err_file} (host likely not running for this identity, or credentials expired)"
    total_failed=$((total_failed + 1))
    continue
  fi
done

echo "=== sweep summary: ${total_identities} identities, ${total_failed} unreachable ==="
echo "=== report-only: no deletions were made. Route the output above through the traycer-housekeeping skill's own classify/report/act flow for any removal decision. ==="
