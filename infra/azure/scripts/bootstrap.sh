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
  # so A3 onboarding needs no separate "turn monitoring on" step. This one is
  # the STRUCTURAL probe: free, every few minutes.
  systemctl enable --now "traycer-agent-probe@${tenant_id}.timer"
  # A6: and the SPAWN probe, which costs one real Claude call per run.
  #
  # WHY THIS IS NOT A NEW SPEND, since the unit's own header says the cost was
  # "approved as an explicit spend, not a default". It is already being
  # incurred: `traycer-agent-spawn-probe@<tenant>.timer` is enabled on the live
  # VM today, by hand. What was missing was any way to reproduce that - so the
  # money was being spent AND a rebuild would silently stop spending it,
  # removing the only check that distinguishes a live credential from a dead
  # one at exactly the moment you would most want it. Found by the drift check
  # in verify-iac-parity.sh, which reported the timer as enabled on the VM and
  # by no template.
  #
  # THE COST, stated so it can be argued with rather than rediscovered: 4 runs
  # per tenant per day (6-hourly, jittered), one `claude` invocation each,
  # against the ONE Claude Max account this deployment shares across N people.
  # It scales with tenant count. If that becomes the wrong trade, turn it off
  # in this one place - which is the point of it being here at all, rather than
  # being a hand-enabled unit nobody knows is running.
  systemctl enable --now "traycer-agent-spawn-probe@${tenant_id}.timer"
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
#
# NOTE for anyone adding a file here: `conf.d/*.conf` is globbed, exactly like
# `sites-enabled/*`. A backup left beside this file (`*.bak`, `*.orig`) is
# LOADED, and a duplicated `limit_req_zone` fails the config with a message
# that names neither the duplicate nor the backup. Put backups outside the
# globbed directory. This trap has already cost one repair cycle on the
# sites-enabled side.
cat > /etc/nginx/conf.d/traycer-limits.conf <<'TRAYCER_NGINX_LIMITS_EOF'
limit_req_zone $binary_remote_addr zone=traycer_ingress:10m rate=10r/s;

# Separate, tighter budget for the authn proxy. Deliberately NOT sharing
# `traycer_ingress`: that zone sizes for a browser loading an app (many asset
# requests in a burst), whereas the authn path's real traffic is a device-code
# poll every ~5s plus an occasional /user or /refresh — call it 0.2 r/s per
# client. 5 r/s is ~25x real usage per source address, so it cannot inconvenience
# a genuine signer-in (or several behind one NAT) while halving the relay budget
# an abuser gets. The endpoint allowlist below is the primary control; this is
# the second layer.
limit_req_zone $binary_remote_addr zone=traycer_authn:10m rate=5r/s;
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
  #   /                        200 text/html   (once a bundle is deployed)
  #   /assets/<real>.js        200 application/javascript
  #   /authn/api/v3/user       401 JSON        <- proves server-side proxying
  #   /rpc                     502 + reason    <- honest until A1/A3 land
  #   /nonexistent-xyz         404             <- proves the catch-all is gone
  #   /authn/api/v3/auth/me    404             <- proves /authn is an ALLOWLIST,
  #                                               not a relay. Same reasoning as
  #                                               the row above: the positive
  #                                               authn row proves the route
  #                                               exists, and only this negative
  #                                               one proves every OTHER authn
  #                                               path is refused. A real authn
  #                                               path is used deliberately -
  #                                               a nonsense one would 404 even
  #                                               through an open relay.
  # THE UPSTREAM FILE. Written unconditionally, BEFORE the vhost that
  # references it, and this ordering is the whole point.
  #
  # nginx resolves an unknown upstream name at CONFIG-LOAD time. With this
  # file absent, `nginx -t` on the vhost below fails with
  #   [emerg] host not found in upstream "traycer_host"
  # phase 2 takes its own failure branch, and the box is left on the phase-1
  # catch-all - serving the 38-byte "awaiting certificate" placeholder on
  # EVERY path over a valid certificate, which reads as 200/healthy to every
  # check we have. That is not a hypothetical: it is what a deploy from this
  # script produced on a throwaway VM before this block existed, with certbot
  # having succeeded first.
  #
  # A STATIC port, deliberately. 45080 is the tenant router's fixed listen
  # port; the router resolves each tenant's ephemeral host port per
  # connection. Nothing here needs to track a host restart, which is why the
  # traycer-nginx-upstream.sh watcher is not wired in - see the /rpc block.
  #
  # If the router is down, this points at a port nobody is listening on and
  # /rpc 502s. That is the honest failure and it is why this file is written
  # even when the router cannot start: an absent upstream takes the whole
  # site down, a closed one degrades exactly the two routes that depend on it.
  cat > /etc/nginx/conf.d/traycer-upstream.conf <<'TRAYCER_NGINX_UPSTREAM_EOF'
