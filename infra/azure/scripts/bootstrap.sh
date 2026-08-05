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
# Space-separated `<owner>/<repo>@<branch>` specs for private repos agents
# on this box need checked out. Empty is a valid, common configuration.
: "${TRAYCER_REPOS:=}"

echo "bootstrap: installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg nginx certbot python3-certbot-nginx

# Node is required by the Traycer CLI each tenant installs under their own
# HOME (A3's job, not this script's - see the module doc above). Installed
# system-wide via NodeSource rather than per-tenant so every tenant's
# installer finds the same runtime without re-downloading it N times.
#
# 22, NOT 20, and the difference is load-bearing rather than a version bump
# for its own sake. This line used to install 20.x, with the justification
# "matches the CLI's documented floor (clients/traycer-cli/package.json's
# engines.node)". The CLI does declare 20 - and then breaks on it. Every
# CLI command that talks to the host over its WebSocket RPC fails on Node 20
# with:
#
#   error: No global `WebSocket` available for the host transport on this
#   runtime. [code=E_UNEXPECTED]
#
# because Node 20 keeps the global `WebSocket` behind
# `--experimental-websocket`. Observed live on this VM (`traycer agent
# list-harnesses`, `agent list`, `agent create` - all of it), fixed by moving
# to 22, where the global is on by default. Confirmed by re-running the same
# commands unflagged afterwards.
#
# `--experimental-websocket` via NODE_OPTIONS was the alternative and was
# rejected: the flag is removed in later Node majors, so it converts a fixed
# bug into one that returns silently on the next upgrade.
#
# The HOST process is unaffected either way - it ships its own bundled
# runtime (.traycer/host/install/host-runtime/traycer-host, a self-contained
# binary), which is why the host ran fine on Node 20 while the CLI could not.
# So is the Claude harness: also a self-contained native binary. System Node
# here serves the npm-installed `traycer` CLI, the ws-deflate relay, and its
# probe.
#
# The guard tests the MAJOR VERSION, not mere presence. `command -v node`
# alone would have been satisfied by exactly the Node 20 that is broken here
# - so on the already-deployed box (and on any image that ships an older
# node) a presence check silently skips the fix and leaves the CLI dead.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${node_major}" -lt 22 ]; then
  echo "bootstrap: installing Node.js 22.x (found major '${node_major}')"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
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
  # A6: the functional health-probe timer runs regardless of whether the
  # host started cleanly above - it no-ops via systemctl is-active until
  # the unit is actually active (see traycer-health-probe.sh), so enabling
  # it early costs nothing and means A3 onboarding a tenant later needs no
  # separate step to turn monitoring on for them.
  systemctl enable --now "traycer-health-probe@${tenant_id}.timer"
  # A6: same reasoning as the health probe - enabled for every tenant up front
  # so A3 onboarding needs no separate "turn monitoring on" step. Structural
  # mode only; see traycer-agent-probe.sh on why --spawn is not scheduled.
  systemctl enable --now "traycer-agent-probe@${tenant_id}.timer"
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
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name __TRAYCER_PUBLIC_HOSTNAME__;
    client_max_body_size 64m;
    limit_req zone=traycer_ingress burst=20 nodelay;

    ssl_certificate /etc/letsencrypt/live/__TRAYCER_PUBLIC_HOSTNAME__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__TRAYCER_PUBLIC_HOSTNAME__/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # systemd-resolved. Required because the authn proxy_pass below resolves
    # a VARIABLE hostname (see the comment there).
    resolver 127.0.0.53 valid=30s ipv6=off;

    # Same-origin authn proxy. Production authn's CORS allowlist contains
    # exactly ONE origin, so a browser on any other origin cannot call it
    # directly - every sign-in fails with an opaque CORS error. Forwarding
    # server-side is not a nicety; it is the only thing that works.
    #
    # The hostname is held in a VARIABLE deliberately, and this is load-
    # bearing. With a literal hostname nginx resolves it at CONFIG-LOAD time
    # and REFUSES TO START if DNS is not yet up - which is normal during boot.
    # Observed live on this VM: nginx died with
    #   [emerg] host not found in upstream "authn.traycer.ai"
    # and stayed down, taking the whole site with it. A variable defers
    # resolution to request time, so a DNS blip degrades one request instead
    # of bricking the server across a reboot.
    location ~ ^/authn/(.*)$ {
        set $authn_host "authn.traycer.ai";
        proxy_pass https://$authn_host/$1$is_args$args;
        proxy_set_header Host $authn_host;
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Expose-Headers;
        proxy_hide_header Access-Control-Max-Age;
    }

    # `traycer_host` is generated by traycer-nginx-upstream.sh from the
    # tenant's pid.json and refreshed by traycer-nginx-upstream.path whenever
    # that file changes.
    #
    # The host binds an EPHEMERAL port, chosen fresh on every start, so a
    # hardcoded port is correct only until the next restart - and then /rpc
    # and /stream fail looking exactly like a client bug. Observed within
    # four minutes of wiring it by hand: 45731 -> 36705.
    #
    # With no host installed, the generated upstream points at a closed port,
    # so these return 502 rather than a 200 that would read as healthy to
    # every check we have.
    #
    # SINGLE-TENANT. A2's identity registry replaces this with per-identity
    # routing once more than one tenant exists on the box.
    location /rpc {
        proxy_pass http://traycer_host/rpc;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host 127.0.0.1;
        proxy_set_header Origin http://127.0.0.1;
        proxy_read_timeout 3600s;
    }
    location /stream {
        proxy_pass http://traycer_host/stream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host 127.0.0.1;
        proxy_set_header Origin http://127.0.0.1;
        proxy_read_timeout 3600s;
    }

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

