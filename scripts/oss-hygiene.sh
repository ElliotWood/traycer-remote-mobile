#!/usr/bin/env bash
# Repo-wide OSS hygiene gate: no machine-identifying strings in a public repo.
#
# WHY THIS EXISTS
# Every agent working this repo was asked to run an OSS-cleanliness grep scoped
# to its own package. Several did, and reported clean. Nobody owned the
# repo-wide invariant, so real hits accumulated across four files — including a
# live tailnet FQDN in a shipping config, not a test. A rule that relies on each
# contributor remembering to run it against the whole tree is not a gate; it is
# a hope. This is the gate.
#
# WHY THE PATTERNS ARE GENERIC
# A scanner that hardcodes the exact secrets it hunts has to exempt itself from
# its own scan — and the exempted file is then the one place the gate is blind.
# That already happened here: a checker printed "0 failures" while its own
# source carried a real host id, real usernames and a real tailnet name.
# Every pattern below is a SHAPE, never a literal value, so this file contains
# nothing sensitive and needs no self-exemption.
#
# WHY IT IS NARROW
# The first draft flagged ~100 deliberate placeholders (`/Users/me`,
# `/home/u`), SVG path data and a version string. A gate that cries wolf gets
# disabled, so it is tuned for high signal: real infrastructure identifiers, and
# home paths only when the username is not an obvious placeholder.
#
# Usage: scripts/oss-hygiene.sh    (exit 1 on any hit)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Usernames that are clearly synthetic. A path under one of these is a fixture,
# not a leak. Add here only when the name cannot identify a real person.
# `\.\.\.` covers prose that elides the username entirely (`C:\Users\...\file`),
# which is how docs and comments legitimately refer to a path shape.
PLACEHOLDER_USERS='me|them|dev|test|user|users|example|foo|bar|baz|u|alice|bob|someone|youruser|<user>|USERNAME|\.\.\.'

# description | extended-regex
PATTERNS=(
  # A tailscale magic-DNS name identifies a specific machine on a specific
  # tailnet. Highest signal of anything here — zero legitimate uses.
  "tailscale magic-DNS hostname|[A-Za-z0-9-]+\.tail[0-9a-f]+\.ts\.net"

  # Tailscale CGNAT range (100.64.0.0/10). Deliberately NOT generic RFC1918:
  # 10.x matched version strings and SVG coordinates in the first draft.
  # The negative lookahead skips CIDR notation — `100.64.0.0/10` names the
  # range itself, which docs and other scanners legitimately reference. Only a
  # bare host address identifies a machine.
  "tailscale CGNAT address|\b100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\b(?!/[0-9])"

  # Home paths whose username is NOT a known placeholder.
  "Windows home path with a real username|[A-Za-z]:\\\\Users\\\\(?!($PLACEHOLDER_USERS)\\\\)[A-Za-z0-9._-]+"
  "POSIX home path with a real username|/(home|Users)/(?!($PLACEHOLDER_USERS)/)[A-Za-z0-9._-]+/\.traycer"
)

EXCLUDES=(':!*.lock' ':!**/dist/**' ':!**/node_modules/**' ':!**/*.snap' ':!scripts/oss-hygiene.sh')

# Paths this fork authors. Upstream packages (gui-app, desktop, traycer-cli,
# protocol) carry their own maintainers' usernames in fixtures; those are
# inherited, not ours to rewrite, and flagging them would make the gate noise.
# The infrastructure patterns below are checked repo-wide regardless, because a
# tailnet name is wrong anywhere.
OWNED=(
  'clients/mobile' 'clients/mobile-push-service' 'clients/remote-bridge'
  'clients/teams-bot' 'clients/shared/identity-registry'
  'scripts/azure' 'docs/deployment'
)

fail=0
for entry in "${PATTERNS[@]}"; do
  desc="${entry%%|*}"
  rx="${entry#*|}"
  # Infrastructure identifiers are always wrong; home paths only in owned code.
  case "$desc" in
    *"home path"*) scope=("${OWNED[@]}") ;;
    *)             scope=(.) ;;
  esac
  # -P for lookahead (the placeholder exclusion); tracked files only.
  if hits=$(git grep -nIP "$rx" -- "${scope[@]}" "${EXCLUDES[@]}" 2>/dev/null); then
    printf '\n✗ %s\n' "$desc"
    printf '%s\n' "$hits" | sed 's/^/    /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "oss-hygiene: clean — no machine-identifying strings in tracked files"
  exit 0
fi

cat <<'MSG'

────────────────────────────────────────────────────────────────
This repository is public. The strings above identify a specific
machine, network or user account.

Replace with a placeholder, read from an env var, or commit a
fixture. Do NOT add an exemption for the offending file — that is
how the previous checker went blind. If a username here really is
synthetic, add it to PLACEHOLDER_USERS instead.
────────────────────────────────────────────────────────────────
MSG
exit 1
