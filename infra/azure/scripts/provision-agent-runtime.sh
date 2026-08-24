#!/bin/bash
# Makes the box able to RUN agents, not merely to serve the Traycer host.
#
# WHY THIS EXISTS AS ITS OWN PHASE. Until this script, a rebuilt VM came up
# with a healthy `traycer-host@<tenant>` unit, working ingress, and a mobile
# client that could list epics - and could not execute a single agent turn,
# because no agent harness was installed at all. Every check the IaC had
# passed. `systemctl is-active` said active, `/rpc` answered, the host's own
# `agent.listHarnessModels` even returned a full Claude model catalogue
# (opus/sonnet/haiku) - because that catalogue is a STATIC list the host
# ships, not a probe of anything installed. `command -v claude` on the live
# box returned nothing.
#
# That is the failure mode this whole epic keeps hitting: a check that passes
# while measuring nothing. So the verification at the bottom of this script
# is deliberately not "is the binary present" and not "what version does it
# print" - it is a real inference round-trip through the real OS user with
# the real HOME. A version string proves the file downloaded; only a
# completed call proves the box can run an agent.
#
# Idempotent and safe to re-run on a live VM - it is the recovery path for an
# already-deployed box, not only a first-boot phase.
#
# Expects TRAYCER_OS_USER and TRAYCER_HOME_ROOT exported by the caller
# (bootstrap.sh does this; supply them by hand when re-running standalone).
set -euo pipefail

: "${TRAYCER_OS_USER:?TRAYCER_OS_USER must be exported by the caller}"
: "${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be exported by the caller}"
: "${TRAYCER_TENANT_IDS:=}"
# Kept overridable AND kept in sync with traycer-agent-probe.sh's own
# `TRAYCER_CLAUDE_ENV` default (A6 owns the monitoring, this script owns the
# wiring). If this path ever moves, both must move together or the probe goes
# false-red on a healthy box - which is exactly what happened once already.
: "${TRAYCER_CLAUDE_ENV:=/etc/traycer/claude.env}"

# --- the harness binary ---------------------------------------------------
#
# Installed to /usr/local, NOT the npm default prefix (/usr on this image).
# Two reasons, both checked on the live box rather than assumed:
#   1. /usr/local/bin is on the host process's own PATH - read straight out
#      of /proc/<host-pid>/environ, which is
#      `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin`. The
#      harness is spawned by that process, so PATH as the HOST sees it is the
#      only PATH that matters. A login-shell PATH would prove nothing: the
#      `traycer` OS user has /usr/sbin/nologin as its shell and never gets a
#      login shell at all.
#   2. It keeps an npm-managed tree out of /usr, which apt owns.
#
# @anthropic-ai/claude-code ships a self-contained native ELF binary (checked
# with `file -L`), so the harness has no dependency on the system Node
# version - npm is only a delivery mechanism.
#
# THE HARNESS SELF-UPDATES. Installed 2.1.197 and observed 2.1.220 running
# within the hour, without this script re-running. So the version this script
# installs is a floor, not a pin: do not treat a version mismatch against
# this line as evidence that provisioning did not run.
echo "agent-runtime: installing the Claude Code harness system-wide"
npm install -g --prefix /usr/local @anthropic-ai/claude-code

