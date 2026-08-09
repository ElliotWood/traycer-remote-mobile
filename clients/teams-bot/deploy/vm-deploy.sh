#!/usr/bin/env bash
# Deploys the teams-bot bundle onto the Azure VM. Run via
# `az vm run-command invoke` (no SSH is available on this VM).
#
# Deliberately does NOT contain the client secret — that is written
# separately by `vm-write-secret.sh` so this file stays committable.
set -euo pipefail

# All deployment-specific identifiers come from the ENVIRONMENT. None are
# hardcoded: this file is committed to an open-source repo, and app ids,
# tenant ids, a person's Entra object id, host ids and hostnames are exactly
# what the OSS rule forbids in source. Supply them at invocation:
#
#   APP_ID=… TENANT_ID=… TENANT_HOME=… HOST_ID=… DEMO_OID=… \
#   SENDER_AGENT_ID=… DEFAULT_EPIC_ID=… PUBLIC_HOSTNAME=… \
#     az vm run-command invoke … --scripts "$(base64 -w0 < vm-deploy.sh | …)"
#
# Every one is required and unset is fatal — a deploy that silently used an
# empty tenant id would produce a bot that starts and serves the wrong
# person, which is worse than not starting.
require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "vm-deploy: $name is required (see the header comment)" >&2
    exit 1
  fi
}
for v in APP_ID TENANT_ID TENANT_HOME HOST_ID DEMO_OID SENDER_AGENT_ID DEFAULT_EPIC_ID; do
  require_var "$v"
done

BOT_DIR="${BOT_DIR:-/srv/traycer/teams-bot}"

# SENDER_AGENT_ID must be a REAL agent id already registered in the epic, not
# an arbitrary label. Proven by running the bridge against the real host:
#   TRAYCER_AGENT_ID=teams-bot -> "agent.list: sender agent 'teams-bot' was not found."
#   TRAYCER_AGENT_ID=<real id> -> returns the real agent list
# This corrects an earlier assumption that it was a free-form bot-wide
# constant. DEMO EXPEDIENT: whatever id is supplied is an EXISTING agent's, so
# the bot acts AS that agent when calling the host. The proper fix is a
# dedicated agent registered for the bot; not done here because it is not
# needed to read, and inventing one silently would be worse.

# No default: the bundle repo is deployment-specific.
require_var BUNDLE_REPO
BUNDLE_BRANCH="${BUNDLE_BRANCH:-demo/teams-bot-bundle}"

mkdir -p "$BOT_DIR"
cd "$BOT_DIR"

# Bundle arrives via a throwaway git branch: run-command cannot carry 2.4MB
# inline, and there is no SSH/scp to this host.
if [ -d src/.git ]; then
  git -C src fetch -q origin "$BUNDLE_BRANCH"
  git -C src reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BUNDLE_BRANCH" "$BUNDLE_REPO" src
fi
cp src/bot.cjs "$BOT_DIR/bot.cjs"
echo "bundle bytes: $(stat -c%s "$BOT_DIR/bot.cjs")"

# MUST be named exactly `traycer-remote-bridge` (no extension). The bridge
# CLI guards its own entrypoint on `basename(process.argv[1])` being
# `index.ts` / `traycer-remote-bridge` / `traycer-remote-bridge.exe`
# (`clients/remote-bridge/src/index.ts`'s `isBridgeCliEntrypoint`). Under any
# other filename commander never parses and the process exits silently with
# no output and status 0 — which the read surface would surface as a
# confusing `malformed_output` card rather than anything pointing at the
# real cause. Found by running the bundle, not by reading the code.
if [ -f src/traycer-remote-bridge ]; then
  cp src/traycer-remote-bridge "$BOT_DIR/traycer-remote-bridge"
  chmod +x "$BOT_DIR/traycer-remote-bridge"
  echo "bridge bytes: $(stat -c%s "$BOT_DIR/traycer-remote-bridge")"
else
  echo "bridge bundle absent — data commands will report the host unreachable"
fi

cat > "$BOT_DIR/identity-registry.json" <<REG
{"tenants":[{"home":"$TENANT_HOME","hostId":"$HOST_ID","entraOid":"$DEMO_OID","traycerUserId":null}]}
REG
chmod 600 "$BOT_DIR/identity-registry.json"

cat > /etc/systemd/system/traycer-teams-bot.service <<UNIT
[Unit]
Description=Traycer Teams bot
After=network-online.target

