#!/usr/bin/env bash
# Serves the Teams static tab at /tab/ on the existing nginx vhost.
#
# The PWA already owns `/`, so the tab gets its own prefix rather than a
# second server block — one vhost, one certificate, one `validDomains` entry
# in the Teams manifest.
set -euo pipefail

SITE=/etc/nginx/sites-enabled/traycer
ROOT=/var/www/traycer-tab

mkdir -p "$ROOT"

if grep -q "location /tab/" "$SITE"; then
  echo "nginx: /tab/ already configured"
else
  # Backup goes OUTSIDE sites-enabled. nginx globs that directory, so a
  # backup left beside the config is loaded as a SECOND server block —
  # which produced "conflicting server name" and a bogus
  # server_names_hash_bucket_size error that looked like a tuning problem
  # and was not. Cost real time once already.
  mkdir -p /root/nginx-backups
  cp "$SITE" "/root/nginx-backups/traycer.$(date +%s).bak"

  # Inserted before the catch-all `location / {`, because nginx prefix
  # matching takes the LONGEST match — but `/` is where the PWA lives and
  # keeping the edit ordered makes the file readable. `awk` rather than
  # `sed`: the inserted block contains `/` and `#`, which collide with every
  # convenient sed delimiter (learned the same way).
  awk '
    !done && /^[[:space:]]*location \/ \{/ {
      print "    # Teams static tab (SPA): try the file, then the directory,"
      print "    # then fall back to its index so a deep link like /tab/fleet"
      print "    # is served by the app rather than 404ing."
      print "    location /tab/ {"
      print "        alias /var/www/traycer-tab/;"
      print "        try_files $uri $uri/ /tab/index.html;"
      print "    }"
      print ""
      done = 1
    }
    { print }
  ' "$SITE" > /tmp/traycer.new

  # GATE: never install a config that does not parse. `nginx -t` against the
  # candidate is what has kept every nginx change here from becoming an
  # outage.
  cp /tmp/traycer.new "$SITE"
  if ! nginx -t 2>/tmp/nginxt.log; then
    echo "nginx -t FAILED — restoring previous config" >&2
    cat /tmp/nginxt.log >&2
    cp "$(ls -t /root/nginx-backups/traycer.*.bak | head -1)" "$SITE"
    nginx -t
    exit 1
  fi
  systemctl reload nginx
  echo "nginx: /tab/ added and reloaded"
fi

echo "=== nginx test ==="
nginx -t 2>&1 | tail -2
echo "=== tab root ==="
ls -la "$ROOT" | head -5
