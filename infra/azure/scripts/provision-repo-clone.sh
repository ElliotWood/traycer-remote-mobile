#!/bin/bash
# Clones ONE private GitHub repo into the shared-clone location every
# tenant's Traycer host process creates worktrees from, using the deploy key
# `ensure-repo-deploy-key.sh` minted, and then PROVES the result rather than
# asserting it.
#
# LAYOUT AUTHORITY - this script does not invent a path. A4
# (`docs/deployment/azure-repo-worktree-layout.md` on branch
# `traycer-azure-repo-layout`) finalized the shared clone at
# `/srv/traycer/repo/<owner>/<repo>`: ONE clone, deliberately NOT under any
# identity's HOME, because per-identity isolation already comes free from
# each host process's own `HOME` -> `~/.traycer/worktrees/`. That doc also
# records the path as IMMOVABLE once worktrees exist: every linked worktree
# stores it as an absolute path in its own `.git` admin file, so moving it
# later means `git worktree repair` across every tenant's checkout.
#
# RELATIONSHIP TO A4's OWN `scripts/azure/provision-shared-repo.sh`: that
# script is the generic HTTPS-or-whatever cloner for the same path; this one
# is the deployment-side wiring that supplies the SSH credential, pins the
# host keys, runs as the right OS user, and verifies. They are on different
# branches today. When `traycer-azure-repo-layout` merges, fold this
# script's credential/ownership/verification steps into that one rather than
# keeping two cloners - noted here so the duplication is a tracked decision,
# not an accident.
set -euo pipefail

# Leave whatever directory the caller was in before dropping privileges.
# `sudo` inherits the parent's cwd, and this script's normal caller is
# `az vm run-command`, which runs from /var/lib/waagent/run-command/download
# /<n> - a root-only directory. Every `sudo -u traycer git ...` below would
# otherwise die with "failed to stat ... Permission denied" BEFORE git ever
# contacts the remote, which reads exactly like an auth failure and is not
# one. Found the hard way: the pre-registration negative test failed with
# that message instead of the GitHub error it was written to prove.
cd /

TRAYCER_OS_USER="${TRAYCER_OS_USER:-traycer}"
TRAYCER_HOME_ROOT="${TRAYCER_HOME_ROOT:-/srv/traycer/tenants}"
SECRETS_DIR="${SECRETS_DIR:-/srv/traycer/secrets}"
REPO_ROOT="${REPO_ROOT:-/srv/traycer/repo}"

usage() {
  echo "usage: provision-repo-clone.sh <owner> <repo> <branch> <key-name>" >&2
  echo "  owner/repo  GitHub coordinates; also the path under ${REPO_ROOT}" >&2
  echo "  branch      branch to check out" >&2
  echo "  key-name    deploy key filename under ${SECRETS_DIR}" >&2
}

if [ "$#" -ne 4 ]; then
  usage
  exit 2
fi

owner="$1"; repo="$2"; branch="$3"; key_name="$4"

