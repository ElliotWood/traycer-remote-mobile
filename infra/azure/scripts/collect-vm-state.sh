#!/usr/bin/env bash
# Reports what is ACTUALLY on this VM, as JSON on stdout. Read-only.
#
# This is one half of the drift check; infra/azure/scripts/derive-expected-state.mjs
# is the other. The halves are kept rigorously independent:
#
#   - This script is never told which files to look for. It ENUMERATES the
#     provisioning directories by glob and reports whatever is there. That is
#     what lets the comparison see a file that exists on the box and in no
#     template - the exact shape of "the router ran here for a week and lived
#     in nobody's IaC", which a check that only verified an expected list
#     would have called clean every single time.
#   - It reads no manifest, no marker file, and nothing any deploy step wrote
#     to describe itself. Everything below is observed from the live system.
#
# WHY nginx IS REPORTED AS RESOLVED FACTS, NOT AS FILE HASHES. certbot
# rewrites the vhost after bootstrap.sh writes it, so its on-disk bytes are
# legitimately not the bytes the template emitted, and hashing it would be a
# permanent false red. What must match is the MEANING: which target
# `traycer_host` resolves to, and which locations the served vhost defines.
# `nginx -T` gives both with every `include` already followed - so it also
# proves the include chain actually reaches the upstream file, which reading
# that file directly would not.
#
# 🔴 `nginx -T` PARSES WHAT IS ON DISK, NOT WHAT THE RUNNING PROCESS LOADED.
# A config edited and never reloaded reads here as already in effect. That is
# why `listening` below is collected too: it reports which process actually
# holds the port `traycer_host` points at, from the kernel rather than from a
# config file. Config and reality disagreeing is itself a finding.
#
# Usage, from a workstation:
#   az vm run-command invoke -g <rg> -n <vm> --command-id RunShellScript \
#     --scripts @infra/azure/scripts/collect-vm-state.sh
set -uo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- files ----
# Globbed, not listed. A nullglob keeps an empty directory reporting as "no
# files" rather than as a literal glob string, which would then be hashed as a
# missing path and reported as an unreadable file.
shopt -s nullglob
: > "$WORK/files.txt"
for f in /usr/local/bin/*.sh /usr/local/lib/traycer/*.mjs /etc/systemd/system/traycer-*; do
  [ -f "$f" ] || continue
  printf '%s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f" >> "$WORK/files.txt"
done
shopt -u nullglob

# --------------------------------------------------------------- units -----
# 🔴 `systemctl list-unit-files` ALONE IS WRONG HERE, and it is wrong in the
# direction that produces false alarms. It reports unit FILES, so an instanced
# unit shows up only as its template - `traycer-host@.service  indirect` -
# and the enabled instances (`traycer-host@elliot.service`) appear nowhere in
# its output. The first version of this collector used it on its own and
# reported three enabled, running, correctly-configured units as not enabled.
# A drift check that cries wolf gets muted, which is the same outcome as
# having no drift check.
#
# So candidates are gathered from BOTH sources - the unit files, and the
# `.wants` symlinks that are what "enabled" actually means on disk - and then
# each is put to `systemctl is-enabled`, which is authoritative for instances
# and templates alike.
{
  systemctl list-unit-files 'traycer-*' --no-legend --no-pager 2>/dev/null | awk '{ print $1 }'
  find /etc/systemd/system -mindepth 2 -maxdepth 2 -path '*.target.wants/traycer-*' -printf '%f\n' 2>/dev/null
} | sort -u | while read -r unit; do
  # A template itself is never "enabled"; only its instances are. Skipping it
  # here keeps `indirect` out of the comparison rather than having to special-
  # case that word downstream.
  case "$unit" in *@.service|*@.timer|"") continue ;; esac
  state="$(systemctl is-enabled "$unit" 2>/dev/null)"
  # `enabled` and `enabled-runtime` both start with "enabled"; the latter
  # survives only until reboot, which on a box whose whole purpose is
  # surviving a rebuild is drift wearing the right word. Recorded verbatim so
  # the comparison can tell them apart rather than normalising them together.
  case "$state" in enabled*) printf '%s %s\n' "$unit" "$state" ;; esac
done > "$WORK/units.txt"

# --------------------------------------------------------------- nginx -----
nginx -T > "$WORK/nginx.conf" 2>"$WORK/nginx.err" || : > "$WORK/nginx.conf"

# -------------------------------------------------------------- sockets ----
# Resolved to the owning SYSTEMD UNIT, not just the process name, and that
# distinction is the whole value of this section. Every node process on this
# box reports as "node" - the tenant router, a tenant's host, and the relay it
# replaced are indistinguishable by process name, so a check built on that
# name could never tell "the router holds the upstream's port" from "one
# tenant's host does". /proc/<pid>/cgroup carries the unit, which can.
: > "$WORK/listen.txt"
while read -r addr pid; do
  unit=""
  if [ -n "$pid" ] && [ -r "/proc/${pid}/cgroup" ]; then
    unit="$(sed -n 's|.*/\([a-zA-Z0-9@.:_-]*\.service\).*|\1|p' "/proc/${pid}/cgroup" | head -1)"
  fi
  printf '%s\t%s\t%s\n' "$addr" "${pid:-?}" "${unit:-(no unit)}" >> "$WORK/listen.txt"