# --- private repo checkouts ----------------------------------------------
#
# WHAT A REBUILT VM GETS AUTOMATICALLY, AND WHAT IT DOES NOT. Stated up
# front because "captured as IaC" invites the reading that a rebuild is
# hands-off, and for this piece it deliberately is not:
#
#   automatic: the two scripts are on the box, a fresh deploy key is minted,
#             github.com's host keys are pinned, and the clone is attempted.
#   NOT automatic: a rebuilt VM mints a NEW keypair, and that new public key
#             is not registered on GitHub. The clone WILL fail until a human
#             registers it. The public key is printed into the cloud-init
#             log below precisely so that step is a copy-paste, not an
#             investigation.
#
# The alternative - a private key in Key Vault pulled via the VM's managed
# identity - would make rebuilds genuinely hands-off, at the cost of a Key
# Vault, a managed identity, an access policy, and a key that now has a
# transport path again. Not built: at one repo it is more moving parts than
# the manual step it removes. Revisit if rebuild frequency makes the manual
# registration actually hurt.
#
# NON-FATAL BY CONSTRUCTION. This whole phase is `|| true`-guarded: an
# unregistered deploy key on a fresh VM is the EXPECTED first-boot state,
# and `set -e` aborting cloud-init over it would take down ingress and
# systemd scaffolding that have nothing to do with source checkouts.
if [ -n "${TRAYCER_REPOS}" ]; then
  for spec in ${TRAYCER_REPOS}; do
    repo_part="${spec%@*}"
    branch_part="${spec##*@}"
    owner_part="${repo_part%%/*}"
    name_part="${repo_part##*/}"
    if [ "$repo_part" = "$spec" ] || [ -z "$owner_part" ] || [ -z "$name_part" ] || [ -z "$branch_part" ] || [ "$owner_part" = "$repo_part" ]; then
      echo "bootstrap: skipping malformed repo spec '${spec}' - expected <owner>/<repo>@<branch>" >&2
      continue
    fi
    echo "bootstrap: provisioning deploy key for ${owner_part}/${name_part}"
    /usr/local/bin/ensure-repo-deploy-key.sh "$name_part" || {
      echo "bootstrap: deploy-key setup failed for ${name_part}; continuing" >&2
      continue
    }
    echo "bootstrap: attempting clone of ${owner_part}/${name_part}@${branch_part}"
    /usr/local/bin/provision-repo-clone.sh "$owner_part" "$name_part" "$branch_part" "$name_part" || \
      echo "bootstrap: clone of ${owner_part}/${name_part} not completed - register the public key printed above, then re-run: /usr/local/bin/provision-repo-clone.sh ${owner_part} ${name_part} ${branch_part} ${name_part}" >&2
  done
fi

echo "bootstrap: installing the WebSocket deflate relay and its A6 probe"
# Both scripts are already written to /usr/local/lib/traycer by customData
# (see vm.bicep) - this phase installs their one dependency and starts
# them. `ws` is installed HERE rather than baked into customData because
# it is a real npm fetch, not a file copy.
#
# Why this phase exists at all: the relay and probe were both committed
# and both running on the live VM while NOTHING in the IaC installed
# them, so a rebuild would have produced a box with no relay (epic
# loading broken) and no probe to notice. Wiring is not optional just
# because the live box already happens to have it.
mkdir -p /usr/local/lib/traycer
if [ ! -d /usr/local/lib/traycer/node_modules/ws ]; then
  ( cd /usr/local/lib/traycer && npm install --no-save --no-audit --no-fund ws ) || \
    echo "bootstrap: npm install ws failed - the relay and its probe will not start; re-run 'cd /usr/local/lib/traycer && npm install ws'" >&2
fi
chown -R "${TRAYCER_OS_USER}:${TRAYCER_OS_USER}" /usr/local/lib/traycer

systemctl daemon-reload
systemctl enable --now traycer-ws-deflate.service || \
  echo "bootstrap: traycer-ws-deflate did not start - expected until a tenant host exists (it reads that tenant's pid.json); the A6 relay probe will alert if it stays down" >&2
# The probe timer is enabled unconditionally, exactly like the per-tenant
# health probe: a probe that only runs once someone remembers to enable it
# is not monitoring.
systemctl enable --now traycer-relay-probe.timer

echo "bootstrap: provisioning the agent runtime"
# The phase that makes this box able to RUN agents rather than only to serve
# the host and the mobile client - see provision-agent-runtime.sh's own
# header for what was actually missing and why none of the existing checks
# noticed. Ordered last because it is the only phase that makes a real
# outbound API call, so it should not sit in front of ingress and TLS.
#
# `|| true`-guarded for the same reason the deploy-key phase is: a rebuilt VM
# has no Claude credential yet (it cannot - the credential is an OAuth grant
# a human must approve), the script reports that loudly on stderr, and
# aborting cloud-init over an expected first-boot state would take down
# everything provisioned above it.
/usr/local/bin/provision-agent-runtime.sh || \
  echo "bootstrap: agent runtime not fully provisioned - see the message above; the box will serve the mobile client but cannot execute an agent turn until it is resolved" >&2

echo "bootstrap: done"
