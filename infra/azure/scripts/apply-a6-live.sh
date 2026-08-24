#!/bin/bash
# ONE-OFF, not part of the IaC: applies A6's new scripts/units to the
# ALREADY-LIVE VM without re-running bootstrap.sh's package installs /
# nginx / certbot phases. customData only runs at first boot, so the
# scripts/units this deployment's `vm.bicep` now embeds do not reach a
# VM that already exists - this script is that gap, run once via
# `az vm run-command invoke`, not committed as part of the deployment
# path (a fresh VM gets all of this from customData on first boot; this
# is only for retrofitting the VM that predates this change).
set -euo pipefail

TRAYCER_OS_USER="traycer"
TRAYCER_HOME_ROOT="/srv/traycer/tenants"

cat > /usr/local/bin/traycer-alert.sh <<'TRAYCER_ALERT_EOF'
__ALERT_SCRIPT__
TRAYCER_ALERT_EOF

cat > /usr/local/bin/traycer-host-failure-alert.sh <<'TRAYCER_HOSTFAIL_EOF'
__HOSTFAIL_SCRIPT__
TRAYCER_HOSTFAIL_EOF

cat > /usr/local/bin/traycer-worktree-rescue.sh <<'TRAYCER_RESCUE_EOF'
__RESCUE_SCRIPT__
TRAYCER_RESCUE_EOF

cat > /usr/local/bin/traycer-health-probe.sh <<'TRAYCER_PROBE_EOF'
__PROBE_SCRIPT__
TRAYCER_PROBE_EOF

chmod +x /usr/local/bin/traycer-alert.sh /usr/local/bin/traycer-host-failure-alert.sh \
  /usr/local/bin/traycer-worktree-rescue.sh /usr/local/bin/traycer-health-probe.sh

cat > /etc/systemd/system/traycer-host-alert@.service <<'TRAYCER_HOSTALERT_UNIT_EOF'
__HOSTALERT_UNIT__
TRAYCER_HOSTALERT_UNIT_EOF

cat > /etc/systemd/system/traycer-health-probe@.service <<'TRAYCER_PROBE_UNIT_EOF'
__PROBE_UNIT__
TRAYCER_PROBE_UNIT_EOF

cat > /etc/systemd/system/traycer-health-probe@.timer <<'TRAYCER_PROBE_TIMER_EOF'
__PROBE_TIMER__
TRAYCER_PROBE_TIMER_EOF

sed -i "s|__TRAYCER_OS_USER__|${TRAYCER_OS_USER}|g; s|__TRAYCER_HOME_ROOT__|${TRAYCER_HOME_ROOT}|g" \
  /etc/systemd/system/traycer-host-alert@.service /etc/systemd/system/traycer-health-probe@.service

cat > /etc/systemd/system/traycer-host@.service <<'TRAYCER_UNIT_EOF'
__HOST_UNIT__
TRAYCER_UNIT_EOF
sed -i "s|__TRAYCER_OS_USER__|${TRAYCER_OS_USER}|g; s|__TRAYCER_HOME_ROOT__|${TRAYCER_HOME_ROOT}|g" \
  /etc/systemd/system/traycer-host@.service

systemctl daemon-reload
echo "apply-a6-live: done"
