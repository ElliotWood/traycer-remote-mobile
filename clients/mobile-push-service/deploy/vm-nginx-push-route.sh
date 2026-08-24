#!/bin/sh
# Route /push/ to the mobile-push-service on 127.0.0.1:5276.
#
# `set -eu` only - see the note in vm-install-push-service.sh about dash and
# pipefail.
#
# THE TRAILING SLASH ON proxy_pass IS THE WHOLE POINT. The service mounts its
# routes prefix-free (`/vapid-public-key`, `/subscribe`, `/unsubscribe`) on the
# deliberate assumption that the prefix is stripped - it was written against
# `tailscale serve --set-path=/push`, which strips. `proxy_pass http://host:port/`
# with the trailing slash strips the matched location prefix; without it, nginx
# forwards `/push/vapid-public-key` verbatim and every request 404s from the
# service while nginx, the unit and the socket all look perfectly healthy.
#
# Inserted before the HTTPS server's `location / {` - matched with an ANCHORED
# regex, because this file has TWO `location / {` lines and the second is the
# port-80 redirect server's one-liner (`location / { return 301 ...; }`). A
# loose match would put the push route in the redirect block, where it would be
# syntactically fine and permanently unreachable over TLS.
set -eu

SITE="${SITE:-/etc/nginx/sites-available/traycer}"
PORT="${PORT:-5276}"

if grep -q "location /push/" "$SITE"; then
  echo "already routed: /push/ exists in $SITE - leaving it alone"
  grep -n -A3 "location /push/" "$SITE"
  exit 0
fi

BACKUP="${SITE}.bak.$(date +%s)"
cp "$SITE" "$BACKUP"
echo "backup: $BACKUP"

MATCHES="$(grep -c '^[[:space:]]*location / {[[:space:]]*$' "$SITE")"
if [ "$MATCHES" != "1" ]; then
  echo "REFUSING: expected exactly 1 anchored 'location / {' line, found ${MATCHES}" >&2
  exit 1
fi

awk -v port="$PORT" '
  /^[[:space:]]*location \/ \{[[:space:]]*$/ && !done {
    print "    # /push/ - mobile-push-service (Web Push: VAPID key, subscribe,"
    print "    # unsubscribe). Loopback-only upstream; this block is its only"
    print "    # public surface. The TRAILING SLASH on proxy_pass strips the"
    print "    # /push prefix, which the service requires - it mounts its routes"
    print "    # prefix-free. Every route needs a bearer, so an unauthenticated"
    print "    # GET returning 401 is the healthy reading, not 200."
    print "    location /push/ {"
    print "        proxy_pass http://127.0.0.1:" port "/;"
    print "        proxy_http_version 1.1;"
    print "        proxy_set_header Host $host;"
    print "        proxy_set_header X-Forwarded-Proto $scheme;"
    print "        client_max_body_size 16k;"
    print "    }"
    print ""
    done = 1
  }
  { print }
' "$BACKUP" > "$SITE"

if ! nginx -t; then
  echo "generated config failed nginx -t - rolling back" >&2
  cp "$BACKUP" "$SITE"
  nginx -t >/dev/null 2>&1 && echo "rolled back, original config is valid" >&2
  exit 1
fi

systemctl reload nginx
echo "nginx reloaded"
grep -n -A8 "location /push/" "$SITE"
