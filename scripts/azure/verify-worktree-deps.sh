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

# A worktree is "healthy" here if every node_modules directory under it (bun
# workspaces symlink several, not just the root) resolves - i.e. is either a
# real directory or a symlink whose target exists. A dangling symlink is the
# exact failure mode from the incident above.
broken=0
while IFS= read -r -d '' nm_dir; do
  if [ -L "$nm_dir" ] && [ ! -e "$nm_dir" ]; then
    echo "verify-worktree-deps: dangling node_modules symlink at '${nm_dir}'"
    broken=1
  fi
done < <(find "$worktree_dir" -maxdepth 4 -name node_modules -print0 2>/dev/null)

if [ ! -e "${worktree_dir}/node_modules" ]; then
  echo "verify-worktree-deps: no root node_modules at all under '${worktree_dir}' - dependencies were never installed in this worktree"
  broken=1
fi

if [ "$broken" -eq 0 ]; then
  echo "verify-worktree-deps: '${worktree_dir}' dependency graph looks healthy"
  exit 0
fi

if [ ! -f "$env_file" ]; then
  echo "verify-worktree-deps: dependency graph is broken and no '${env_file}' exists to re-run - cannot self-heal, escalate" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "verify-worktree-deps: 'node' not found on PATH - cannot parse '${env_file}' to self-heal (this is the exact 'spawned processes don't inherit PATH' trap from the decision log; a silent exit here would read as broken code, so failing loudly with this message instead) - escalate" >&2
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
