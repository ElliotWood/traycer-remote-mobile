#!/usr/bin/env bash
# Answers one question: does this VM match what the IaC in this repo would
# produce? Exits non-zero if not.
#
# THE FAILURE IT WAS BUILT FOR, in this repo's own words: A2's tenant router
# ran on the live VM for a week while nothing in the IaC installed it, so a
# rebuild would have silently reproduced the pre-A2 single-tenant relay with
# every check still green. Separately, the live VM's cloud-init payload was
# measured at 14,443 bytes and unchanged since 2026-07-29 - meaning every
# `infra/` commit after that date was, and is, unexercised. Neither of those
# was detectable by anything that existed; both are exactly what this reports.
#
# HOW IT AVOIDS BEING THE NEXT THING THAT DRIFTS. The two sides are derived
# independently and neither reads what the other wrote:
#
#   expected  derive-expected-state.mjs  compiles vm.bicep, evaluates its own
#                                        `provisionScript` expression, and
#                                        reads the heredocs out of the result.
#                                        It holds no list of files.
#   actual    collect-vm-state.sh        enumerates the provisioning
#                                        directories on the VM by glob and
#                                        reports whatever is there. It is
#                                        never told what to look for.
#
# There is no manifest, no marker file, and nothing either side wrote to
# describe itself. A stored manifest would have been simpler and would have
# relocated the drift into the manifest.
#
# WHAT IT CANNOT SEE, said plainly. A run-command runs as root and reports
# what the box says about itself; a root-level compromise could lie to it.
# It compares provisioned artifacts, not behaviour - the acceptance tests in
# infra/azure/README.md still have to be run. And `nginx -T` parses config
# from disk rather than from the running process, which is why the collector
# also reports who actually holds the upstream's port.
#
# Usage:
#   infra/azure/scripts/verify-iac-parity.sh \
#     --rg <resource-group> --vm <vm-name> \
#     --hostname <public-hostname> --email <acme-email> --tenants a,b [--repos ...]
#
# Nothing identifying is defaulted: passing the wrong hostname or tenant list
# silently changes the assembled script and every downstream hash, producing
# a wall of red for a reason nobody would think to look for. Requiring them
# is cheaper than debugging that once.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="${REPO_ROOT}/infra/azure/scripts"

RG=""; VM=""; HOSTNAME_ARG=""; EMAIL=""; TENANTS=""; REPOS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rg) RG="$2"; shift 2 ;;
    --vm) VM="$2"; shift 2 ;;
    --hostname) HOSTNAME_ARG="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --tenants) TENANTS="$2"; shift 2 ;;
    --repos) REPOS="$2"; shift 2 ;;
    *) echo "verify-iac-parity: unknown argument $1" >&2; exit 2 ;;
  esac
done
for pair in "rg:$RG" "vm:$VM" "hostname:$HOSTNAME_ARG" "email:$EMAIL" "tenants:$TENANTS"; do
  [ -n "${pair#*:}" ] || { echo "verify-iac-parity: --${pair%%:*} is required" >&2; exit 2; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 0. the tracked router bundle must not be stale ───────────────────────
# router/build.sh writes a TRACKED artifact rather than a dist/ one, because
# the VM has no TypeScript toolchain and the alternative was the status quo
# where the router existed on the box and nowhere in the deploy path. The
# honest cost of that choice is that it can go stale - so it is checked here
# rather than left for a reviewer to notice. Everything downstream hashes
# this file; a stale one would make the VM and the template agree on the
# wrong bytes.
echo "verify-iac-parity: 0/3 - is the tracked router bundle current?"
if bash "${REPO_ROOT}/infra/azure/router/build.sh" "$WORK/router-rebuilt.mjs" >/dev/null 2>&1; then
  if cmp -s "$WORK/router-rebuilt.mjs" "${REPO_ROOT}/infra/azure/router/tenant-router.generated.mjs"; then
    echo "  ok - tenant-router.generated.mjs matches a fresh build from tenant-router.ts"
  else
    echo "verify-iac-parity: FAIL - infra/azure/router/tenant-router.generated.mjs is STALE." >&2
    echo "  Rebuild it and commit the result: infra/azure/router/build.sh" >&2
    exit 1
  fi
else
  # Not fatal: bun is a developer tool and this check may run where it is
  # absent. Skipping loudly, because a silent skip is how a staleness gate
  # becomes decorative.
  echo "  SKIPPED - could not run router/build.sh (bun missing?). The bundle's freshness is UNVERIFIED in this run." >&2
fi

# ── 1. expected, from the template ───────────────────────────────────────
echo "verify-iac-parity: 1/3 - deriving the expected state from vm.bicep"
node "${SCRIPTS}/derive-expected-state.mjs" \
  --hostname "$HOSTNAME_ARG" --email "$EMAIL" --tenants "$TENANTS" ${REPOS:+--repos "$REPOS"} \
  > "$WORK/expected.json" || { echo "verify-iac-parity: could not derive the expected state" >&2; exit 2; }

# ── 2. actual, from the VM ───────────────────────────────────────────────
echo "verify-iac-parity: 2/3 - reading the actual state off ${VM}"
# `--scripts @file` rather than an inlined body: this repo's own notes record
# an 8191-character cmd.exe limit on this path, and the collector is longer
# than that.
az vm run-command invoke -g "$RG" -n "$VM" --command-id RunShellScript \
  --scripts "@${SCRIPTS}/collect-vm-state.sh" \
  --query "value[0].message" -o tsv > "$WORK/raw.txt" 2>"$WORK/az.err" || {
    echo "verify-iac-parity: az vm run-command failed" >&2
    cat "$WORK/az.err" >&2
    exit 2
  }

# 🔴 run-command TRUNCATES its returned message, and the first version of this
# check learned that the expensive way: a document that had lost its opening
# brace and several files, which would have reported present files as MISSING.
# So the collector returns gzip+base64 between explicit markers - truncation
# then cannot yield a decodable payload, and this fails loudly rather than
# comparing against a plausible-looking fragment.
node -e '
  const fs = require("fs"), zlib = require("zlib");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  const m = /TRAYCER_VM_STATE_BEGIN\s*\n([A-Za-z0-9+/=\s]+?)\nTRAYCER_VM_STATE_END/.exec(raw);
  if (!m) {
    process.stderr.write(
      "verify-iac-parity: the collector output is not a complete marked payload - most likely TRUNCATED by run-command.\n" +
      "Raw output (last 1500 chars):\n" + raw.slice(-1500) + "\n");
    process.exit(2);
  }
  let doc;
  try {
    doc = zlib.gunzipSync(Buffer.from(m[1].replace(/\s+/g, ""), "base64")).toString("utf8");
    JSON.parse(doc); // fail here rather than in the comparator
  } catch (err) {
    process.stderr.write("verify-iac-parity: could not decode the collector payload: " + err.message + "\n");
    process.exit(2);
  }
  fs.writeFileSync(process.argv[2], doc);
' "$WORK/raw.txt" "$WORK/actual.json" || exit 2

# ── 3. compare ───────────────────────────────────────────────────────────
echo "verify-iac-parity: 3/3 - comparing"
node "${SCRIPTS}/compare-vm-state.mjs" "$WORK/expected.json" "$WORK/actual.json"
rc=$?
if [ "$rc" -ne 0 ]; then
  # The documents are the evidence, and they are the first thing anyone will
  # want when a finding is disputed.
  cp "$WORK/expected.json" "$WORK/actual.json" . 2>/dev/null && \
    echo "verify-iac-parity: wrote expected.json and actual.json to the current directory for inspection" >&2
fi
exit "$rc"
