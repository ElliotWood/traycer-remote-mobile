cat > /etc/systemd/system/traycer-host@.service <<'TRAYCER_UNIT_EOF'
[Unit]
Description=Traycer host process for tenant %i
# `traycer-host-guard.sh` is the enforcement point for A1's two non-negotiable
# guard rails Traycer itself does not provide (per the ticket: "refuse to
# start a second process against a HOME already in use" and "expose which
# identity each host is pinned to"). It runs as ExecStartPre, BEFORE the host
# process itself starts, so a duplicate-HOME condition is refused loudly at
# service-start time - not detected after two processes are already
# contending. See infra/azure/README.md's verification section for the
# command that proves the refusal is real, not just present in this file.
StartLimitIntervalSec=300
StartLimitBurst=5
# A6: fires on EVERY transition to `failed` - a single unrecovered crash
# AND a StartLimitBurst-exhausted restart loop alike. The triggered unit
# (traycer-host-alert@.service) is what tells the two apart by reading
# this unit's own Result= (`start-limit-hit` vs anything else), not a
# separate OnFailure= per case - see traycer-host-failure-alert.sh.
OnFailure=traycer-host-alert@%i.service

[Service]
Type=simple
# All tenants share ONE OS user (the tech plan's explicit decision - see
# infra/azure/README.md's "why one OS user" note); isolation is per-process
# HOME, never a per-tenant OS account. `User=`/`Group=` are therefore fixed
# placeholders substituted at provision time (see bootstrap.sh), not
# per-instance values - %i only ever selects the HOME directory and the log
# namespace, never the OS identity the process runs as.
User=__TRAYCER_OS_USER__
Group=__TRAYCER_OS_USER__
Environment=HOME=__TRAYCER_HOME_ROOT__/%i
# USERPROFILE is set too even though this unit only ever runs on Linux -
# `requireHomeEnv()` (clients/remote-bridge/src/host-auth.ts) checks
# USERPROFILE first on win32 and HOME everywhere else, so setting only HOME
# here is correct for THIS deployment; USERPROFILE is included anyway as
# defence against a future port of this unit template to a Windows host
# process, where omitting it would silently reintroduce the getpwuid()
# fallback bug A1 exists to prevent. Belt-and-braces, not load-bearing here.
Environment=USERPROFILE=__TRAYCER_HOME_ROOT__/%i
# Required by traycer-host-guard.sh (ExecStartPre below) - found live via
# A6 verification, not assumed: an earlier draft of this unit had no
# TRAYCER_HOME_ROOT line at all, so the guard script's own `: "${TRAYCER_HOME_ROOT:?...}"`
# check refused every single start attempt before ExecStart was ever
# reached - meaning the guard rail this ticket exists to enforce had never
# actually run successfully on any deployment. Caught by starting a real
# systemd instance and reading WHY it failed, not by re-deriving the
# contract on paper.
Environment=TRAYCER_HOME_ROOT=__TRAYCER_HOME_ROOT__
ExecStartPre=/usr/local/bin/traycer-host-guard.sh %i
# Each tenant's HOME is a self-contained Traycer install (its own
# ~/.traycer/cli/bin/traycer, its own credentials file, its own host
# install record) - the per-user CLI binary path
# clients/traycer-cli/src/service/cli-binary.ts resolves against
# `cliInstallHomeDir()`, which is `join(homedir(), ".traycer", "cli")`. This
# unit invokes that per-HOME binary directly rather than going through the
# CLI's own `service install` (systemctl --user), which assumes one OS user
# per identity - the model A1's tech plan explicitly rejected in favour of
# one shared OS user with per-process HOME.
ExecStart=__TRAYCER_HOME_ROOT__/%i/.traycer/cli/bin/traycer host start
Restart=on-failure
RestartSec=5
# Per-tenant log separation (A1's "per-tenant log separation" requirement):
# each instance's journal entries are queryable independently via
# `journalctl -u traycer-host@<tenant>`, and SyslogIdentifier keeps that
# separation visible even when aggregated (A6, a later ticket, is expected
# to ship the aggregation/alerting on TOP of this - not build its own
# separation scheme).
SyslogIdentifier=traycer-host-%i

# Defence-in-depth (not the enforcement layer - HOME is): the unit's own
# working directory is scoped to this tenant's HOME, so a bug that
# constructs a relative path incorrectly fails on a missing file inside the
# tenant's own directory rather than accidentally reading a sibling
# tenant's.
WorkingDirectory=__TRAYCER_HOME_ROOT__/%i

# Boot survival (A1's "boot survival" requirement) is granted by `enable`,
# done per-tenant by bootstrap.sh - this unit file does not enable itself.
[Install]
WantedBy=multi-user.target

TRAYCER_UNIT_EOF
sed -i "s|__TRAYCER_OS_USER__|traycer|g; s|__TRAYCER_HOME_ROOT__|/srv/traycer/tenants|g" /etc/systemd/system/traycer-host@.service
systemctl daemon-reload
echo "fix-hostunit: applied"
