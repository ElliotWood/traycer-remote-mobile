#!/usr/bin/env bash
# Replaces ONLY the two bundles and restarts. Deliberately narrower than
# `vm-deploy.sh`, which also rewrites the systemd unit and
# `identity-registry.json`.
#
# Why a second script rather than re-running the full deploy: the unit and the
# registry are already correct on this VM, and rewriting them requires passing
# every identifier (app id, tenant id, a person's Entra object id) through the
# invocation again. Not re-supplying them is one fewer chance to mistype one,
# and one fewer chance for a secret to end up somewhere it shouldn't. This
# script never touches `secret.env`, never re-chowns anything outside the two
# files it replaces, and needs no identifiers at all.
#
# Use `vm-deploy.sh` when the unit itself changes; use this for a code update.
set -euo pipefail

BOT_DIR="${BOT_DIR:-/srv/traycer/teams-bot}"
BUNDLE_BRANCH="${BUNDLE_BRANCH:-demo/teams-bot-bundle}"
BUNDLE_REPO="${BUNDLE_REPO:?BUNDLE_REPO is required}"
# sha256 of the bot.cjs the CALLER built. This is the verification, and it is
# a hash rather than a string search on purpose.
#
# The first version of this script took a NEW_BUILD_MARKER string to grep
# for. That works exactly once. On the second deploy the marker was a string
# both builds contained, so it read "1 before, 1 after" and proved nothing —
# a check that could not fail, which is the failure this whole project keeps
# tripping over. A hash cannot be accidentally satisfied by the previous
# build, and it verifies every byte rather than one line.
EXPECTED_BOT_SHA256="${EXPECTED_BOT_SHA256:?EXPECTED_BOT_SHA256 is required (sha256sum of the bot.cjs you built)}"

cd "$BOT_DIR"
echo "=== before ==="
stat -c '%n %y %U:%G %s' bot.cjs 2>/dev/null || echo "bot.cjs absent"
echo "sha before: $(sha256sum bot.cjs 2>/dev/null | cut -c1-16 || echo none)"

# `az vm run-command` executes as root with NO `$HOME`, and the bundle
# checkout is traycer-owned, so git refuses it as "dubious ownership". Two
# things follow:
#
#   - `git config --global` cannot be used at all — it needs a home directory
#     and dies with "fatal: $HOME not set".
#   - chowning the checkout to root would "fix" it and re-create the exact
#     ownership trap that already cost hours here.
#
# So the exception is passed PER INVOCATION with `-c`, which touches no config
# file, needs no home, and leaves ownership alone.
GIT="git -c safe.directory=$BOT_DIR/src"

if [ -d src/.git ]; then
  $GIT -C src fetch -q origin "$BUNDLE_BRANCH"
  $GIT -C src reset -q --hard FETCH_HEAD
else
  $GIT clone -q --depth 1 --branch "$BUNDLE_BRANCH" "$BUNDLE_REPO" src
fi

cp src/bot.cjs "$BOT_DIR/bot.cjs"
# Name is load-bearing: the bridge CLI guards its entrypoint on
# basename(argv[1]), and under any other filename commander never parses and
# the process exits silently with status 0.
cp src/traycer-remote-bridge "$BOT_DIR/traycer-remote-bridge"
chmod +x "$BOT_DIR/traycer-remote-bridge"

# Only the two replaced files — NOT `chown -R`, which would sweep up
# `secret.env` and `identity-registry.json` unnecessarily. They are already
# traycer-owned at mode 600 and this script has no business touching them.
chown traycer:traycer "$BOT_DIR/bot.cjs" "$BOT_DIR/traycer-remote-bridge"

systemctl restart traycer-teams-bot.service
sleep 4

echo "=== after ==="
stat -c '%n %y %U:%G %s' bot.cjs traycer-remote-bridge
ACTUAL_SHA="$(sha256sum bot.cjs | cut -d' ' -f1)"
echo "sha after:  $(echo "$ACTUAL_SHA" | cut -c1-16)"
echo "untouched: $(stat -c '%n %U:%G %a' secret.env identity-registry.json 2>/dev/null | tr '\n' ' ')"
echo "unit active: $(systemctl is-active traycer-teams-bot.service)"
echo "healthz: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3978/healthz)"
journalctl -u traycer-teams-bot.service -n 8 --no-pager | tail -8

# Last, and FATAL. Deliberately after the service report so a mismatch still
# shows what state the box is in, and deliberately non-zero so a caller that
# only checks the exit code still learns the truth.
if [ "$ACTUAL_SHA" != "$EXPECTED_BOT_SHA256" ]; then
  echo "DEPLOY VERIFY FAILED: deployed bot.cjs is not the build you asked for" >&2
  echo "  expected $EXPECTED_BOT_SHA256" >&2
  echo "  actual   $ACTUAL_SHA" >&2
  exit 1
fi
echo "verified: deployed bot.cjs is byte-identical to the build you supplied"
