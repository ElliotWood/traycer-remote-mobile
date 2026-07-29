#!/usr/bin/env bash
# scratch helper (not committed): run a local script file on the Azure VM via run-command
# usage: ./vmrun.sh path/to/script.sh
set -euo pipefail
AZ="/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd"
B64=$(base64 -w0 "$1")
"$AZ" vm run-command invoke \
  -g altra-rg-traycer-aue -n altra-vm-traycer-host-aue \
  --command-id RunShellScript \
  --scripts "echo $B64 | base64 -d > /tmp/_vmrun.sh; bash /tmp/_vmrun.sh 2>&1" \
  --query "value[0].message" -o tsv
