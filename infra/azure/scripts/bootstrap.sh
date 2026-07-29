#!/bin/bash
# First-boot VM provisioning. Runs as root via cloud-init customData (see
# vm.bicep, which assembles the final customData script by embedding this
# file plus traycer-host-guard.sh and the systemd unit template - none of
# the three exist standalone on the VM until this script's caller writes
# them out). Expects TRAYCER_OS_USER, TRAYCER_HOME_ROOT, and
# TRAYCER_TENANT_IDS (space-separated) already exported by the caller.
#
# SCOPE BOUNDARY, stated explicitly so a failed unit after first boot isn't
# read as a bug in this script: this ticket (A0+A1) provisions the VM,
# network, ingress, and systemd SCAFFOLDING for whichever tenant ids are
# listed. It does NOT install any individual tenant's actual Traycer CLI or
# credentials under their HOME - that is A3's job (per-person onboarding,
# explicitly sequenced after this ticket - see main.bicep's `tenantIds`
# param doc). A `traycer-host@<tenant>` unit enabled here WILL fail to
# start (ExecStart's binary won't exist yet) until A3 has run for that
# tenant. That is expected, not a defect: this script's job is to leave
# the scaffolding correct and ready, not to fabricate a tenant install it
# has no authority to create.
set -euo pipefail

: "${TRAYCER_OS_USER:?TRAYCER_OS_USER must be exported by the caller}"
: "${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be exported by the caller}"
: "${TRAYCER_TENANT_IDS:=}"
: "${TRAYCER_PUBLIC_HOSTNAME:?TRAYCER_PUBLIC_HOSTNAME must be exported by the caller}"
: "${TRAYCER_ACME_EMAIL:?TRAYCER_ACME_EMAIL must be exported by the caller}"

echo "bootstrap: installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg nginx certbot python3-certbot-nginx

# Node is required by the Traycer CLI each tenant installs under their own
# HOME (A3's job, not this script's - see the module doc above). Installed
# system-wide via NodeSource rather than per-tenant so every tenant's
# installer finds the same runtime without re-downloading it N times.
if ! command -v node >/dev/null 2>&1; then
  echo "bootstrap: installing Node.js 20.x (matches the CLI's documented floor - see clients/traycer-cli/package.json's engines.node)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi

echo "bootstrap: creating shared OS user '${TRAYCER_OS_USER}'"
# One shared OS user for every tenant's host process - the tech plan's
# explicit decision (see traycer-host@.service's [Service] comment).
# --system: no login shell, no password, not meant for interactive use.
# The user's own $HOME is TRAYCER_HOME_ROOT itself (a nominal base, not a
# real per-tenant identity) - each instance overrides HOME via the unit's
# Environment= line, never via this account's actual home directory.
mkdir -p "${TRAYCER_HOME_ROOT}"
if ! id -u "${TRAYCER_OS_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${TRAYCER_HOME_ROOT}" --shell /usr/sbin/nologin "${TRAYCER_OS_USER}"
fi
chown -R "${TRAYCER_OS_USER}:${TRAYCER_OS_USER}" "${TRAYCER_HOME_ROOT}"

echo "bootstrap: creating per-tenant HOME directories"
# Format-validated HERE, not in Bicep: Bicep's expression language has no
# regex function, and adding a deploymentScripts resource just to run a
# string check would be a real, billed Azure resource for a check bash
# already does natively - see vm.bicep's comment at this same boundary.
# Refuses loudly (set -e aborts the whole script) rather than letting a
# malformed id reach `mkdir -p` unquoted below - a `..` or shell
# metacharacter in a tenant id is a path-traversal concern, not cosmetic.
for tenant_id in ${TRAYCER_TENANT_IDS}; do
  if ! [[ "$tenant_id" =~ ^[a-z0-9-]+$ ]]; then
    echo "bootstrap: refusing - tenant id '${tenant_id}' must match ^[a-z0-9-]+\$ (lowercase, digits, hyphen only)" >&2
    exit 1
  fi
  tenant_home="${TRAYCER_HOME_ROOT}/${tenant_id}"
  mkdir -p "${tenant_home}"
  chown "${TRAYCER_OS_USER}:${TRAYCER_OS_USER}" "${tenant_home}"
  chmod 700 "${tenant_home}"
