#!/usr/bin/env bash
# OSS-cleanliness gate for A4's deliverable (scripts/azure/ + the layout
# doc): no tenant names, internal hostnames, real hostIds, or real absolute
# user paths. Matches the discipline already established by the multihost
# rubric and this project's decision-log environment facts.
#
# Every pattern here is STRUCTURAL/GENERIC - it detects the SHAPE of a real
# secret (a tailnet domain suffix, a Tailscale CGNAT-range IP, a concrete
# POSIX home path, a concrete email address), never a specific project
# secret spelled out as a literal. A prior version of this gate hardcoded
# actual real values (a live machine hostname, a live host's real hostId, a
# real OS username, a real tailnet IP prefix) as its own "known bad" test
# vectors - which meant the gate itself shipped every secret it existed to
# catch, to an open-source repo, while reporting 0 failures. Caught in eval
# round 1. The fix is structural detection specifically so this file never
# needs to embed a real secret to prove it can catch one.
set -euo pipefail
# Scope: the whole A4 deliverable, not just scripts/azure/ - the layout doc
# under docs/deployment/ ships too and is exactly the kind of place a real
# hostname/IP/path ends up pasted into an example.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
scan_paths=(scripts/azure docs/deployment)

echo "=== oss-clean.test.sh (scanning: ${scan_paths[*]}) ==="

failures=0

# Bash-native line-prefixing (avoids an external `sed 's/^/    /'` per
# shellcheck SC2001's suggestion - a plain `${var//search/replace}` doesn't
# work here since these are anchored per-line, not a single substring).
indent() {
  local line
  while IFS= read -r line; do
    printf '    %s\n' "$line"
  done
}

# Self-exemption is still necessary and still correct here: every pattern
# below would match its OWN definition line in this file (the regex source
# text literally contains the shape it's looking for, e.g. the string
# "ts.net" appears inside the pattern `\.ts\.net`). That is expected and
# safe now, because nothing excluded is a real secret - it's the detector
# excluding its own pattern-definition text, the same way a lint rule's own
# source isn't flagged by the rule it implements.
check_pattern() {
  local description="$1" pattern="$2" glob="$3"
  local hits
  hits="$(grep -rnE "$pattern" --include="$glob" "${scan_paths[@]}" 2>/dev/null | grep -v '__tests__/oss-clean\.test\.sh' || true)"
  if [ -n "$hits" ]; then
    echo "  FAIL: ${description}"
    indent <<<"$hits"
    failures=$((failures + 1))
  else
    echo "  PASS: ${description}"
  fi
}

# Tailscale's real tailnet domain suffix - structural (any literal tailnet
# hostname reference has this shape), not this project's specific machine
# name.
check_pattern "no literal tailnet hostname (*.ts.net)" '[A-Za-z0-9-]+\.ts\.net' '*'

# Tailscale's CGNAT address range is 100.64.0.0/10 (100.64.x.x-100.127.x.x) -
# a structural fact about Tailscale's addressing scheme, not a specific
# project's IP. Matches the whole /10, not one project's observed prefix.
check_pattern "no literal Tailscale CGNAT-range IP (100.64.0.0/10)" \
  '100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+' '*'

# Windows user path shape - any drive-lettered \Users\<name>, not a
# specific username.
check_pattern "no hardcoded Windows user path (C:\\Users\\<name>)" \
  'C:\\\\Users\\\\[A-Za-z0-9_.-]+' '*'

# POSIX home path shape - any /home/<name> or /Users/<name>, EXCLUDING an
# explicit allow-list of documented placeholders that are fine to ship
# (used in examples throughout this deliverable's own doc/scripts).
posix_home_hits="$(grep -rnE '/(home|Users)/[A-Za-z0-9_.-]+' --include='*' "${scan_paths[@]}" 2>/dev/null \
  | grep -v '__tests__/oss-clean\.test\.sh' \
  | grep -vE '/(home|Users)/(identity|alice|bob|carol|dana|erin|<[A-Za-z-]+>|youruser|example)' \
  || true)"
if [ -n "$posix_home_hits" ]; then
  echo "  FAIL: no hardcoded /home/<realname> or /Users/<realname> outside the documented placeholder allow-list"
  indent <<<"$posix_home_hits"
  failures=$((failures + 1))
else
  echo "  PASS: no hardcoded /home/<realname> or /Users/<realname> outside the documented placeholder allow-list"
fi

# Excludes RFC 2606 reserved test domains (example.com/.org/.net/.test) -
# the standard, safe placeholder this suite's own git fixtures use
# (lib.sh's scratch repos are committed as "test@example.com").
email_hits="$(grep -rnE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' --include='*' "${scan_paths[@]}" 2>/dev/null \
  | grep -v '__tests__/oss-clean\.test\.sh' \
  | grep -vE '@[A-Za-z0-9.-]*\.(example|test)\.?(com|org|net)?\b|@example\.(com|org|net)\b' \
  || true)"
if [ -n "$email_hits" ]; then
  echo "  FAIL: no hardcoded email addresses (outside RFC 2606 example.com/.org/.net)"
  indent <<<"$email_hits"
  failures=$((failures + 1))
else
  echo "  PASS: no hardcoded email addresses (outside RFC 2606 example.com/.org/.net)"
fi

# NOTE, deliberately not a check: a real hostId (a UUID) cannot be detected
# structurally without also flagging every legitimate placeholder UUID this
# deliverable's own doc uses as an example - a generic "looks like a UUID"
# pattern would be all false positives or all false negatives depending on
# how it's scoped. The real defense against leaking one is not hardcoding
# one in the first place (the prior version of this file did exactly that,
# which is what round 1 caught) - enforced by review, not by this gate.

if [ "$failures" -eq 0 ]; then
  echo ""
  echo "oss-clean.test.sh: 0 failures"
  exit 0
else
  echo ""
  echo "oss-clean.test.sh: ${failures} failures"
  exit 1
fi
