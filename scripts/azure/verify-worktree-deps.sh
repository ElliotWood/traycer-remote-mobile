#!/usr/bin/env bash
# A linked worktree does not get its own `node_modules` install by default -
# this project's own setup convention (`.traycer/environment.json`, `setup`
# script, here `make build`) is what actually provisions it, typically via
# bun's content-addressable global cache (~/.bun/install/cache under the
# owning identity's HOME) rather than a full reinstall.
#
# Already-observed failure mode on this project (decision log,
# 2026-07-28): a worktree's `clients/mobile/node_modules` symlink went
# missing, tests failed with `Failed to resolve import "culori"`, and it
# read EXACTLY like a code defect. It was a stale/missing dependency graph;
# `bun install` in that worktree fixed it. This script exists so that trap
# is caught mechanically after every worktree provision, instead of
# rediscovered by a confused agent mid-task.
#
# AUTHORITY, stated explicitly (Evaluator eval-round-01 addendum B4): this
# script's self-heal path runs `eval` against the `setup` command from
# `<worktree>/.traycer/environment.json` - a file the protocol describes as
# "committable & shareable", i.e. controlled by whoever can commit to that
# worktree's branch. Executing it is CORRECT behavior, not a hole - the
# Traycer host already executes setup scripts by design, and agents running
# arbitrary code is an accepted risk in the decision log. What matters is
# WHO invokes this script and under what authority, exactly as
# housekeeping-sweep.sh states for itself:
#   - Run as **per-identity self-service** (an identity repairing their own
#     worktree): the tenant is executing their own committed code under
#     their own HOME - no authority question, same as any other command
#     that identity could already run.
#   - Run by a **central ops process across many worktrees**: it executes
#     EACH tenant's committed setup command as ops, not as that tenant -
#     sharper than housekeeping-sweep.sh's read-only listing, because this
#     is arbitrary code execution. If provisioning automation invokes this
#     script centrally, that invocation is itself the authority decision
#     and should be made deliberately, not incidentally.
set -euo pipefail

usage() {
  echo "usage: verify-worktree-deps.sh <worktree-dir>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

worktree_dir="$1"

if [ ! -d "$worktree_dir" ]; then
  echo "verify-worktree-deps: '${worktree_dir}' does not exist" >&2
  exit 1
fi

env_file="${worktree_dir}/.traycer/environment.json"

if ! command -v node >/dev/null 2>&1; then
  echo "verify-worktree-deps: 'node' not found on PATH - cannot enumerate workspace members or parse '${env_file}' (this is the exact 'spawned processes don't inherit PATH' trap from the decision log; a silent exit here would read as broken code, so failing loudly with this message instead) - escalate" >&2
  exit 1
fi

# POSITIVE expectation, not a scan for brokenness: derive which directories
# SHOULD have a node_modules from the root package.json's `workspaces`
# globs, then check each one. This is the actual fix for eval round 1's
# addendum B3 - the previous version used `find -name node_modules` to
# locate EXISTING node_modules entries and only checked those for a
# dangling symlink, which structurally cannot see a nested node_modules
# that is simply ABSENT (find cannot enumerate a path that was never
# created). That is exactly the documented incident this script exists to
# catch, and the scan-based version missed it. You can't find an absence by
# looking for it - you have to know what should be there.
root_pkg="${worktree_dir}/package.json"
if [ ! -f "$root_pkg" ]; then
  echo "verify-worktree-deps: no root package.json at '${root_pkg}' - not a bun/npm workspace root, nothing to verify"
  exit 0
fi

workspace_patterns="$(node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const patterns = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) ? pkg.workspaces.packages : [];
  process.stdout.write(patterns.join("\n"));
' "$root_pkg" 2>/dev/null || true)"

expected_dirs=("$worktree_dir")
if [ -n "$workspace_patterns" ]; then
  while IFS= read -r pattern; do
    [ -z "$pattern" ] && continue
    # Simple glob expansion (workspace patterns here are plain directory
    # globs like "clients/*", not full minimatch) - relative to worktree_dir.
    matched_this_pattern=0
    # shellcheck disable=SC2086
    # Deliberate: ${pattern} must word-split and glob-expand (workspace patterns
    # are plain directory globs like "clients/*"). Quoting it makes the path
    # literal, every [ -d ] fails, and the expectation set silently collapses to
    # the root - reintroducing the B3 blindness this function fixes. Not actually
    # flagged by shellcheck in practice (its own heuristics recognize the
    # quoted-prefix + unquoted-glob-suffix shape as intentional) - the disable
    # directive is kept anyway as documentation and a guard against other
    # linter versions/configs flagging it.
    for member_dir in "${worktree_dir}"/${pattern}; do
      [ -d "$member_dir" ] || continue
      [ -f "${member_dir}/package.json" ] || continue
      expected_dirs+=("$member_dir")
      matched_this_pattern=1
    done
    # A declared workspace pattern matching zero members is a signal, not a
    # normal state - a stale or typo'd glob would otherwise silently
    # downgrade this whole script to root-only verification, the same class
    # of blindness B3 was (a real problem that goes undetected because
    # nothing looked in the right place). Warn loudly rather than stay
    # quiet about it (Evaluator eval-round-03).
    if [ "$matched_this_pattern" -eq 0 ]; then
      echo "verify-worktree-deps: WARNING - workspace pattern '${pattern}' (from ${root_pkg}) matched no directory with a package.json; verification for it silently degrades to root-only unless this is fixed" >&2
    fi
  done <<<"$workspace_patterns"
fi

broken=0
for member_dir in "${expected_dirs[@]}"; do
  nm="${member_dir}/node_modules"
  # `[ -e ]` follows a symlink and tests the RESOLVED target, so this one
  # check catches both a completely absent node_modules AND a present-but-
  # dangling symlink - no separate `-L` branch needed.
  if [ ! -e "$nm" ]; then
    echo "verify-worktree-deps: missing (or dangling-symlink) node_modules at '${nm}' - this workspace member is expected to have one"
    broken=1
  fi
done

if [ "$broken" -eq 0 ]; then
  echo "verify-worktree-deps: '${worktree_dir}' dependency graph looks healthy (${#expected_dirs[@]} workspace member(s) checked)"
  exit 0
fi

if [ ! -f "$env_file" ]; then
  echo "verify-worktree-deps: dependency graph is broken and no '${env_file}' exists to re-run - cannot self-heal, escalate" >&2
  exit 1
fi

setup_cmd="$(node -e '
  const fs = require("fs");
  const env = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
  const setup = env.setup ?? {};
  const cmd = setup[platform] ?? setup.default ?? "";
  process.stdout.write(cmd);
' "$env_file" 2>/dev/null || true)"

if [ -z "$setup_cmd" ]; then
  echo "verify-worktree-deps: '${env_file}' has no usable setup command for this platform - cannot self-heal, escalate" >&2
  exit 1
fi

echo "verify-worktree-deps: re-running the worktree's own setup script to repair the dependency graph:"
echo "  ${setup_cmd}"
( cd "$worktree_dir" && eval "$setup_cmd" )

echo "verify-worktree-deps: setup script completed - re-verify before trusting this worktree"
