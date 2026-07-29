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
# completed turn proves the box can run an agent.
#
# Idempotent and safe to re-run on a live VM - it is the recovery path for an
# already-deployed box, not only a first-boot phase.
#
# Expects TRAYCER_OS_USER and TRAYCER_HOME_ROOT exported by the caller
# (bootstrap.sh does this; supply them by hand when re-running standalone).
# TRAYCER_TENANT_IDS is optional - when set, each tenant's HOME is verified
# individually, because authentication is per-HOME (see below).
set -euo pipefail

: "${TRAYCER_OS_USER:?TRAYCER_OS_USER must be exported by the caller}"
: "${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be exported by the caller}"
: "${TRAYCER_TENANT_IDS:=}"

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
# with `file -L`: "ELF 64-bit LSB executable, dynamically linked"), so the
# harness itself has no dependency on the system Node version - only npm is
# used, as a delivery mechanism.
echo "agent-runtime: installing the Claude Code harness system-wide"
npm install -g --prefix /usr/local @anthropic-ai/claude-code

# --- per-tenant scaffolding ----------------------------------------------
#
# An agent needs a real directory to work in. A child agent created without
# an explicit `--cwd` inherits its PARENT's working directory - and when the
# parent is a desktop agent, that is a Windows path which does not exist
# here. Giving every tenant a real, writable, git-initialised work root means
# an agent authored from the phone has somewhere valid to land.
for tenant_id in ${TRAYCER_TENANT_IDS}; do
  tenant_home="${TRAYCER_HOME_ROOT}/${tenant_id}"
  [ -d "$tenant_home" ] || continue
  install -d -o "${TRAYCER_OS_USER}" -g "${TRAYCER_OS_USER}" -m 700 "${tenant_home}/work"
done

# --- verification ---------------------------------------------------------
#
# Runs as the real OS user with the real HOME. `sudo -u` is not decoration:
# root can run the binary while the `traycer` user cannot (permissions, or a
# HOME that was never initialised), and root is not who runs agents.
echo "agent-runtime: verifying the harness executes as ${TRAYCER_OS_USER}"
for tenant_id in ${TRAYCER_TENANT_IDS}; do
  tenant_home="${TRAYCER_HOME_ROOT}/${tenant_id}"
  [ -d "$tenant_home" ] || continue

  if ! sudo -u "${TRAYCER_OS_USER}" env HOME="${tenant_home}" \
       /usr/local/bin/claude --version >/dev/null 2>&1; then
    echo "agent-runtime: FAILED - the harness will not execute as ${TRAYCER_OS_USER} with HOME=${tenant_home}" >&2
    exit 1
  fi

  # THE check. A trivial prompt, but a real one: it authenticates, reaches
  # the API, and returns a completion. This is what distinguishes "installed"
  # from "able to run an agent", and it is the only step that can detect the
  # out-of-band auth (below) having never been done.
  #
  # NON-FATAL by construction, exactly like the deploy-key phase in
  # bootstrap.sh: an unauthenticated harness on a freshly rebuilt VM is the
  # EXPECTED first-boot state, and aborting cloud-init over it would take
  # down ingress and host supervision that have nothing to do with it. It
  # warns loudly instead - and the warning names the exact command to fix it.
  if sudo -u "${TRAYCER_OS_USER}" env HOME="${tenant_home}" \
       /usr/local/bin/claude -p 'Reply with the single word: ready' >/dev/null 2>&1; then
    echo "agent-runtime: ${tenant_id} - harness authenticated, completed a real turn"
  else
    cat >&2 <<AGENT_RUNTIME_AUTH_EOF
agent-runtime: ${tenant_id} - harness installed but NOT AUTHENTICATED.

  This is expected on a rebuilt VM and cannot be automated from here: the
  credential is an OAuth grant against a Claude subscription, and nothing in
  this repo may hold it (see infra/azure/README.md, "Agent execution").

  There is no browser on this VM and no SSH, so drive the flow through a pty
  that survives between run-command invocations:

    tmux new-session -d -s claudeauth \\
      "sudo -u ${TRAYCER_OS_USER} env HOME=${tenant_home} TERM=xterm-256color \\
         /usr/local/bin/claude setup-token; sleep 3600"
    tmux capture-pane -p -J -t claudeauth        # read the sign-in URL
    # ... a human opens that URL and approves, then:
    tmux send-keys -t claudeauth '<code>' Enter
    tmux capture-pane -p -J -t claudeauth        # confirm it took

  Then re-run this script to verify. Until it passes, the box serves the
  mobile client and lists epics but cannot execute an agent turn.
AGENT_RUNTIME_AUTH_EOF
  fi
done

echo "agent-runtime: done"