done

echo "bootstrap: reloading systemd and enabling tenant units"
systemctl daemon-reload
for tenant_id in ${TRAYCER_TENANT_IDS}; do
  # `enable --now`, not just `enable`: grants boot survival immediately AND
  # surfaces a not-yet-onboarded tenant's failure right away in
  # `journalctl -u traycer-host@<tenant>` rather than waiting for the next
  # reboot to discover it - consistent with this epic's fail-loudly bias.
  systemctl enable --now "traycer-host@${tenant_id}.service" || \
    echo "bootstrap: traycer-host@${tenant_id} did not start cleanly - expected if A3 (onboarding) has not run for this tenant yet; see this script's module doc" >&2
done

echo "bootstrap: configuring nginx ingress (HTTP-only, pre-certificate)"
# Two-phase, not one: nginx cannot start with a config that references a
# certificate certbot hasn't issued yet. Phase 1 serves :80 only (the ACME
# challenge path certbot itself needs) so certbot has something to answer
# through; phase 2 (below) swaps in the real TLS config once a cert exists.
mkdir -p /var/www/html/.well-known/acme-challenge
rm -f /etc/nginx/sites-enabled/default

# limit_req_zone must live at the http{} block level, not inside server{} -
# a conf.d drop-in loaded before sites-enabled (nginx.conf's default
# `include /etc/nginx/conf.d/*.conf;` sits above the sites-enabled include).
cat > /etc/nginx/conf.d/traycer-limits.conf <<'TRAYCER_NGINX_LIMITS_EOF'
limit_req_zone $binary_remote_addr zone=traycer_ingress:10m rate=10r/s;
TRAYCER_NGINX_LIMITS_EOF

# client_max_body_size and limit_req live INSIDE this server block (not the
# separate reference template at infra/azure/nginx/traycer.conf.template)
# because certbot's --nginx plugin (below) edits this exact file in place,
# appending a `listen 443 ssl` server block derived from this one - any
# enforcement directive not already here would be silently absent from the
# TLS-terminated server block certbot creates.
cat > /etc/nginx/sites-available/traycer <<'TRAYCER_NGINX_HTTP_EOF'
server {
    listen 80;
    server_name __TRAYCER_PUBLIC_HOSTNAME__;
    client_max_body_size 64m;
    limit_req zone=traycer_ingress burst=20 nodelay;
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 200 "traycer ingress: awaiting certificate\n";
    }
}
TRAYCER_NGINX_HTTP_EOF
sed -i "s|__TRAYCER_PUBLIC_HOSTNAME__|${TRAYCER_PUBLIC_HOSTNAME}|g" /etc/nginx/sites-available/traycer
ln -sf /etc/nginx/sites-available/traycer /etc/nginx/sites-enabled/traycer
nginx -t && systemctl restart nginx

