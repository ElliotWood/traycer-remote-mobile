#!/usr/bin/env bash
# Reproduces the three Azure size limits that decide how this repo delivers
# its provisioning script - in about a minute, with NO resource group, NO
# virtual machine and NO public IP.
#
# WHY THIS EXISTS. Every one of these limits was originally found by building
# a throwaway VM and watching a deployment fail. That is a slow, billed,
# briefly-public way to learn a number, and the last attempt at it outlived
# the agent running it by 42 minutes with a public IP and nobody at the
# controls. None of it was necessary: a subscription-scoped deployment with
# `resources: []` and the expression under test in an `outputs` block
# exercises the same template engine and returns the same errors. It creates
# a deployment history record and nothing else.
#
# 🔴 AND `validate` PASSES ALL OF THEM. Each probe below is run through
# `az deployment sub validate` first, which returns "error": null every time,
# before `create` rejects it. That contrast is the point of the probe as much
# as the limits are: the vendor's own validator passes what the vendor's own
# deploy step refuses, so "validate was clean" is not evidence of anything
# about size. Do not delete the validate half as redundant.
#
# WHAT IT ESTABLISHES
#   1. A single expression whose RESULT exceeds 131,072 characters is refused.
#   2. `concat()` of two halves, each individually UNDER 131,072, is ALSO
#      refused - the limit is on the result, not on a literal segment. This is
#      the workaround that looks like it should work and does not, which is
#      why it is probed rather than described.
#   3. customData's own, separate, much lower cap of 87,380 base64 characters.
#      (Probed only as a size assertion here - it is enforced by the Compute
#      RP at VM-create time, which this deliberately does not do.)
#
# Read vm.bicep's provisioning comment for what follows from all this.
#
# Usage: infra/azure/scripts/probe-arm-expression-limit.sh [location]
# Requires: az, logged in. Cleans up its own deployment records.
set -euo pipefail

LOCATION="${1:-australiaeast}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Unique enough to not collide with a concurrent run, and greppable for
# cleanup if this script is killed before its own teardown.
STAMP="armlimit-$$"
CREATED=()

emit() { # emit <file> <variables-json> <output-expression>
  cat > "$1" <<EOF
{
  "\$schema": "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "variables": $2,
  "resources": [],
  "outputs": { "probe": { "type": "string", "value": "$3" } }
}
EOF
}

# `python3 -c` rather than a shell loop: 118 KB of "A" built with printf/seq
# in bash is slow enough to look like a hang.
rep() { python3 -c "import sys; sys.stdout.write('A' * int(sys.argv[1]))" "$1"; }

run_probe() { # run_probe <label> <template> <what-we-expect>
  local label="$1" tpl="$2" expectation="$3" name="${STAMP}-${1}"
  echo
  echo "=== ${label} — ${expectation}"

  # The whole response, then grep - NOT `--query properties.error`, which
  # renders a null error as an empty string and so reads identically to a
  # query that failed. "Clean" and "I could not tell" must not look the same
  # in a probe whose entire finding is that a validator said nothing.
  local vout
  vout="$(az deployment sub validate --location "$LOCATION" --name "${name}-v" \
    --template-file "$tpl" -o json 2>&1 || true)"
  if printf '%s' "$vout" | grep -qE '"error"[[:space:]]*:[[:space:]]*null'; then
    echo "  validate : \"error\": null — CLEAN (says nothing either way; compare with create below)"
  elif printf '%s' "$vout" | grep -qE '"error"'; then
    echo "  validate : reported an error — read it before trusting the create result:"
    printf '%s\n' "$vout" | grep -oE '"message"[[:space:]]*:[[:space:]]*"[^"]*"' | head -2 | sed 's/^/             /'
  else
    echo "  validate : could not determine (no \"error\" key in the response) — treat this probe as inconclusive"
  fi

  CREATED+=("$name")
  local cout
  if cout="$(az deployment sub create --location "$LOCATION" --name "$name" \
      --template-file "$tpl" --query "properties.outputs.probe.value" -o tsv 2>&1)"; then
    echo "  create   : ACCEPTED (result length ${#cout})"
  else
    # The message IS the deliverable here, not the exit code - the two
    # refusals this probe exists to contrast differ only in their wording.
    # So: never print an empty finding. If the specific pattern does not
    # match, dump what actually came back rather than a blank line, which
    # would read as "refused, no reason given" and hide a changed message.
    echo "  create   : REFUSED"
    local msg
    msg="$(printf '%s' "$cout" | grep -oE 'The (result of the )?template language expression[^"]*' | head -1)"
    if [ -n "$msg" ]; then
      printf '  error    : %s\n' "$msg"
    else
      echo "  error    : (no template-language-expression message found - raw response follows)"
      printf '%s\n' "$cout" | tail -c 600 | sed 's/^/             /'
    fi
  fi
}

echo "probe-arm-expression-limit: no resource group, no VM, no public IP - subscription-scoped deployments with resources: []"

# 1. One expression, over the limit.
rep 117940 > "$WORK/whole.txt"
printf '{ "whole": "%s" }' "$(cat "$WORK/whole.txt")" > "$WORK/vars1.json"
emit "$WORK/single.json" "$(cat "$WORK/vars1.json")" "[base64(variables('whole'))]"
run_probe "single" "$WORK/single.json" "one expression evaluating to 157,256 chars: expect REFUSED"

# 2. concat() of two halves, each individually under the limit. 58,970 raw ->
#    78,628 base64 each, which is comfortably under 131,072 on its own.
rep 58970 > "$WORK/half.txt"
printf '{ "a": "%s", "b": "%s" }' "$(cat "$WORK/half.txt")" "$(cat "$WORK/half.txt")" > "$WORK/vars2.json"
emit "$WORK/concat.json" "$(cat "$WORK/vars2.json")" "[concat(base64(variables('a')), base64(variables('b')))]"
run_probe "concat" "$WORK/concat.json" "TWO under-limit halves joined by concat(): expect REFUSED ANYWAY"

# 3. The negative control. Without this the two refusals above are consistent
#    with "this probe refuses everything", which is a shape this repo has
#    shipped before - a check that cannot pass proves as little as one that
#    cannot fail. 98,000 raw -> 130,668 base64, just under the limit.
rep 98000 > "$WORK/fits.txt"
printf '{ "fits": "%s" }' "$(cat "$WORK/fits.txt")" > "$WORK/vars3.json"
emit "$WORK/fits.json" "$(cat "$WORK/vars3.json")" "[base64(variables('fits'))]"
run_probe "fits" "$WORK/fits.json" "130,668 chars, just under: expect ACCEPTED"

echo
echo "cleaning up deployment records"
for n in "${CREATED[@]}"; do
  az deployment sub delete --name "$n" 2>/dev/null || true
  az deployment sub delete --name "${n}-v" 2>/dev/null || true
done
remaining="$(az deployment sub list --query "[?starts_with(name,'${STAMP}')].name" -o tsv)"
if [ -n "$remaining" ]; then
  echo "probe-arm-expression-limit: WARNING - records left behind, delete them: ${remaining}" >&2
  exit 1
fi
echo "probe-arm-expression-limit: done, no records left behind"
