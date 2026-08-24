#!/usr/bin/env bash
# Generates /srv/traycer/identity-registry.json from the tenants actually
# provisioned on this VM.
#
# WHY GENERATED, NOT COMMITTED: the mapping's key is a real person's Traycer
# user id. Committing that to an open-source repo is both an OSS-cleanliness
# violation and a privacy one, and a hand-maintained copy would silently drift
# from who is actually signed in. So the mapping is DERIVED from each tenant's
# own credentials file - the same file the host reads to pin its owner - which
# makes "the registry says alice" and "alice's host is pinned to alice"
# the same fact rather than two facts that can disagree.
#
# A tenant with no credentials file is SKIPPED, not defaulted: nobody is signed
# in as them, so there is no identity to route and an entry would be a guess.
#
# Usage: traycer-registry-generate.sh [output-path]
set -euo pipefail

TENANT_ROOT="${TRAYCER_TENANT_ROOT:-/srv/traycer/tenants}"
OUT="${1:-/srv/traycer/identity-registry.json}"

entries=""
skipped=""
for dir in "$TENANT_ROOT"/*/; do
  [ -d "$dir" ] || continue
  tenant="$(basename "$dir")"
  creds="${dir}.traycer/cli/credentials"

  if [ ! -r "$creds" ]; then
    skipped="${skipped} ${tenant}(no-credentials)"
    continue
  fi

  # node, not jq: jq is not guaranteed present and node already is (the host
  # and the router both need it).
  user_id="$(node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const id = c?.user?.id;
      if (typeof id === "string" && id.length > 0) process.stdout.write(id);
    } catch { /* unreadable or malformed -> empty, handled below */ }
  ' "$creds" 2>/dev/null || true)"

  if [ -z "$user_id" ]; then
    skipped="${skipped} ${tenant}(unreadable-user-id)"
    continue
  fi

  # hostId is what A4 puts in git branch names, so it must satisfy that
  # charset. Refuse rather than sanitise: a tenant directory named outside it
  # is an provisioning error to fix, not something to silently rewrite.
  if ! printf '%s' "$tenant" | grep -qE '^[a-z0-9][a-z0-9-]{0,63}$'; then
    echo "registry-generate: refusing - tenant directory '${tenant}' is not a valid hostId ([a-z0-9][a-z0-9-]{0,63})" >&2
    exit 1
  fi

  [ -n "$entries" ] && entries="${entries},"
  entries="${entries}
    { \"home\": \"${dir%/}\", \"hostId\": \"${tenant}\", \"traycerUserId\": \"${user_id}\" }"
done

if [ -z "$entries" ]; then
  echo "registry-generate: refusing - no tenant has readable credentials, and an empty registry would route nobody" >&2
  exit 1
fi

tmp="$(mktemp)"
printf '{\n  "tenants": [%s\n  ]\n}\n' "$entries" > "$tmp"

# The router validates this far more strictly than this script does (duplicate
# aliases, duplicate homes case-insensitively, charset, whitespace). Parsing it
# here is only a syntax pre-check so an obviously broken file never lands.
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$tmp"

install -m 0644 "$tmp" "$OUT"
rm -f "$tmp"

echo "registry-generate: wrote ${OUT}" >&2
[ -n "$skipped" ] && echo "registry-generate: skipped (no identity to route):${skipped}" >&2
exit 0