done < <(ss -ltnpH 2>/dev/null | sed -n 's/^.*LISTEN[[:space:]]\+[0-9]\+[[:space:]]\+[0-9]\+[[:space:]]\+\([^[:space:]]\+\).*pid=\([0-9]\+\).*$/\1 \2/p')

# --------------------------------------------------------------- emit ------
# node, not jq: jq is not guaranteed present on this box, node is (the host
# and the router both require it). Same reasoning as traycer-registry-generate.sh.
node -e '
const fs = require("fs");
const dir = process.argv[1];
const read = (n) => { try { return fs.readFileSync(dir + "/" + n, "utf8"); } catch { return ""; } };

const files = {};
for (const line of read("files.txt").split("\n")) {
  const m = /^([0-9a-f]{64}) (.+)$/.exec(line);
  if (m) files[m[2]] = m[1];
}

const enabledUnits = {};
for (const line of read("units.txt").split("\n")) {
  const [unit, state] = line.trim().split(/\s+/);
  if (unit) enabledUnits[unit] = state;
}

const conf = read("nginx.conf");

// Upstreams, with their server lines. Named-block parse rather than a global
// grep for "server": an nginx config is full of `server {` vhost blocks, and
// a grep would blend them into the upstream targets.
const upstreams = {};
const upRe = /upstream\s+(\S+)\s*\{([^}]*)\}/g;
for (let m; (m = upRe.exec(conf)); ) {
  upstreams[m[1]] = [...m[2].matchAll(/\bserver\s+([^;\s]+)\s*;/g)].map((s) => s[1]).sort();
}

// Locations declared in the TLS server block. Split on `listen` directives so
// a location from the port-80 redirect block is not attributed to the served
// vhost - the two have deliberately different location sets, and conflating
// them would let the phase-1 catch-all hide inside the phase-2 result.
const tlsBlocks = conf
  .split(/\bserver\s*\{/)
  .filter((b) => /\blisten\s+443\b/.test(b));
const locations = [
  ...new Set(tlsBlocks.flatMap((b) => [...b.matchAll(/^\s*location\s+(.+?)\s*\{/gm)].map((m) => m[1].trim()))),
].sort();

// Includes that resolved to nothing are worth seeing: an include whose glob
// matches zero files is valid nginx and silently contributes no routes.
const includes = [...new Set([...conf.matchAll(/^\s*include\s+([^;]+);/gm)].map((m) => m[1].trim()))].sort();

const listening = {};
for (const line of read("listen.txt").split("\n")) {
  const [addr, pid, unit] = line.split("\t");
  if (addr) listening[addr] = { pid, unit };
}

const doc = JSON.stringify({
  schema: "traycer-vm-state/1",
  files,
  enabledUnits,
  nginx: { upstreams, locations, includes, configReadable: conf.length > 0 },
  listening,
});

// 🔴 gzip + base64, NOT the JSON itself, and this is not premature
// compression. `az vm run-command invoke` TRUNCATES the message it returns -
// the first attempt at this collector came back as a document missing its
// opening brace and several files, i.e. a VM state that was wrong in the
// direction that reports MISSING files that are present. Truncating a
// compressed payload cannot produce a valid document, so a truncated run
// fails loudly at the decode instead of quietly at the comparison.
//
// The BEGIN/END markers exist for the same reason: they make truncation
// detectable rather than inferable, since run-command also wraps stdout in a
// "[stdout] ... [stderr]" envelope whose shape is not ours to rely on.
process.stdout.write("TRAYCER_VM_STATE_BEGIN\n");
process.stdout.write(require("zlib").gzipSync(Buffer.from(doc, "utf8"), { level: 9 }).toString("base64") + "\n");
process.stdout.write("TRAYCER_VM_STATE_END\n");
' "$WORK"
