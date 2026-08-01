#!/usr/bin/env bash
# Installs the built tab from the `demo/teams-tab-dist` branch into the web
# root, substituting deployment config on the way in.
#
# WHY THE SUBSTITUTION STEP EXISTS. DO NOT REMOVE IT.
#
# The tab's config is build-time (`import.meta.env.VITE_*`), so a deployable
# bundle contains the host id and the FQDN as string literals. The dist branch
# is PUSHED TO A PUBLIC REPO. For a long time that meant the host id — a
# machine identifier, the same value we scrub from source — was published in a
# built artifact, invisible to `scripts/oss-hygiene.sh`, which scans tracked
# source in a worktree and cannot see a bundle on another branch.
#
# So the branch now carries `__TRAYCER_HOST_ID__` / `__TRAYCER_HOST_FQDN__` and
# this script fills them in after checkout. Removing the step republishes a
# machine identifier the next time anyone builds and pushes.
#
# The host id is read from the host's OWN `pid.json` rather than passed in, so
# it never appears in a command line, a shell history, or an
# `az vm run-command` payload — that payload is written to disk under
# `/var/lib/waagent/run-command/` and is the reason nothing secret is ever
# passed as an argument here.
#
# Asset filenames are content-hashed at BUILD time, so substituting afterwards
# does not invalidate the `index.html` reference. That is the property that
# makes this cheap enough to be the permanent path.
#
# Usage: TAB_FQDN=<host fqdn> vm-install-tab.sh
# `set -e -u` only, NOT `-o pipefail`. `az vm run-command` executes this with
# /bin/sh, which on this VM is dash, and `pipefail` is a bashism that aborts
# the whole script at line 1 with "Illegal option". The shebang says bash and
# is honoured when run directly; it is ignored when the runner invokes sh, and
# the deploy path is the one that matters.
set -eu

DIST_DIR="${DIST_DIR:-/srv/traycer/tab-dist}"
ROOT="${ROOT:-/var/www/traycer-tab}"
PID_JSON="${PID_JSON:?PID_JSON is required - path to the host pid.json}"
# Not defaulted, and deliberately not in this file: the FQDN is a deployment
# fact and this file is committed to an open-source repo.
TAB_FQDN="${TAB_FQDN:?TAB_FQDN is required}"

# `az vm run-command` runs as root with no $HOME and the checkout is
# traycer-owned, so git refuses it as dubious ownership. Passed per-invocation
# with `-c` rather than `--global`, which needs a home directory, and rather
# than chowning, which re-creates an ownership trap that has already cost hours.
GIT="git -c safe.directory=$DIST_DIR -C $DIST_DIR"

$GIT fetch -q origin demo/teams-tab-dist
$GIT reset -q --hard FETCH_HEAD
echo "fetched: $($GIT rev-parse --short HEAD)"

HOST_ID="$(sed -n 's/.*"hostId"[: ]*"\([^"]*\)".*/\1/p' "$PID_JSON" | head -1)"
if [ "${#HOST_ID}" -ne 36 ]; then
  echo "REFUSING: hostId from $PID_JSON is not a 36-char GUID (got ${#HOST_ID} chars)" >&2
  exit 1
fi

for f in $(grep -rl __TRAYCER_HOST_ "$DIST_DIR/assets" "$DIST_DIR/index.html"); do
  sed -i "s|__TRAYCER_HOST_ID__|$HOST_ID|g; s|__TRAYCER_HOST_FQDN__|$TAB_FQDN|g" "$f"
done

# FAIL LOUD rather than serving a tab that dials `__TRAYCER_HOST_FQDN__`.
LEFT="$(grep -rl __TRAYCER_HOST_ "$DIST_DIR/assets" "$DIST_DIR/index.html" 2>/dev/null | wc -l)"
if [ "$LEFT" -ne 0 ]; then
  echo "REFUSING: $LEFT file(s) still contain placeholders after substitution" >&2
  exit 1
fi

# STAGE THEN SWAP, never empty-then-fill.
#
# The first version of this deleted the web root and then copied. A partial
# run — and `az vm run-command` has silently executed only part of a script
# here — would have left the tab GONE with a success status attached. Building
# the new root beside the live one means the only destructive moment is a
# rename that either happens or doesn't.
STAGE="$ROOT.new.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$DIST_DIR/assets" "$DIST_DIR/index.html" "$STAGE/"
OLD="$ROOT.old.$$"
if [ -d "$ROOT" ]; then mv "$ROOT" "$OLD"; fi
mv "$STAGE" "$ROOT"
rm -rf "$OLD"

echo "installed: $(ls "$ROOT/assets" | wc -l) assets"

# Verify the SERVED artifact, not the files. A bundle built with the wrong
# base still returns 200 — `/assets/…` falls through to the PWA's `location /`
# and nginx serves index.html. The CONTENT-TYPE is the discriminator: HTML
# where JavaScript was expected.
ASSET="$(grep -o '/tab/assets/index-[A-Za-z0-9_-]*\.js' "$ROOT/index.html" | head -1)"
CTYPE="$(curl -s -o /dev/null -w '%{content_type}' -k "https://localhost$ASSET")"
echo "asset:      $ASSET"
echo "tab:        $(curl -s -o /dev/null -w '%{http_code}' -k https://localhost/tab/)"
echo "deep link:  $(curl -s -o /dev/null -w '%{http_code}' -k https://localhost/tab/epics)"
echo "asset type: $CTYPE"
case "$CTYPE" in
  application/javascript*|text/javascript*) ;;
  *) echo "DEPLOY VERIFY FAILED: asset served as '$CTYPE' — the bundle's base path does not match the nginx prefix" >&2; exit 1 ;;
esac
echo "verified: the served bundle is JavaScript, not the SPA fallback"
