#!/bin/bash
# The one place an A6 alert-worthy event becomes a syslog line. Every
# caller (traycer-host-alert@.service on OnFailure=, the health-probe
# timer on functional-unreachable escalation) funnels through here so
# there is exactly one message shape for the Log Analytics query
# (infra/azure/bicep/modules/monitoring.bicep) to match - two differently
# shaped alert paths is how a query ends up covering one and silently
# missing the other.
#
# Uses `logger`, not a custom log file: Azure Monitor Agent's syslog data
# source (facility local0) is the standard, low-friction way to get
# application-level events into Log Analytics - see monitoring.bicep's
# module doc for why this was chosen over a custom-text-log DCR.
set -euo pipefail

TENANT_ID="${1:?traycer-alert.sh requires a tenant id as \$1}"
REASON="${2:?traycer-alert.sh requires a reason as \$2 (unit_failed | restart_loop | functional_unreachable)}"
DETAIL="${3:-}"

logger -t traycer-alert -p local0.crit \
  "tenant=${TENANT_ID} reason=${REASON} detail=${DETAIL}"