[Service]
Type=simple
# MUST run as the tenant's own OS user, NOT root. This is load-bearing and
# cost hours to find:
#
# The bot spawns \`traycer-remote-bridge\`, which shares the tenant's
# credentials file and REWRITES it on token refresh. Running as root rewrote
# \`~/.traycer/cli/credentials\` as root:root mode 600 — and the Traycer host
# runs as \`traycer\`, so it could no longer READ its own credential. The host
# then reported \`UNAUTHORIZED: Host is not provisioned - sign in on this
# machine to authorize it\` to every client (bridge, CLI, and the PWA alike),
# while looking perfectly healthy: unit active, valid pid.json, live
# WebSocket, and a fresh credentials file with the correct user id in it.
#
# The misleading part is that the message says "sign in on this machine",
# which sends you to \`traycer login\` — and signing in AS ROOT rewrites the
# file as root again, so the obvious remedy re-creates the fault. It is a
# file-ownership problem wearing an authentication error's clothing.
User=traycer
Group=traycer
Environment=TEAMS_BOT_HOST=127.0.0.1
Environment=TEAMS_BOT_PORT=3978
Environment=MicrosoftAppId=$APP_ID
Environment=MicrosoftAppTenantId=$TENANT_ID
Environment=TRAYCER_IDENTITY_REGISTRY=$BOT_DIR/identity-registry.json
Environment=TRAYCER_REMOTE_BRIDGE_BIN=$BOT_DIR/traycer-remote-bridge
Environment=TRAYCER_AGENT_ID=$SENDER_AGENT_ID
Environment=TRAYCER_TEAMS_DEFAULT_EPIC_ID=$DEFAULT_EPIC_ID
Environment=TRAYCER_TEAMS_DEMO_IDENTITY=1
Environment=TRAYCER_TEAMS_DEMO_OID=$DEMO_OID
# Which host an assessment is started on. WITHOUT THIS, index.ts leaves
# \`startAssessment\` undefined and every confirmed intake answers "This
# deployment can't start assessments yet" — so the whole opportunity flow,
# including the five-field intake form, was unreachable on this VM.
#
# The value was already here: \$HOST_ID is required at the top of this script
# and written into identity-registry.json as the tenant's \`hostId\`. Nothing
# new has to be discovered or typed; the deploy simply never passed it to the
# variable the dispatcher reads.
#
# It is now specified TWICE — here and in the registry — and they can drift.
# Better would be for the dispatcher to take the host from the resolved
# principal, which already carries one, rather than from its own env var.
# Left as-is because that is a code change to index.ts, not a deploy fix.
Environment=TRAYCER_TEAMS_HOST_ID=$HOST_ID
#
# TRAYCER_TEAMS_TAB_URL IS DELIBERATELY NOT SET. See the note below the unit.
EnvironmentFile=$BOT_DIR/secret.env
ExecStart=/usr/bin/node $BOT_DIR/bot.cjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

# --- why TRAYCER_TEAMS_TAB_URL is not set -------------------------------
#
# It would produce a "Watch progress" button that opens the WRONG PAGE, and
# the card is better off without one.
#
# `intake/deep-link.ts` builds:
#
#     ${TRAYCER_TEAMS_TAB_URL}/epics/<epicId>/chats/<chatId>
#
# and its own docblock says that shape MIRRORS `clients/teams-tab`, which was
# deleted in cb1edae3. The tab now served is upstream's gui-app at /next/,
# whose route is `/epics/$epicId/$tabId` — no `/chats/` segment at all, and
# `$tabId` is a CANVAS TAB id resolved from a client-side store, not a chat
# id. `/epics/<id>/chats/<id>` is one segment too long to match, so the link
# does not resolve to the chat; it falls into the SPA fallback and renders
# something else. The user sees "the wrong page", not an error — precisely
# the liability deep-link.ts warned about, now realised.
#
# deep-link.ts returns null on an empty base and the card then renders with
# no OpenUrl button, which is the correct outcome by its own reasoning: "a
# dead Watch progress button is worse than none". Since teams/ack-honesty the
# no-link variant carries a working `My agents` button instead, so leaving
# this unset is a complete card, not a degraded one.
#
# TO ENABLE IT: fix `chatDeepLink` to gui-app's real route first, verify a
# built link actually lands on the chat, THEN set this to the tab origin. Do
# not set it because the variable exists.


# Everything the bot reads must be owned by the user it runs as. `secret.env`
# and the registry are mode 600, so root ownership makes them unreadable to
# `traycer` — the bot would fail to start rather than fail subtly, but fix it
# here so that never happens.
chown -R traycer:traycer "$BOT_DIR"
# Repair the credentials files too, in case an earlier root-run bridge or
# `traycer login` left them root-owned (see the User= comment above).
if [ -e "$TENANT_HOME/.traycer/cli/credentials" ]; then
  chown traycer:traycer "$TENANT_HOME/.traycer/cli/credentials" \
    "$TENANT_HOME/.traycer/cli/credentials.meta.json" 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable traycer-teams-bot.service >/dev/null 2>&1 || true
# `restart` not `--now`: the unit file changed (User=), and `enable --now` does
# not restart an already-running service, so the old root-run process would
# survive and keep re-breaking credential ownership.
systemctl restart traycer-teams-bot.service || true
sleep 4
echo "=== unit active: $(systemctl is-active traycer-teams-bot.service) ==="
journalctl -u traycer-teams-bot.service -n 12 --no-pager | tail -12
echo "=== loopback healthz ==="
curl -s -m 5 -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1:3978/healthz
