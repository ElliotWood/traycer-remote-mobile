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
  echo "bootstrap: certificate obtained, full TLS config active"
else
  echo "bootstrap: certbot did not obtain a certificate - DNS likely isn't pointed at this VM yet. nginx is serving HTTP-only on :80. Re-run certbot manually once DNS resolves; see infra/azure/README.md." >&2
fi

echo "bootstrap: done"
