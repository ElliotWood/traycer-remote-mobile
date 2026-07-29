#!/bin/bash
# Mints (idempotently) the SSH deploy key the VM uses to reach ONE private
# GitHub repo, and pins github.com's host keys so the later clone can run
# with StrictHostKeyChecking=yes instead of blind TOFU.
#
# WHY A DEPLOY KEY AND NOT A PAT - the decision, not a preference:
#   * The private half is GENERATED ON THE VM and never leaves it. A PAT has
#     to be minted somewhere else and transported here, which means the
#     secret crosses at least one channel (chat, clipboard, a run-command
#     payload logged by the Azure agent under /var/lib/waagent). A deploy
#     key's secret has no transport step at all - only the PUBLIC half,
#     which is not a secret, is ever copied out.
#   * Scope. A fine-grained PAT is scoped to a user and a set of repos and
#     carries that user's identity; a deploy key is scoped to exactly one
#     repository and nothing else. Least privilege by construction rather
#     than by remembering to tick the right boxes.
#   * Expiry. Fine-grained PATs expire (max 1 year); a deploy key does not,
#     so the VM does not silently lose access on a date nobody wrote down.
# The cost, stated rather than hidden: a deploy key is PER-REPO. A second
# private repo needs a second key + a second registration. That is the
# right trade at one repo and should be revisited (probably toward a
# GitHub App installation token) if this grows past a handful.
#
# HUMAN-IN-THE-LOOP, deliberately: this script CANNOT finish the job. It
# prints a public key; somebody with admin on the repo must register it
# (`gh repo deploy-key add`). That is not a gap to automate away - it is the
# authorization boundary. The VM has no GitHub credential and should not be
# given one just so it can grant itself access.
#
# WHERE THE SECRET LIVES, and the honest limit of that:
#   ${SECRETS_DIR}/<key-name>, mode 0600, owned by the shared OS user.
#   NOT root-owned: the process that must read it (every tenant's Traycer
#   host, running as that shared user) is not root, so a root-owned 0600
#   file would simply not work. 0600-as-the-shared-user is the strongest
#   mode that still functions under this deployment's already-accepted
#   one-OS-user architecture - under which any tenant process can already
#   read any other tenant's ~/.traycer/cli/credentials. This key is exactly
#   as exposed as those already are; it introduces no new class of risk,
#   and it is NOT protected from a co-tenant agent. Said plainly because
#   "0600" reads as stronger than it is here.
#   It is outside every repo working tree, so it cannot be committed by an
#   agent doing `git add -A`.
set -euo pipefail

TRAYCER_OS_USER="${TRAYCER_OS_USER:-traycer}"
SECRETS_DIR="${SECRETS_DIR:-/srv/traycer/secrets}"

usage() {
  echo "usage: ensure-repo-deploy-key.sh <key-name>" >&2
  echo "  key-name  filename under ${SECRETS_DIR} (e.g. sensormine-v4-self-host)" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

key_name="$1"
case "$key_name" in
  */*|.*|"")
    echo "ensure-repo-deploy-key: key-name must be a bare filename, got '${key_name}'" >&2
    exit 1
    ;;
esac

[ "$(id -u)" -eq 0 ] || { echo "ensure-repo-deploy-key: must run as root (it chowns to ${TRAYCER_OS_USER})" >&2; exit 1; }
id -u "$TRAYCER_OS_USER" >/dev/null 2>&1 || { echo "ensure-repo-deploy-key: OS user '${TRAYCER_OS_USER}' does not exist" >&2; exit 1; }

key_path="${SECRETS_DIR}/${key_name}"
known_hosts="${SECRETS_DIR}/known_hosts"

install -d -m 0700 -o "$TRAYCER_OS_USER" -g "$TRAYCER_OS_USER" "$SECRETS_DIR"

if [ -f "$key_path" ]; then
  echo "ensure-repo-deploy-key: key already present at ${key_path} - not regenerating"
else
  echo "ensure-repo-deploy-key: generating ed25519 keypair at ${key_path}"
  # Generated AS the OS user, not as root-then-chown, so the private key
  # is never momentarily owned by root in a directory that user can list.
  sudo -u "$TRAYCER_OS_USER" ssh-keygen -t ed25519 -N '' \
    -C "traycer-vm-deploy-key:${key_name}" -f "$key_path" >/dev/null
fi
chown "$TRAYCER_OS_USER:$TRAYCER_OS_USER" "$key_path" "${key_path}.pub"
chmod 600 "$key_path"
chmod 644 "${key_path}.pub"

# --- github.com host keys -------------------------------------------------
#
# Pinned from GitHub's own meta API over TLS (a real trust anchor: the CA
# chain), NOT from `ssh-keyscan` alone (which is trust-on-first-use over an
# unauthenticated port-22 handshake - it would happily record an attacker's
# key). ssh-keyscan is then run anyway and its keys are checked to be a
# SUBSET of what the API published: that turns the scan from the source of
# truth into a detector for a port-22 MITM. If the two disagree, we stop.
echo "ensure-repo-deploy-key: pinning github.com host keys from https://api.github.com/meta"
meta_json="$(mktemp)"
api_keys="$(mktemp)"
scan_keys="$(mktemp)"
trap 'rm -f "$meta_json" "$api_keys" "$scan_keys"' EXIT

curl -fsSL --retry 3 https://api.github.com/meta -o "$meta_json"
python3 - "$meta_json" > "$api_keys" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    keys = json.load(fh)["ssh_keys"]
if not keys:
    raise SystemExit("api.github.com/meta returned no ssh_keys")
for k in keys:
    print(k.strip())
PY

# Second channel: what port 22 actually offers right now.
ssh-keyscan -T 10 github.com 2>/dev/null | sed 's/^github\.com //' | sort -u > "$scan_keys"
[ -s "$scan_keys" ] || { echo "ensure-repo-deploy-key: ssh-keyscan returned nothing for github.com" >&2; exit 1; }

while read -r offered; do
  [ -n "$offered" ] || continue
  if ! grep -qxF "$offered" "$api_keys"; then
    echo "ensure-repo-deploy-key: REFUSING - github.com offered a host key over port 22 that api.github.com/meta does not publish." >&2
    echo "  offered: ${offered}" >&2
    echo "  This is what a port-22 man-in-the-middle looks like. Investigate before retrying." >&2
    exit 1
  fi
done < "$scan_keys"

umask 022
{
  echo "# github.com host keys, pinned from https://api.github.com/meta by ensure-repo-deploy-key.sh."
  echo "# Cross-checked against ssh-keyscan at write time. Regenerate by re-running that script."
  while read -r k; do
    [ -n "$k" ] && echo "github.com ${k}"
  done < "$api_keys"
} > "$known_hosts"
chown "$TRAYCER_OS_USER:$TRAYCER_OS_USER" "$known_hosts"
echo "ensure-repo-deploy-key: wrote $(grep -c '^github.com ' "$known_hosts") pinned host key(s) to ${known_hosts}"

echo
echo "=== NEXT STEP - a human with admin on the target repo must register this ==="
echo "Save the public key below to a file, then:"
echo "  gh repo deploy-key add <file> --title traycer-azure-vm --allow-write --repo <owner>/<repo>"
echo "--allow-write is required: agents on this VM push branches, not just read."
echo
echo "PUBLIC KEY (not a secret - safe to paste anywhere):"
cat "${key_path}.pub"
