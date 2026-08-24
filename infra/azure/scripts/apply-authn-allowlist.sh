#!/usr/bin/env bash
# Applies the /authn endpoint allowlist to a LIVE nginx config, in place.
#
# WHY IN-PLACE AND NOT REGENERATED FROM bootstrap.sh
# `sites-available/traycer` is edited by parties other than bootstrap.sh:
# certbot's --nginx plugin injects the TLS block, and other agents add their own
# `location`s (the Teams bot's `/api/messages`). Regenerating the file from the
# template would silently delete all of that. So this rewrites exactly one
# `location` block and leaves every other byte alone.
#
# bootstrap.sh is still the source of truth for a FRESH provision — it carries
# the same allowlist. This script is for the already-running VM.
#
# SAFETY ORDER, all of it deliberate:
#   1. hygiene check first  - a stray backup inside a globbed dir invalidates the
#                             config in a way whose error message names neither
#                             the backup nor the duplicate
#   2. back up OUTSIDE the globbed dirs - backing up into sites-enabled/ is the
#                             exact mistake that caused the outage this guards
#   3. idempotent           - re-running is a no-op, not a second rewrite
#   4. nginx -t BEFORE reload - a failing test must never reach a live reload
#   5. auto-rollback        - if -t fails, restore and re-test, so the box is
#                             never left holding a config that cannot load
set -uo pipefail

SITE=/etc/nginx/sites-available/traycer
LIMITS=/etc/nginx/conf.d/traycer-limits.conf
BACKUP_DIR=/root/nginx-backups
STAMP="$(date +%Y%m%d-%H%M%S)"

fail() { echo "apply-authn-allowlist: $*" >&2; exit 1; }

[ -r "$SITE" ] || fail "cannot read $SITE"
[ -r "$LIMITS" ] || fail "cannot read $LIMITS"

echo "=== 1. hygiene pre-flight ==="
# Never reload on top of a globbed stray. Uses the shared checker so the rule
# lives in one place.
if [ -x /usr/local/lib/traycer/verify-nginx-hygiene.sh ]; then
  /usr/local/lib/traycer/verify-nginx-hygiene.sh || fail "hygiene/nginx -t failed BEFORE any change - fix that first, this script changed nothing"
else
  nginx -t >/dev/null 2>&1 || fail "nginx -t already failing BEFORE any change - this script changed nothing"
  echo "(hygiene script not installed; ran bare nginx -t)"
fi

echo "=== 2. idempotency check ==="
if grep -q 'zone=traycer_authn' "$SITE"; then
  echo "already applied (found zone=traycer_authn in $SITE) - nothing to do"
  exit 0
fi

echo "=== 3. backup outside every globbed directory ==="
mkdir -p "$BACKUP_DIR"
cp -p "$SITE" "${BACKUP_DIR}/traycer.${STAMP}"
cp -p "$LIMITS" "${BACKUP_DIR}/traycer-limits.conf.${STAMP}"
echo "backed up to ${BACKUP_DIR}/ (NOT into sites-enabled/ or conf.d/)"

echo "=== 4. add the authn rate-limit zone if absent ==="
if grep -q 'zone=traycer_authn' "$LIMITS"; then
  echo "zone already present"
else
  cat >> "$LIMITS" <<'LIMITS_EOF'

# Tighter, separate budget for the authn proxy. Real traffic there is a
# device-code poll every ~5s (~0.2 r/s per client), so 5 r/s is ~25x real usage
# per source address - generous for several genuine signers-in behind one NAT,
# while halving the relay budget an abuser gets. The endpoint allowlist in
# sites-available/traycer is the primary control; this is the second layer.
limit_req_zone $binary_remote_addr zone=traycer_authn:10m rate=5r/s;
LIMITS_EOF
  echo "zone added"
fi

