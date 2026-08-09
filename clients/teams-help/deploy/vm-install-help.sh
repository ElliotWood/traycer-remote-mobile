#!/bin/sh
# Install the static Help tab at /var/www/traycer/help/.
#
# NO NGINX CHANGE. This is the whole point of the path chosen.
#
# bootstrap.sh's vhost ends with a catch-all:
#
#     location / { root /var/www/traycer; try_files $uri $uri/ =404; }
#
# so a directory at /var/www/traycer/help/ is already served at /help/. No
# drop-in under traycer-locations.d/, no `nginx -t`, no reload, and — unlike
# /tab/, /api/messages and /push/ — nothing for compare-vm-state.mjs to
# report as LOCATIONS drift, because there is no new location. It also means
# a rebuilt VM loses only the CONTENT, not the route, and re-running this one
# script restores it.
#
# Run via:
#   az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript \
#     --scripts @clients/teams-help/deploy/vm-install-help.sh \
#     --query "value[0].message" -o tsv
#
# `--scripts @file` and never an inlined body: that path re-parses through
# cmd.exe on Windows, which caps at 8191 characters and silently drops
# non-ASCII.

# `set -eu` ONLY — never `-o pipefail`.
#
# run-command executes this through /bin/sh, which is dash on this image, and
# dash aborts at line 1 with "Illegal option -o pipefail". The deploy then
# produces empty stdout and looks like it ran.
set -eu

REPO_URL="https://github.com/ElliotWood/traycer-remote-mobile.git"
DIST_BRANCH="demo/help-dist"
DIST_DIR="/srv/traycer/help-dist"
ROOT="/var/www/traycer/help"

echo "== help tab install =="

# --- fetch the content --------------------------------------------------

# `git -c safe.directory=` on EVERY invocation rather than `git config
# --global` once: run-command runs as root with no $HOME, so the global form
# dies with "fatal: $HOME not set". Chowning the tree instead just moves the
# problem to an ownership trap the next deploy has to unpick.
GIT="git -c safe.directory=$DIST_DIR -C $DIST_DIR"

if [ ! -d "$DIST_DIR/.git" ]; then
  echo "-- cloning $DIST_BRANCH"
  mkdir -p "$(dirname "$DIST_DIR")"
  rm -rf "$DIST_DIR"
  git clone -q --depth 1 --branch "$DIST_BRANCH" "$REPO_URL" "$DIST_DIR"
else
  echo "-- fetching $DIST_BRANCH"
  $GIT fetch -q --depth 1 origin "$DIST_BRANCH"
  $GIT reset -q --hard FETCH_HEAD
  # The dist branch is force-pushed, so deleted files must actually go.
  $GIT clean -qfd
fi

echo "-- dist head: $($GIT rev-parse --short HEAD)"

# --- sanity-check BEFORE touching the live directory --------------------

# A dist branch that fetched cleanly but carries the wrong tree would
# otherwise be discovered only after the swap, with the old page gone.
if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "FAIL: $DIST_BRANCH has no index.html at its root" >&2
  exit 1
fi

# --- stage, then swap ---------------------------------------------------

# Stage-then-swap, never empty-then-fill.
#
# az vm run-command has been observed executing only PART of a script on this
# box. If the destructive step were `rm -rf $ROOT` followed by a copy, a
# truncated run leaves the help tab as a 404 with no way to tell from the
# exit status. Here the only destructive moment is a rename, which is atomic:
# either the old tree or the new one is at $ROOT, never neither.
STAGE="$ROOT.new.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Copy the tracked files explicitly rather than `cp -r "$DIST_DIR"/*`, so a
# stray file on the dist branch — a README, an editor backup — cannot end up
# served from a public origin.
for f in index.html styles.css theme.css help.js; do
  if [ ! -f "$DIST_DIR/$f" ]; then
    echo "FAIL: $DIST_BRANCH is missing $f" >&2
    rm -rf "$STAGE"
    exit 1
  fi
  cp "$DIST_DIR/$f" "$STAGE/$f"
done

mkdir -p "$(dirname "$ROOT")"

OLD="$ROOT.old.$$"
if [ -d "$ROOT" ]; then
  mv "$ROOT" "$OLD"
fi
mv "$STAGE" "$ROOT"
rm -rf "$OLD"

# nginx runs as www-data and cannot read root-only files.
chmod -R a+rX "$ROOT"

echo "-- installed:"
ls -la "$ROOT"

# --- verify from the box ------------------------------------------------

# Loopback rather than the public FQDN: this proves nginx resolves the path
# and serves the right CONTENT TYPE. A status code alone is not enough —
# under a `try_files` fallback a wrong path can still return 200 with HTML
# where a stylesheet was expected, which is how a blank deployed tab has
# gone unnoticed here before.
echo "-- local verify"
for path in /help/ /help/styles.css /help/help.js; do
  code_type=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' \
    --resolve "localhost:443:127.0.0.1" -k "https://localhost$path" || echo "ERR")
  echo "   $path -> $code_type"
done

echo "== done =="
echo "Now verify OFF-BOX (this script cannot prove public reachability):"
echo "  curl -sS -o /dev/null -w '%{http_code} %{content_type}\\n' https://<FQDN>/help/"
