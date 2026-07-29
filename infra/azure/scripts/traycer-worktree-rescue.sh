#!/bin/bash
# Recoverable-state safety net for A6's "an agent killed mid-task leaves
# recoverable state" requirement. Runs on every traycer-host@<tenant>
# failure (see traycer-host-failure-alert.sh) - snapshots any dirty git
# worktree under the tenant's HOME to a durable, reachable ref BEFORE the
# failure can compound (a restart, a later `git gc`, an operator poking
# around).
#
# NOT `git stash create` alone. That command builds a commit object and
# prints its SHA but writes no ref - the object is unreachable the moment
# this script exits and survives only until something prunes it (a `git
# gc` in the same worktree, `--prune=now`, ordinary reflog expiry). A
# safety net that reports success and holds nothing is the exact failure
# class A6 exists to prevent, so every snapshot here is immediately
# anchored with `git update-ref`, not left to `git stash store` alone.
# Written to a repo-owned namespace (`refs/traycer/rescue/...`), not
# `refs/stash`, so it cannot collide with or be silently popped by a
# human's own stash stack in the same worktree.
#
# NOT `git stash create --include-untracked` either - found live, not
# assumed: `create` (unlike `push`) does not actually implement that flag.
# It exits 0 and accepts the argument without error, but silently folds
# the literal text into the stash message instead of acting on it, so
# every untracked file - a brand new source file the agent never `git
# add`ed, exactly the mid-task state this ticket exists to protect -
# was captured by NOTHING. Caught by creating a real untracked file,
# rescuing it, and reading the resulting commit's tree, not by trusting
# the flag's name. Fixed with a scratch index (`GIT_INDEX_FILE`): `git
# add -A` against a temporary index captures tracked AND untracked state
# into a tree without ever touching the real working tree or the real
# index, then `commit-tree` + `update-ref` anchor it exactly as before.
set -euo pipefail

TENANT_ID="${1:?traycer-worktree-rescue.sh requires a tenant id as \$1}"
HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set}"
TENANT_HOME="${HOME_ROOT}/${TENANT_ID}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ ! -d "$TENANT_HOME" ]; then
  echo "traycer-worktree-rescue: no HOME directory for '${TENANT_ID}' - nothing to rescue" >&2
  exit 0
fi

rescued=0
# `.git` inside a worktree is a FILE pointing at the main repo's
# `.git/worktrees/<name>`, not a directory - `find ... -name .git` with no
# type filter catches both a real clone's `.git` dir and every worktree's
# `.git` file under this tenant's HOME.
while IFS= read -r -d '' git_marker; do
  worktree_dir="$(dirname "$git_marker")"
  # `|| status=$?` is load-bearing under `set -e`: a bare subshell
  # statement whose exit code is used deliberately (10 = rescued, not an
  # error) would otherwise abort this whole script the moment it returns
  # non-zero - `set -e` only exempts a command's exit status when it is
  # part of a tested construct (if/while/&&/||), and a standalone `( ... )`
  # is not one.
  status=0
  ( cd "$worktree_dir" && \
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      scratch_index="$(mktemp)"
      export GIT_INDEX_FILE="$scratch_index"
      trap 'rm -f "$scratch_index"' EXIT
      parent_args=()
      if git rev-parse -q --verify HEAD >/dev/null 2>&1; then
        git read-tree HEAD
        parent_args=(-p HEAD)
      fi
      # `-A`: stages tracked modifications AND untracked files alike, all
      # into the scratch index only - the real index/working tree are
      # never touched (GIT_INDEX_FILE redirects every index operation).
      git add -A
      tree="$(git write-tree)"
      sha="$(git commit-tree "$tree" "${parent_args[@]}" -m "traycer-rescue ${TIMESTAMP}")"
      unset GIT_INDEX_FILE
      rm -f "$scratch_index"
      trap - EXIT
      if [ -n "$sha" ]; then
        ref="refs/traycer/rescue/${TENANT_ID}/${TIMESTAMP}"
        git update-ref "$ref" "$sha"
        echo "traycer-worktree-rescue: snapshotted ${worktree_dir} -> ${ref} (${sha})"
        exit 10
      fi
    fi
  ) || status=$?
  case "$status" in
    10) rescued=$((rescued + 1)) ;;
    0) ;;
    *) echo "traycer-worktree-rescue: failed to inspect ${worktree_dir}" >&2 ;;
  esac
done < <(find "$TENANT_HOME" -name ".git" -print0 2>/dev/null)

echo "traycer-worktree-rescue: done - ${rescued} worktree(s) snapshotted for '${TENANT_ID}'"