echo "bootstrap: requesting TLS certificate"
# Requires TRAYCER_PUBLIC_HOSTNAME's DNS to already resolve to this VM's
# public IP (see main.bicep's top-of-file comment: DNS zone delegation is
# assumed to already exist, out of this ticket's scope to provision or
# verify). If DNS isn't pointed yet at boot time, this fails and nginx
# stays on the HTTP-only phase-1 config above until an operator reruns
# `certbot --nginx -d <hostname>` by hand once DNS is confirmed - documented
# in infra/azure/README.md's post-deploy checklist, not silently retried
# forever by this script.
if certbot --nginx -d "${TRAYCER_PUBLIC_HOSTNAME}" -m "${TRAYCER_ACME_EMAIL}" \
    --agree-tos --non-interactive --redirect; then
  echo "bootstrap: certificate obtained"

  # PHASE 2 - the routing config.
  #
  # This block exists because its absence shipped once. Certbot's --nginx
  # plugin adds TLS to whatever server block it finds; it does NOT add
  # routing. So after certbot succeeded, the phase-1 catch-all
  # (`location / { return 200 "awaiting certificate"; }`) survived intact and
  # every path - `/`, `/authn`, `/rpc`, `/assets/*.js`, and any nonexistent
  # path - returned the same 38-byte placeholder over a valid certificate.
  #
  # That failure was nearly recorded as success: the agreed check was
  # `/authn` -> 401 means working, 404/CORS means broken. A catch-all 200 is
  # neither, and 200 reads as healthy. The acceptance test below therefore
  # includes a NEGATIVE row - a nonexistent path must 404 - because the
  # positive rows prove the routes exist while only the negative one proves
  # nothing else is quietly succeeding.
  #
  # Post-deploy acceptance test (infra/azure/README.md carries this too):
  #   /                     200 text/html   (once a bundle is deployed)
  #   /assets/<real>.js     200 application/javascript
  #   /authn/api/v3/user    401 JSON        <- proves server-side proxying
  #   /rpc                  502 + reason    <- honest until A1/A3 land
  #   /nonexistent-xyz      404             <- proves the catch-all is gone
  cat > /etc/nginx/sites-available/traycer <<'TRAYCER_NGINX_TLS_EOF'
server {
    listen 443 ssl;
    server_name __TRAYCER_PUBLIC_HOSTNAME__;
    client_max_body_size 64m;
    limit_req zone=traycer_ingress burst=20 nodelay;

    ssl_certificate /etc/letsencrypt/live/__TRAYCER_PUBLIC_HOSTNAME__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__TRAYCER_PUBLIC_HOSTNAME__/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Same-origin authn proxy. Production authn's CORS allowlist contains
    # exactly ONE origin, so a browser on any other origin cannot call it
    # directly - every sign-in fails with an opaque CORS error. Forwarding
    # server-side is not a nicety; it is the only thing that works.
    # Origin/Referer are stripped outbound and CORS headers hidden inbound,
    # mirroring clients/mobile/authn-proxy.mjs.
    location /authn/ {
        proxy_pass https://authn.traycer.ai/;
        proxy_set_header Host authn.traycer.ai;
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
    }

    # No Traycer host process exists until A1 (supervision) and A3
    # (onboarding) are applied. Fail honestly and name the missing upstream:
    # a 200 here would read as healthy to every check we have.
    location /rpc    { return 502 "traycer ingress: no host process on this VM (A1/A3 not applied)\n"; }
    location /stream { return 502 "traycer ingress: no host process on this VM (A1/A3 not applied)\n"; }

    # `=404` rather than a SPA fallback: a fallback would resurrect the
    # catch-all this block exists to remove, and an asset URL typo would
    # silently serve HTML that fails as a parse error somewhere unrelated.
    location / {
        root /var/www/traycer;
        try_files $uri $uri/ =404;
    }
}
server {
    listen 80;
    server_name __TRAYCER_PUBLIC_HOSTNAME__;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}
TRAYCER_NGINX_TLS_EOF
  sed -i "s|__TRAYCER_PUBLIC_HOSTNAME__|${TRAYCER_PUBLIC_HOSTNAME}|g" /etc/nginx/sites-available/traycer
  mkdir -p /var/www/traycer
  if nginx -t; then
    systemctl reload nginx
    echo "bootstrap: phase 2 applied - ingress routing active"
  else
    echo "bootstrap: phase-2 nginx config failed validation; leaving certbot's config in place" >&2
  fi
else
  echo "bootstrap: certbot did not obtain a certificate - DNS likely isn't pointed at this VM yet. nginx is serving HTTP-only on :80. Re-run certbot manually once DNS resolves, then re-run this script to apply phase 2; see infra/azure/README.md." >&2
fi

echo "bootstrap: done"