# Every one of these lands in a path or a git ref. Reject the shapes that
# would escape the intended directory or be eaten as a flag by git's own
# argument parser (a branch named `-D` is not hypothetical - it deletes a
# branch and reports failure; see the A4 contract's B1 finding).
for v in "$owner" "$repo" "$key_name"; do
  case "$v" in
    ''|*/*|.*|-*) echo "provision-repo-clone: invalid segment '${v}' - no empty, no '/', no leading '.' or '-'" >&2; exit 1 ;;
  esac
done
case "$branch" in
  ''|-*) echo "provision-repo-clone: invalid branch '${branch}' - must be non-empty and must not start with '-'" >&2; exit 1 ;;
esac

[ "$(id -u)" -eq 0 ] || { echo "provision-repo-clone: must run as root (it creates ${REPO_ROOT} and drops to ${TRAYCER_OS_USER})" >&2; exit 1; }
id -u "$TRAYCER_OS_USER" >/dev/null 2>&1 || { echo "provision-repo-clone: OS user '${TRAYCER_OS_USER}' does not exist" >&2; exit 1; }

key_path="${SECRETS_DIR}/${key_name}"
known_hosts="${SECRETS_DIR}/known_hosts"
clone_dir="${REPO_ROOT}/${owner}/${repo}"
remote_url="git@github.com:${owner}/${repo}.git"

[ -f "$key_path" ]    || { echo "provision-repo-clone: no deploy key at ${key_path} - run ensure-repo-deploy-key.sh ${key_name} first" >&2; exit 1; }
[ -f "$known_hosts" ] || { echo "provision-repo-clone: no pinned host keys at ${known_hosts} - run ensure-repo-deploy-key.sh first" >&2; exit 1; }

# IdentitiesOnly=yes: without it ssh offers every key an agent knows before
# this one and can trip GitHub's auth-attempt limit. StrictHostKeyChecking
# =yes (not `accept-new`): the host keys are already pinned, so an unknown
# key here is a failure, never a prompt-free acceptance.
ssh_cmd="ssh -i ${key_path} -o IdentitiesOnly=yes -o UserKnownHostsFile=${known_hosts} -o StrictHostKeyChecking=yes -o BatchMode=yes"

as_user() {
  sudo -u "$TRAYCER_OS_USER" env \
    HOME="$TRAYCER_HOME_ROOT" \
    GIT_SSH_COMMAND="$ssh_cmd" \
    GIT_TERMINAL_PROMPT=0 \
    "$@"
}

# Gate on a call that CANNOT succeed without real access to this specific
# private repo. `ssh -T git@github.com` is not that check: it reports a
# happy "successfully authenticated" for a key registered anywhere, and a
# deploy key with read-only scope passes it too.
echo "provision-repo-clone: probing read access to ${remote_url}"
if ! probe="$(as_user git ls-remote --heads "$remote_url" "$branch" 2>&1)"; then
  echo "provision-repo-clone: cannot reach ${remote_url} with the deploy key." >&2
  echo "  Most likely the public key has not been registered on the repo yet:" >&2
  echo "    gh repo deploy-key add ${key_path}.pub --title traycer-azure-vm --allow-write --repo ${owner}/${repo}" >&2
  echo "  git said:" >&2
  echo "$probe" | awk '{print "    " $0}' >&2
  exit 1
fi
# Match the ref EXACTLY. `ls-remote --heads <pattern>` matches on a
# trailing path component, so a sibling branch ending in the same segments
# would also come back and leave two shas in $probe - which would then be
# compared against one HEAD sha and fail confusingly.
remote_sha="$(echo "$probe" | awk -v r="refs/heads/${branch}" '$2 == r {print $1}')"
if [ -z "$remote_sha" ]; then
  echo "provision-repo-clone: repo is reachable but has no branch named '${branch}'" >&2
  as_user git ls-remote --heads "$remote_url" | sed 's/^/    /' >&2
  exit 1
fi
echo "provision-repo-clone: remote has ${branch} at ${remote_sha}"

install -d -m 0755 -o "$TRAYCER_OS_USER" -g "$TRAYCER_OS_USER" "$REPO_ROOT" "${REPO_ROOT}/${owner}"

if [ -d "${clone_dir}/.git" ]; then
  echo "provision-repo-clone: ${clone_dir} already a checkout - verifying origin instead of re-cloning"
  existing="$(as_user git -C "$clone_dir" remote get-url origin 2>/dev/null || true)"
  if [ "$existing" != "$remote_url" ]; then
    echo "provision-repo-clone: existing origin '${existing}' != requested '${remote_url}' - refusing to touch it" >&2
    exit 1
  fi
elif [ -e "$clone_dir" ]; then
  echo "provision-repo-clone: ${clone_dir} exists and is not a git checkout - refusing to overwrite" >&2
  exit 1
else
  echo "provision-repo-clone: cloning ${remote_url} -> ${clone_dir}"
  as_user git clone --branch "$branch" "$remote_url" "$clone_dir"
fi

# Persist the credential wiring INTO the clone, so every later `git fetch`/
# `git push` - including from a linked worktree created by a Traycer host
# process, which shares this config - works with no environment set up by
# the caller. This is why the clone is usable by agents and not just by
# this script.
as_user git -C "$clone_dir" config core.sshCommand "$ssh_cmd"

# Checkout is separate from clone so a pre-existing clone on the wrong
# branch converges too, rather than being reported fine because `clone
# --branch` happened to be right the one time it ran.
as_user git -C "$clone_dir" fetch origin "$branch"
as_user git -C "$clone_dir" checkout -B "$branch" "origin/${branch}"

# --- verification --------------------------------------------------------
# Each check below reads a value back off disk and compares it. None of them
# can pass while the thing they describe is missing.
echo
echo "=== VERIFY ==="
fail=0
check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok    $1: $3"
  else
    echo "  FAIL  $1: expected '$2', got '$3'"
    fail=1
  fi
}

check "branch" "$branch" "$(as_user git -C "$clone_dir" rev-parse --abbrev-ref HEAD)"
check "owner:group" "${TRAYCER_OS_USER}:${TRAYCER_OS_USER}" "$(stat -c '%U:%G' "$clone_dir")"
check "origin" "$remote_url" "$(as_user git -C "$clone_dir" remote get-url origin)"

head_sha="$(as_user git -C "$clone_dir" rev-parse HEAD)"
check "HEAD == remote ${branch}" "$remote_sha" "$head_sha"

dirty="$(as_user git -C "$clone_dir" status --porcelain | wc -l)"
check "uncommitted files" "0" "$dirty"

# Root-owned strays would make the tree unwritable for the host process in
# exactly the places it needs to write. Count them; zero is the only pass.
strays="$(find "$clone_dir" ! -user "$TRAYCER_OS_USER" -printf '.' 2>/dev/null | wc -c)"
check "paths not owned by ${TRAYCER_OS_USER}" "0" "$strays"

# Writability, actually exercised rather than inferred from mode bits.
probe_file="${clone_dir}/.provision-write-probe"
if as_user touch "$probe_file" 2>/dev/null && as_user rm -f "$probe_file" 2>/dev/null; then
  echo "  ok    ${TRAYCER_OS_USER} can create+delete a file in the worktree"
else
  echo "  FAIL  ${TRAYCER_OS_USER} cannot write inside ${clone_dir}"
  fail=1
fi

tracked="$(as_user git -C "$clone_dir" ls-files | wc -l)"
if [ "$tracked" -gt 0 ]; then
  echo "  ok    tracked files: ${tracked}"
else
  echo "  FAIL  tracked files: 0 - the clone is empty"
  fail=1
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "provision-repo-clone: VERIFICATION FAILED for ${clone_dir}" >&2
  exit 1
fi
echo "provision-repo-clone: ${clone_dir} @ ${branch} ${head_sha} - verified"
