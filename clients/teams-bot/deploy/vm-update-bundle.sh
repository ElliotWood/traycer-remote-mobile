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
# A string present in the NEW build and absent from the old one. Passed in so
# the check is specific to the change being deployed rather than a generic
# "file exists" that would pass against the previous bundle.
NEW_BUILD_MARKER="${NEW_BUILD_MARKER:?NEW_BUILD_MARKER is required}"

cd "$BOT_DIR"
echo "=== before ==="
stat -c '%n %y %U:%G %s' bot.cjs 2>/dev/null || echo "bot.cjs absent"
echo "marker before: $(grep -c "$NEW_BUILD_MARKER" bot.cjs 2>/dev/null || echo 0)"

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
echo "marker after: $(grep -c "$NEW_BUILD_MARKER" bot.cjs)"
echo "untouched: $(stat -c '%n %U:%G %a' secret.env identity-registry.json 2>/dev/null | tr '\n' ' ')"
echo "unit active: $(systemctl is-active traycer-teams-bot.service)"
echo "healthz: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3978/healthz)"
journalctl -u traycer-teams-bot.service -n 8 --no-pager | tail -8
