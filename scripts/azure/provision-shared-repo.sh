#!/usr/bin/env bash
# One-time setup of the shared clone every identity's Traycer host process
# points its worktree.create/worktree.import calls at.
#
# IDEMPOTENCY, qualified rather than asserted flatly: re-running with the
# IDENTICAL clone-dir + remote-url arguments is a no-op on a target where
# `git remote get-url` echoes back exactly the string that was passed to
# `git clone` (true on Linux - no path re-representation happens). It is
# NOT reliably idempotent on Windows/git-bash, where a POSIX-style path
# passed to `git clone` can be echoed back drive-lettered by `git remote
# get-url`, making an identical second invocation look like a mismatched
# remote and refuse. Verified both ways - see provision-shared-repo.test.sh,
# which asserts idempotency on POSIX and documents+skips (not silently
# passes) the known Windows limitation with a stated reason. This has NOT
# been verified against a real Linux target by this suite (only reasoned
# about, per criterion 6) - re-run the test there before relying on it.
#
# There is exactly ONE of these per repo, deliberately not per-identity: the
# whole point of the design is that source is shared and only the worktree
# root (already given for free by A1's per-identity HOME -> ~/.traycer) is
# per-identity. See the A4 layout doc for the full rationale.
#
# IMMOVABLE ONCE CHOSEN: every linked worktree's admin file
# (<worktree>/.git) stores this clone's path as an ABSOLUTE path
# (`gitdir: <this-path>/.git/worktrees/<name>`). Moving the shared clone
# after worktrees exist requires `git worktree repair` run against every
# single tenant's worktree - treat CLONE_DIR as a final decision, not a
# config value to be revisited casually.
set -euo pipefail

# Source branch-namespace.sh for the single definition of RESERVED_PREFIX,
# rather than a second copy here that only looks synchronized. Sourcing is
# safe: it only defines functions/readonly vars when sourced (the file's
# own CLI-invocation guard checks BASH_SOURCE[0] == $0, which is false when
# sourced from another script).
# shellcheck source=./branch-namespace.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/branch-namespace.sh"

usage() {
  echo "usage: provision-shared-repo.sh <clone-dir> <remote-url> [<default-branch>]" >&2
  echo "  clone-dir       absolute path for the ONE shared clone (e.g. /srv/traycer/repo/<owner>/<repo>)" >&2
  echo "  remote-url      git remote to clone/verify against" >&2
  echo "  default-branch  defaults to the remote's HEAD if omitted" >&2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage
  exit 2
fi

clone_dir="$1"
remote_url="$2"
default_branch="${3:-}"

case "$clone_dir" in
  /*) : ;;
  *)
    echo "provision-shared-repo: clone-dir must be an absolute path (got '${clone_dir}') - it is baked into every worktree's admin file, so a relative or ambiguous path here is a bug waiting to surface later" >&2
    exit 1
    ;;
esac

if [ -d "$clone_dir/.git" ]; then
  echo "provision-shared-repo: '${clone_dir}' already looks like a git checkout - verifying remote instead of re-cloning"
  existing_url="$(git -C "$clone_dir" remote get-url origin 2>/dev/null || true)"
  if [ "$existing_url" != "$remote_url" ]; then
    echo "provision-shared-repo: existing clone's origin ('${existing_url}') does not match the requested remote ('${remote_url}') - refusing to touch it" >&2
    exit 1
  fi
  echo "provision-shared-repo: origin matches - nothing to do"
  exit 0
fi

if [ -e "$clone_dir" ]; then
  echo "provision-shared-repo: '${clone_dir}' exists and is not a git checkout - refusing to overwrite" >&2
  exit 1
fi

mkdir -p "$(dirname "$clone_dir")"

if [ -n "$default_branch" ]; then
  git clone --branch "$default_branch" "$remote_url" "$clone_dir"
else
  git clone "$remote_url" "$clone_dir"
fi

# This is a WARNING, not an enforcement - nothing below makes a flat `u`
# branch impossible to create; it only tells the operator not to. A git hook
# can't close this gap either: `git worktree add -b` performs a LOCAL ref
# update, which does not invoke update/pre-receive hooks (those fire on
# receive-pack only), so a hook here would give false confidence rather than
# real protection. The actual (partial) protection is branch-namespace.sh's
# own pre-flight `git show-ref` check, run at worktree-creation time, not
# here at provisioning time.
echo "provision-shared-repo: ready at '${clone_dir}' (origin '${remote_url}')"
echo "provision-shared-repo: reminder - do not create a flat branch named '${RESERVED_PREFIX}' or '${RESERVED_PREFIX}/<identity>' in this clone; it will permanently block that identity's worktree namespace (see branch-namespace.sh)"
