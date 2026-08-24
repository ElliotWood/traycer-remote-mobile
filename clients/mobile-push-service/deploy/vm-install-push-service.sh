#!/bin/sh
# Install (or update) mobile-push-service on the Traycer VM as a systemd unit.
#
# Shape borrowed wholesale from `clients/teams-bot/deploy/vm-update-bundle.sh`,
# because that script's hard-won parts apply here unchanged:
#
#   - `set -eu` only, NOT `-o pipefail`. `az vm run-command` runs this with
#     /bin/sh, which on this VM is dash, where pipefail aborts at line 1 with
#     "Illegal option" - producing empty stdout and a deploy that did nothing
#     while looking like it ran.
#   - `git -c safe.directory=...` PER INVOCATION. run-command executes as root
#     with no $HOME, so `git config --global` dies with "fatal: $HOME not set",
#     and chowning the checkout to root would re-create the ownership trap.
#   - `node --check` BEFORE the copy: provenance and viability are different
#     questions, and a bundle with a perfect sha256 has already taken a service
#     down on restart. The parse gate runs first so a bundle that cannot load
#     never replaces one that works.
#   - sha256 LAST and FATAL, against a hash the caller supplies. An earlier
#     version of the bot script grepped for a marker string; on the second
#     deploy both builds contained it, so it read "1 before, 1 after" and
#     proved nothing. A hash cannot be accidentally satisfied by the build it
#     is replacing.
#
# What is NOT borrowed: this service holds no secret of its own. Its VAPID
# keypair is minted on first run into $HOME/.traycer/push-service/vapid.json,
# and its host credential is the tenant's existing ~/.traycer/cli/credentials.
# So there is no secret.env to avoid touching.
set -eu

TENANT="${TENANT:-elliot}"
SVC_DIR="${SVC_DIR:-/srv/traycer/push-service}"
BUNDLE_BRANCH="${BUNDLE_BRANCH:-demo/mobile-push-service-bundle}"
BUNDLE_REPO="${BUNDLE_REPO:-https://github.com/ElliotWood/traycer-remote-mobile.git}"
EXPECTED_SHA256="${EXPECTED_SHA256:?EXPECTED_SHA256 is required (sha256sum of the push-service.cjs you built)}"

TENANT_HOME="/srv/traycer/tenants/${TENANT}"
UNIT="traycer-push-service@${TENANT}.service"

# The service is useless without these two, and both failures are quiet:
# missing credentials leaves it serving HTTP forever while never subscribing
# (the process does NOT exit - the listening socket keeps the event loop
# alive, so systemd reports "active" for a half-dead service), and a missing
# pid.json leaves it dialing nothing. Refuse up front instead.
if [ ! -f "${TENANT_HOME}/.traycer/cli/credentials" ]; then
  echo "REFUSING: no CLI credentials at ${TENANT_HOME}/.traycer/cli/credentials" >&2
  echo "  the service would report 'not signed in' and never subscribe" >&2
  exit 1
fi
if [ ! -f "${TENANT_HOME}/.traycer/host/pid.json" ]; then
  echo "REFUSING: no host pid.json at ${TENANT_HOME}/.traycer/host/pid.json" >&2
  exit 1
fi

mkdir -p "$SVC_DIR"
cd "$SVC_DIR"

echo "=== before ==="
stat -c '%n %y %U:%G %s' push-service.cjs 2>/dev/null || echo "push-service.cjs absent"
echo "unit before: $(systemctl is-active "$UNIT" 2>/dev/null || echo absent)"

GIT="git -c safe.directory=${SVC_DIR}/src"
if [ -d src/.git ]; then
  $GIT -C src fetch -q origin "$BUNDLE_BRANCH"
  $GIT -C src reset -q --hard FETCH_HEAD
else
  $GIT clone -q --depth 1 --branch "$BUNDLE_BRANCH" "$BUNDLE_REPO" src
fi

if ! node --check src/push-service.cjs; then
  echo "REFUSING TO DEPLOY: push-service.cjs does not parse as CommonJS" >&2
  echo "  any currently-deployed bundle has been left untouched" >&2
  exit 1
fi
echo "parse check: push-service.cjs is valid CommonJS"

cp src/push-service.cjs "$SVC_DIR/push-service.cjs"
chown traycer:traycer "$SVC_DIR/push-service.cjs"

# The unit is written every run. It carries no identifiers and no secrets, so
# unlike the bot's there is nothing to mistype and no reason to split an
# "update the code only" variant off it.
cat > "/etc/systemd/system/traycer-push-service@.service" <<'UNITEOF'
[Unit]
Description=Traycer mobile push service for tenant %i
# Wants, not Requires: the service tolerates the host being down (it polls
# pid.json every 2s and reconnects with backoff), so a host restart must not
# take it with it.
After=network-online.target traycer-host@%i.service
Wants=traycer-host@%i.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=traycer
Group=traycer
# HOME is the whole configuration surface. The service resolves the tenant's
# ~/.traycer/cli/credentials (its host bearer), ~/.traycer/host/pid.json (the
# loopback ws endpoint it dials) and ~/.traycer/push-service/ (VAPID keypair,
# subscriptions, dedup state) from it, and nothing else. USERPROFILE is set
# alongside because os.homedir() reads it on Windows - harmless here, and it
# keeps the two environments describing the same thing.
Environment=HOME=/srv/traycer/tenants/%i
Environment=USERPROFILE=/srv/traycer/tenants/%i
WorkingDirectory=/srv/traycer/push-service
ExecStart=/usr/bin/node /srv/traycer/push-service/push-service.cjs
Restart=always
RestartSec=5
SyslogIdentifier=traycer-push-%i

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1 || true
systemctl restart "$UNIT"
sleep 6

echo "=== after ==="
stat -c '%n %y %U:%G %s' push-service.cjs
ACTUAL_SHA="$(sha256sum push-service.cjs | cut -d' ' -f1)"
echo "sha after:   $(echo "$ACTUAL_SHA" | cut -c1-16)"
echo "unit active: $(systemctl is-active "$UNIT")"
echo "listening:   $(ss -lnt 2>/dev/null | grep -c '127.0.0.1:5276')"
echo "vapid file:  $(stat -c%s "${TENANT_HOME}/.traycer/push-service/vapid.json" 2>/dev/null || echo absent)"
# 401 is the SUCCESS reading on a bearer-less request: every route requires a
# bearer, so 401 means routed-and-running. 000 means nothing is listening.
echo "loopback /vapid-public-key (no bearer, expect 401): $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5276/vapid-public-key)"
journalctl -u "$UNIT" -n 12 --no-pager | tail -12

if [ "$ACTUAL_SHA" != "$EXPECTED_SHA256" ]; then
  echo "DEPLOY VERIFY FAILED: deployed push-service.cjs is not the build you asked for" >&2
  echo "  expected $EXPECTED_SHA256" >&2
  echo "  actual   $ACTUAL_SHA" >&2
  exit 1
fi
echo "verified: deployed push-service.cjs is byte-identical to the build you supplied"