upstream traycer_host { server 127.0.0.1:45080; }
TRAYCER_NGINX_UPSTREAM_EOF

  # The drop-in directory the vhost below includes. Created empty, and empty
  # is a correct steady state - it means no other surface has deployed a route
  # here yet, not that something failed.
  mkdir -p /etc/nginx/traycer-locations.d

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
    # ENDPOINT ALLOWLIST, not a pass-through. This was `^/authn/(.*)$`, which
    # made the VM an open relay: anyone on the internet could reach ANY
    # authn.traycer.ai path through our address. That is the same shape as a
    # vector already closed one layer down (unauthenticated input becoming
    # uncapped outbound load on a third party), and it is our IP that gets
    # blocked if abused.
    #
    # These four are exactly what the PWA needs, verified against the client
    # rather than guessed:
    #   api/v3/auth/device/authorize   startDeviceAuthorization  (device-auth.ts)
    #   api/v3/auth/device/token       pollDeviceToken           (device-auth.ts)
    #   api/v3/user                    validateAuthTokenIdentity (auth-validation.ts)
    #   api/v3/auth/refresh            refreshOnceAbortable      (auth-validation.ts)
    # `api/v3/auth/exchange-code` is deliberately ABSENT: it is the desktop
    # shell's PKCE callback and the mobile client never calls it.
    #
    # Anchored with `$` so no suffix can be appended, and the alternatives are
    # exact — `api/v3/user` will not match `api/v3/users` or `api/v3/user/../x`.
    location ~ ^/authn/(api/v3/user|api/v3/auth/refresh|api/v3/auth/device/authorize|api/v3/auth/device/token)$ {
        limit_req zone=traycer_authn burst=10 nodelay;
        limit_req_status 429;
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

    # Everything else under /authn/ is refused rather than relayed.
    #
    # A PLAIN PREFIX, not `^~`. This is load-bearing and easy to "tidy" into a
    # bug: nginx checks regex locations BEFORE a plain prefix match, but a
    # prefix marked `^~` SUPPRESSES regex checking entirely. Writing
    # `location ^~ /authn/` here would therefore win over the allowlist above
    # and 404 every legitimate sign-in.
    location /authn/ {
        return 404;
    }

    # `traycer_host` resolves to the TENANT ROUTER, not to any one tenant's
    # host - see the upstream file written unconditionally above this block.
    #
    # WHY NOT THE HOST DIRECTLY. The host binds an EPHEMERAL port, chosen
    # fresh on every start, so a port written into nginx is correct only
    # until the next restart - and then /rpc and /stream fail looking exactly
    # like a client bug. Observed within four minutes of wiring it by hand:
    # 45731 -> 36705. The router's port is FIXED, and it re-reads each
    # tenant's pid.json per connection, so a host restart heals itself with
    # no nginx involvement at all.
    #
    # That is also why traycer-nginx-upstream.sh and its .path unit are NOT
    # wired in here, despite both existing in this repo. They chase the
    # ephemeral port into this config, which the router made unnecessary -
    # and worse, running one would REWRITE the upstream below from the
    # router's 45080 to a single tenant's host port, silently reverting the
    # box to single-tenant and taking A2's identity check out of the path
    # while `nginx -t` stayed green and the site kept serving. Measured on
    # the live VM, where that .path unit is `disabled` for this reason.
    #
    # If the router is not running, these return 502 rather than a 200 that
    # would read as healthy to every check we have.
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

    # Drop-in point for routes owned by surfaces this file does not provision.
    #
    # This file is REGENERATED wholesale on every run, so anything edited into
    # it in place is destroyed by the next deploy. That is not hypothetical:
    # the live VM's `/api/messages` and `/tab/` blocks were inserted by
    # separate deploy scripts editing this exact file, and a rebuild would
    # have silently taken both down with nothing in the output saying so.
    # A drop-in directory survives regeneration; an in-place edit does not.
    #
    # Deliberately GENERIC - no Teams strings here. Teams needs seven things
    # on this box and `infra/` provisions none of them, so a literal Teams
    # block would produce an ingress that reads Teams-aware while serving a
    # 502 and a 404. Owning the seam without owning the routes is the honest
    # split, and it matches main.bicep's stated scope.
    #
    # A glob matching ZERO files is valid nginx - measured, not assumed:
    # `nginx -t` exits 0 with an empty drop-in directory, exits 1 when a
    # drop-in is malformed (so the include is genuinely live, not ignored),
    # and exits 1 for a missing LITERAL filename, which is the case people
    # remember and the reason a glob is used here.
    include /etc/nginx/traycer-locations.d/*.conf;

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
  # DO NOT NAME A CAUSE HERE. This read "DNS likely isn't pointed at this VM
  # yet" - a cause the script has not checked. Observed on a scratch deploy
  # where DNS was correct and certbot had failed at ACCOUNT REGISTRATION over
  # a .invalid contact address, with its own accurate error two lines above.
  # A confident wrong diagnosis is worse than none: it says where to stop.
  echo "bootstrap: certbot did not obtain a certificate. THE REASON IS CERTBOT'S OWN OUTPUT ABOVE; this script does not know it and will not guess. Seen in practice: DNS for ${TRAYCER_PUBLIC_HOSTNAME} not resolving here; a contact address ACME refuses at registration (.invalid/.test/.local); issuance limits on the registrable domain - note *.cloudapp.azure.com is absent from the Public Suffix List, so ACME reads its registrable domain as azure.com." >&2
  echo "bootstrap: PHASE 2 WAS NOT APPLIED - nginx is HTTP-only on :80 and every path returns the 38-byte placeholder with a 200, including paths that should 404. Fix the above, run 'certbot --nginx -d ${TRAYCER_PUBLIC_HOSTNAME}', re-run this script." >&2
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

echo "bootstrap: installing the tenant router and its A6 probe"
# The router and probe are already written to /usr/local/lib/traycer by the
# provisioning script (see vm.bicep) - this phase installs their runtime
# dependencies and starts them. They are npm-installed HERE rather than
# baked into the payload because they are a real npm fetch, not a file copy.
#
# `zod` alongside `ws`, and this is what makes the router shippable at all.
# router/build.sh used to bundle both INTO the artifact, producing a 600 KB
# file; with them external the same bundle is ~16 KB, which fits in the
# provisioning payload as ordinary text. The security argument for bundling
# is untouched - IdentityRegistry is still compiled in from clients/shared,
# never reimplemented - only the third-party deps moved out.
#
# Why this phase exists at all: the relay and probe were both committed
# and both running on the live VM while NOTHING in the IaC installed
# them, so a rebuild would have produced a box with no relay (epic
# loading broken) and no probe to notice. Wiring is not optional just
# because the live box already happens to have it.
mkdir -p /usr/local/lib/traycer
if [ ! -d /usr/local/lib/traycer/node_modules/ws ] || [ ! -d /usr/local/lib/traycer/node_modules/zod ]; then
  ( cd /usr/local/lib/traycer && npm install --no-save --no-audit --no-fund ws zod ) || \
    echo "bootstrap: npm install failed - the router and its probe will not start; re-run 'cd /usr/local/lib/traycer && npm install ws zod'" >&2
fi
chown -R "${TRAYCER_OS_USER}:${TRAYCER_OS_USER}" /usr/local/lib/traycer

# The identity registry the router routes on. GENERATED from each tenant's
# own credentials file, never committed - a real person's Traycer user id is
# not repo content, and a hand-maintained copy would drift from who is
# actually signed in (see traycer-registry-generate.sh's own header).
#
# Non-fatal: on a fresh VM no tenant has signed in yet, so the generator
# refuses (correctly - an empty registry would route nobody). The router
# then fails to start, /rpc 502s, and that is the honest state. A3
# (onboarding) re-runs this for real once someone has credentials.
echo "bootstrap: generating the identity registry"
/usr/local/bin/traycer-registry-generate.sh || \
  echo "bootstrap: no identity registry yet - expected before any tenant has completed sign-in (A3); the router will not start until this succeeds. Re-run: /usr/local/bin/traycer-registry-generate.sh" >&2

systemctl daemon-reload
# traycer-tenant-router, NOT traycer-ws-deflate. The router supersedes that
# relay entirely: same permessage-deflate on the internet leg, plus the
# per-identity routing that makes the box multi-tenant. ws-deflate was
# hardcoded to ONE tenant's pid.json - it is also the file that put a real
# username in a tracked unit - and it is absent from the live VM, which has
# been running the router since 2026-07-29. Enabling both would collide on
# port 45080.
systemctl enable --now traycer-tenant-router.service || \
  echo "bootstrap: traycer-tenant-router did not start - expected until the identity registry above exists (no tenant has signed in yet); /rpc and /stream will 502 until then, which is the intended honest failure" >&2
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