# --- which tenants to cover ----------------------------------------------
#
# The union of the caller's list AND whatever HOMEs actually exist on the box
# - NOT the caller's list alone. A tenant onboarded by hand (outside
# bootstrap.sh's `TRAYCER_TENANT_IDS` loop) is invisible to that variable, so
# a list-only loop silently skips the one tenant the box is actually running.
# That is not hypothetical: `traycer-health-probe@elliot.timer` was found
# disabled for exactly this reason - the only real tenant on this VM was
# onboarded outside the loop, so nothing had ever enabled its probe.
discovered=""
if [ -d "${TRAYCER_HOME_ROOT}" ]; then
  for home_dir in "${TRAYCER_HOME_ROOT}"/*; do
    [ -d "${home_dir}/.traycer" ] || continue
    discovered="${discovered} $(basename "${home_dir}")"
  done
fi
tenants="$(printf '%s %s' "${TRAYCER_TENANT_IDS}" "${discovered}" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
echo "agent-runtime: covering tenants:${tenants:- (none found)}"

for tenant_id in ${tenants}; do
  tenant_home="${TRAYCER_HOME_ROOT}/${tenant_id}"
  [ -d "$tenant_home" ] || continue
  # An agent needs a real directory to work in. A child agent created without
  # an explicit `--cwd` inherits its PARENT's working directory - and when the
  # parent is a desktop agent that is a Windows path which does not exist
  # here, so a phone-authored agent has nowhere valid to land without this.
  install -d -o "${TRAYCER_OS_USER}" -g "${TRAYCER_OS_USER}" -m 700 "${tenant_home}/work"
done

# --- verification ---------------------------------------------------------
#
# Runs as the real OS user with the real HOME. `sudo -u` is not decoration:
# root can run the binary while the `traycer` user cannot (permissions, or a
# HOME that was never initialised), and root is not who runs agents.
#
# THE CREDENTIAL IS AN ENVIRONMENT VARIABLE, NOT A FILE. `claude setup-token`
# prints a long-lived OAuth token and persists NOTHING - it reports
# "✓ Long-lived authentication token created successfully!" and leaves no
# `~/.claude/.credentials.json` behind, so `claude -p` still fails with
# "Not logged in" immediately afterwards. Authentication is therefore
# `CLAUDE_CODE_OAUTH_TOKEN` in the environment, sourced here from
# ${TRAYCER_CLAUDE_ENV}. An earlier revision of THIS script ran the check
# without it and reported NOT AUTHENTICATED against a perfectly healthy box.
echo "agent-runtime: verifying the harness executes as ${TRAYCER_OS_USER}"

claude_token=""
if [ -r "${TRAYCER_CLAUDE_ENV}" ]; then
  claude_token="$(sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN=//p' "${TRAYCER_CLAUDE_ENV}" | head -1)"
fi

for tenant_id in ${tenants}; do
  tenant_home="${TRAYCER_HOME_ROOT}/${tenant_id}"
  [ -d "$tenant_home" ] || continue

  if ! sudo -u "${TRAYCER_OS_USER}" env HOME="${tenant_home}" \
       /usr/local/bin/claude --version >/dev/null 2>&1; then
    echo "agent-runtime: FAILED - the harness will not execute as ${TRAYCER_OS_USER} with HOME=${tenant_home}" >&2
    exit 1
  fi

  # THE check: a trivial prompt, but a real one - it authenticates, reaches
  # the API, and returns a completion. This is what separates "installed"
  # from "able to run an agent".
  #
  # Verified to DISCRIMINATE, in one run, same binary/user/HOME, differing
  # only in the credential:
  #   with the token:    `ready`
  #   without the token: `Not logged in · Please run /login`
  # A verifier that passes in both states measures nothing, so this was
  # checked both ways rather than assumed from a single green.
  #
  # NON-FATAL by construction, exactly like bootstrap.sh's deploy-key phase:
  # a rebuilt VM has no credential yet (it cannot - a human must approve an
  # OAuth grant), and aborting cloud-init over an expected first-boot state
  # would take down ingress and host supervision that have nothing to do
  # with it.
  if [ -n "${claude_token}" ] && sudo -u "${TRAYCER_OS_USER}" \
       env HOME="${tenant_home}" CLAUDE_CODE_OAUTH_TOKEN="${claude_token}" \
       /usr/local/bin/claude -p 'Reply with the single word: ready' >/dev/null 2>&1; then
    echo "agent-runtime: ${tenant_id} - harness authenticated, completed a real call"
    # Configured is not delivered. A correct env file plus a host that
    # started BEFORE the file landed is a running harness with no credential.
    # A6's traycer-agent-probe.sh asserts the delivered half continuously;
    # this is the one-line reminder at provisioning time.
    echo "agent-runtime: ${tenant_id} - after ANY edit to ${TRAYCER_CLAUDE_ENV}, run: systemctl restart traycer-host@${tenant_id}"
  else
    cat >&2 <<AGENT_RUNTIME_AUTH_EOF
agent-runtime: ${tenant_id} - harness installed but NOT AUTHENTICATED.

  Expected on a rebuilt VM, and it cannot be automated from here: the
  credential is an OAuth grant against a Claude subscription, and nothing in
  this repo may hold it (see infra/azure/README.md, "Agent execution").

  No browser on this VM and no SSH, so drive the flow through a pty that
  survives between run-command invocations:

    tmux new-session -d -s claudeauth -x 400 -y 50 \\
      "sudo -u ${TRAYCER_OS_USER} env HOME=${tenant_home} TERM=xterm-256color \\
         /usr/local/bin/claude setup-token; sleep 3600"
    tmux capture-pane -p -J -t claudeauth        # read the sign-in URL

  A human opens that URL - SIGNED IN AS THE ACCOUNT WHOSE QUOTA THIS BOX
  SHOULD CONSUME, in a private window; an already-signed-in browser approves
  silently against the wrong account without ever showing a chooser - then:

    tmux send-keys -t claudeauth '<code>'        # the code, on its own
    tmux send-keys -t claudeauth Enter           # Enter SEPARATELY - batched
                                                 # with the text it is swallowed
    tmux capture-pane -p -J -t claudeauth        # read the printed token

  setup-token PRINTS the token and stores nothing, so install it yourself:

    umask 077 && install -d -m 700 /etc/traycer
    printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\\n' '<token>' > ${TRAYCER_CLAUDE_ENV}
    chmod 600 ${TRAYCER_CLAUDE_ENV} && chown root:root ${TRAYCER_CLAUDE_ENV}
    systemctl restart traycer-host@${tenant_id}   # REQUIRED - the host only
                                                  # picks the value up on start

  Then re-run this script to verify. Until it passes, the box serves the
  mobile client and lists epics but cannot execute an agent turn.
AGENT_RUNTIME_AUTH_EOF
  fi
done

echo "agent-runtime: done"