echo "=== 5. replace the /authn location block in place ==="
# Brace-matched replacement rather than a line-range sed: the block spans many
# lines and contains braces, and a line-count assumption would silently corrupt
# a neighbouring block the first time anyone reformats the file.
node - "$SITE" <<'NODE_EOF' || fail "in-place rewrite failed - config untouched by node, restore from ${BACKUP_DIR} if needed"
const fs = require("fs");
const path = process.argv[2];
const src = fs.readFileSync(path, "utf8");

const marker = "location ~ ^/authn/";
const start = src.indexOf(marker);
if (start === -1) {
  console.error("could not find an existing 'location ~ ^/authn/' block");
  process.exit(2);
}
// Brace-match from the first '{' after the marker.
const braceOpen = src.indexOf("{", start);
if (braceOpen === -1) {
  console.error("malformed /authn block: no opening brace");
  process.exit(2);
}
let depth = 0;
let end = -1;
for (let i = braceOpen; i < src.length; i += 1) {
  if (src[i] === "{") depth += 1;
  else if (src[i] === "}") {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end === -1) {
  console.error("malformed /authn block: unbalanced braces");
  process.exit(2);
}

const replacement = `location ~ ^/authn/(api/v3/user|api/v3/auth/refresh|api/v3/auth/device/authorize|api/v3/auth/device/token)$ {
        # ENDPOINT ALLOWLIST, not a pass-through. This was \`^/authn/(.*)\$\`,
        # which made the VM an open relay: anyone could reach ANY
        # authn.traycer.ai path through our address, and ours is the IP that
        # gets blocked if abused.
        #
        # These four are exactly what the PWA calls, verified against the
        # client rather than guessed. \`api/v3/auth/exchange-code\` is absent on
        # purpose - it is the desktop shell's PKCE callback.
        #
        # Anchored with \`\$\`, so \`api/v3/user\` matches neither
        # \`api/v3/users\` nor \`api/v3/user/extra\`.
        limit_req zone=traycer_authn burst=10 nodelay;
        limit_req_status 429;
        set \$authn_host "authn.traycer.ai";
        proxy_pass https://\$authn_host/\$1\$is_args\$args;
        proxy_set_header Host \$authn_host;
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Expose-Headers;
        proxy_hide_header Access-Control-Max-Age;
    }

    # Everything else under /authn/ is refused rather than relayed.
    #
    # A PLAIN PREFIX, not \`^~\`, and this is load-bearing: nginx checks regex
    # locations BEFORE a plain prefix match, but a prefix marked \`^~\`
    # SUPPRESSES regex checking entirely. \`location ^~ /authn/\` here would
    # therefore win over the allowlist above and 404 every sign-in. It reads
    # like a tidy-up; it is an outage.
    location /authn/ {
        return 404;
    }`;

fs.writeFileSync(path, src.slice(0, start) + replacement + src.slice(end), "utf8");
console.log("rewrote the /authn block");
NODE_EOF

echo "=== 6. nginx -t BEFORE any reload ==="
if ! nginx -t 2>&1; then
  echo "nginx -t FAILED - rolling back" >&2
  cp -p "${BACKUP_DIR}/traycer.${STAMP}" "$SITE"
  cp -p "${BACKUP_DIR}/traycer-limits.conf.${STAMP}" "$LIMITS"
  nginx -t 2>&1 && echo "rollback restored a valid config" >&2
  fail "rolled back; nothing was reloaded"
fi

echo "=== 7. reload ==="
systemctl reload nginx || fail "reload failed (config tested OK, so this is a service problem)"
echo "reloaded"

echo "=== 8. confirm the other agents' blocks survived ==="
for needle in "location /rpc" "location /stream" "location /"; do
  grep -q "$needle" "$SITE" && echo "present: $needle" || echo "MISSING: $needle"
done
grep -q "location /api/messages" "$SITE" \
  && echo "present: location /api/messages (Teams bot - preserved)" \
  || echo "note: no /api/messages block in this file (may not be deployed yet)"
exit 0
