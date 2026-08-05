#!/usr/bin/env bash
# Serves the Teams static tab at /tab/ on the existing nginx vhost.
#
# The PWA already owns `/`, so the tab gets its own prefix rather than a
# second server block — one vhost, one certificate, one `validDomains` entry
# in the Teams manifest.
#
# ─── Why this writes a DROP-IN and no longer splices the vhost ───
#
# It used to `awk` its location block into /etc/nginx/sites-enabled/traycer.
# That file is REGENERATED WHOLESALE by infra/azure/scripts/bootstrap.sh —
# a `cat > … <<'TRAYCER_NGINX_TLS_EOF'` heredoc. So every in-place edit to it
# is erased by the next bootstrap run or VM rebuild, silently, and the Teams
# tab 404s with nothing in any diff to explain why. Measured 2026-08-04: the
# live VM's customData is unchanged since 2026-07-29 and `infra/` contains
# exactly one mention of Teams — a comment in main.bicep saying Teams is out
# of scope. Nothing in the IaC knows this route exists.
#
# So the route moves somewhere bootstrap.sh does not overwrite, and the vhost
# gains one generic line that pulls the directory in:
#
#     include /etc/nginx/traycer-locations.d/*.conf;
#
# The include is GENERIC on purpose. bootstrap.sh stays Teams-agnostic — no
# 3978, no /var/www/traycer-tab — which is what main.bicep's own scope comment
# says it should be, while the routes it must not clobber live in files it
# does not generate.
#
# ─── Why this script ensures the include itself ───
#
# It inserts the include if the vhost lacks it, rather than depending on
# bootstrap.sh already carrying it. Otherwise the fix is the outage: writing a
# drop-in that nginx never reads takes /tab/ down on the CURRENT live box,
# whose vhost has no include line. Self-healing here means this script is
# correct standalone, and bootstrap.sh's copy of the line is a convergence
# nicety rather than a prerequisite.
#
# ─── Why the same 20 lines are duplicated in the bot's script ───
#
# These run through `az vm run-command invoke`, which delivers ONE inlined
# script. There is no second file to source, so a shared helper cannot exist.
# The duplication is the delivery mechanism's, not a choice — see
# clients/teams-bot/deploy/vm-bot-ingress.sh, which is deliberately its twin.
#
# ─── Grandfathering ───
#
# On a box whose vhost still carries the OLD spliced `location /tab/`, this
# script leaves it alone: two live `location /tab/` blocks are a duplicate
# and `nginx -t` would reject the pair. The spliced block keeps working until
# bootstrap regenerates the vhost — which is the exact event this defends
# against, and at that point the drop-in is what survives.
set -euo pipefail

SITE=/etc/nginx/sites-enabled/traycer
DROPIN_DIR=/etc/nginx/traycer-locations.d
DROPIN="$DROPIN_DIR/teams-tab.conf"
ROOT=/var/www/traycer-tab

mkdir -p "$ROOT" "$DROPIN_DIR"

changed=0

# --- 1. the include line ---------------------------------------------------
#
# Inserted before the FIRST `location / {`, which is the TLS server block's
# catch-all; `ins` guards against also matching the port-80 redirect block's
# own `location /`. `awk` rather than `sed`: the inserted text contains `/`
# and `#`, which collide with every convenient sed delimiter (learned the
# hard way, twice, in this directory's history).
if grep -q 'traycer-locations.d' "$SITE"; then
  echo "nginx: drop-in include already present"
else
  # Backup goes OUTSIDE sites-enabled. nginx globs that directory, so a
  # backup left beside the config is loaded as a SECOND server block — which
  # produced "conflicting server name" and a bogus server_names_hash_bucket_size
  # error that looked like a tuning problem and was not. Cost real time once.
  mkdir -p /root/nginx-backups
  cp "$SITE" "/root/nginx-backups/traycer.$(date +%s).bak"

  awk '
    !ins && /^[[:space:]]*location \/ \{/ {
      print "    # Routes owned by clients that bootstrap.sh does not generate"
      print "    # (Teams tab, Teams bot). Kept out of the vhost body because"
      print "    # bootstrap.sh rewrites this file wholesale."
      print "    include /etc/nginx/traycer-locations.d/*.conf;"
      print ""
      ins = 1
    }
    { print }
  ' "$SITE" > /tmp/traycer.new

  # A read that fails to EMPTY is safer than one that fails to zero: if the
  # anchor never matched, awk still emits the whole file and the include is
  # simply absent. Assert on the thing we came to add.
  if ! grep -q 'traycer-locations.d' /tmp/traycer.new; then
    echo "INSERT FAILED — no 'location / {' anchor matched; config untouched" >&2
    exit 1
  fi
  cp /tmp/traycer.new "$SITE"
  changed=1
  echo "nginx: drop-in include inserted"
fi

# --- 2. the /tab/ location -------------------------------------------------
if grep -q 'location /tab/' "$SITE"; then
  echo "nginx: /tab/ is spliced into the vhost (pre-drop-in box) — left as is"
  echo "       it will be replaced by the drop-in when bootstrap regenerates"
elif [ -f "$DROPIN" ]; then
  echo "nginx: /tab/ drop-in already present"
else
  cat > "$DROPIN" <<'TAB_LOCATION'
# Teams static tab (SPA): try the file, then the directory, then fall back to
# its index so a deep link like /tab/epics/<id>/canvas is served by the app
# rather than 404ing.
#
# Installed by clients/teams-tab/deploy/vm-serve-tab.sh. NOT generated by
# bootstrap.sh — a rebuilt VM has no Teams tab until that script is re-run,
# which is honest: the bundle it serves is not in the IaC either.
location /tab/ {
    alias /var/www/traycer-tab/;
    try_files $uri $uri/ /tab/index.html;
}
TAB_LOCATION
  changed=1
  echo "nginx: /tab/ drop-in written to $DROPIN"
fi

# --- 3. gate, then reload --------------------------------------------------
#
# GATE: never install a config that does not parse. `nginx -t` against the
# candidate is what has kept every nginx change here from becoming an outage.
# Tested directly, NOT through a pipe — `nginx -t | tail` reports tail's exit
# status in bash unless `pipefail` is set, and a safety gate should not depend
# on a shell option set 60 lines away.
if [ "$changed" -eq 0 ]; then
  echo "nginx: nothing changed — no reload"
else
  if ! nginx -t 2>/tmp/nginxt.log; then
    echo "nginx -t FAILED — rolling back" >&2
    cat /tmp/nginxt.log >&2
    rm -f "$DROPIN"
    latest="$(ls -t /root/nginx-backups/traycer.*.bak 2>/dev/null | head -1)"
    [ -n "$latest" ] && cp "$latest" "$SITE"
    nginx -t
    exit 1
  fi
  systemctl reload nginx
  echo "nginx: reloaded"
fi

echo "=== nginx test ==="
nginx -t 2>&1 | tail -2
echo "=== drop-ins ==="
ls -la "$DROPIN_DIR"
echo "=== tab root ==="
ls -la "$ROOT" | head -5
echo "=== serving check (loopback; -k because the cert is for the public name) ==="
# 200 alone does not discriminate: a wrong --base still returns 200 with the
# SPA fallback. The asset's content-type is what tells them apart — see
# vm-install-tab.sh, which asserts it.
curl -s -o /dev/null -w "GET /tab/       : %{http_code} %{content_type}\n" -k https://localhost/tab/
curl -s -o /dev/null -w "GET /tab/epics  : %{http_code} %{content_type}\n" -k https://localhost/tab/epics
