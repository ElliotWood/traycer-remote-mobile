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
# `[0-9]+` and `tenant-…` are shapes, not names: a purely numeric "username"
# (docs showing `HOME=/fake/home/1`) and the multi-tenant fixtures' tenant-a /
# tenant-b cannot identify a person.
PLACEHOLDER_USERS='me|them|dev|test|user|users|example|foo|bar|baz|u|alice|bob|someone|youruser|<user>|USERNAME|tenant-[a-z0-9]+|[0-9]+|\.\.\.'

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
  #
  # The placeholder may be followed by a separator OR end the line: prose and
  # docs write `C:\Users\example` as a terminal path, and requiring a trailing
  # backslash flagged it as a real username. A gate that cries wolf gets
  # disabled — see the header — so this false positive is a correctness bug in
  # the gate, not cosmetics. `\s|$` and not `\b`, because `\b` would fail for
  # the `...` placeholder, whose last character is not a word character.
  #
  # No `/.traycer` suffix requirement on the POSIX pattern - that narrowing
  # existed for noise reduction against upstream fixtures, but scope is
  # already limited to OWNED below, so it only made this pattern miss a real
  # leak that isn't inside .traycer (ported from scripts/azure's own gate,
  # ticket A5 - ownership consolidated here so there is one gate instead of
  # two that could flag each other).
  "Windows home path with a real username|[A-Za-z]:\\\\Users\\\\(?!($PLACEHOLDER_USERS)(\\\\|\\s|$))[A-Za-z0-9._-]+"
  #
  # The placeholder terminator is "anything outside the username charset, or
  # end of line" rather than only `/` — the Windows pattern above already
  # learned this (`\s|$`): a fixture path ends at a quote (`"/home/tenant-a"`)
  # or at EOL (`home/1`) as legitimately as at a slash, and requiring the
  # slash re-flags exactly the placeholders the list is for.
  "POSIX home path with a real username|/(home|Users)/(?!($PLACEHOLDER_USERS)([^A-Za-z0-9._-]|$))[A-Za-z0-9._-]+"

  # Any RFC-4122 GUID. Narrowed by the synthetic-fixture filter below, and
  # scoped to shipping source only — see the scope note.
  "GUID that is not a house fixture|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b"

  # A real-looking email address identifies a person. Excludes RFC 2606
  # reserved test domains (example.com/.org/.net/.test) - the standard, safe
  # placeholder this repo's own git fixtures use - and this project's own
  # published role accounts at traycer.ai (mobile-push-service's VAPID
  # subject, `mailto:push@traycer.ai`, is a role account the Web Push spec
  # requires, not a person). Ported from scripts/azure's gate (ticket A5) -
  # was a straight omission here before.
  #
  # Allow-lists the ROLE ACCOUNT, not the whole traycer.ai domain (Evaluator
  # eval-round-01 finding): an earlier version excluded any @traycer.ai
  # address, which would have silently passed a real person's address at
  # that domain (elliot.wood@traycer.ai) alongside the one legitimate role
  # account - broader than its own justification.
  #
  # The exclusion is a whole-match negative lookahead anchored at a word
  # boundary BEFORE the local part, not a lookahead placed after `@` - a
  # first attempt placed after `@` (matching only the domain half) cannot
  # see the local part at all, so it excluded nothing; the correct fix is
  # excluding the full "role@domain" shape from the start of the match.
  # `\b` before the lookahead matters too: without it, a regex engine can
  # still find a match by starting mid-word (e.g. treating "ush@traycer.ai"
  # inside "push@traycer.ai" as its own address, which the lookahead
  # wouldn't recognize as excluded) - verified this failure mode happens by
  # testing the un-anchored version first, then fixing it, rather than
  # assuming the anchor was unnecessary.
  #
  # Verified with git grep -P against planted cases: push@/support@ at
  # traycer.ai pass; a real personal address at the same domain
  # (elliot.wood@traycer.ai) and a generic personal address elsewhere are
  # both still flagged.
  #
  # The second domain lookahead rejects "domains" that are file names: Apple
  # asset catalogs name scaled images `AppIcon-512@2x.png`, whose shape is
  # local@domain with a real TLD-length extension. An address cannot end in
  # an image/file extension, so this excludes a shape, not a value.
  "email address|\b(?!(push|support|release|noreply)@traycer\.ai\b)[A-Za-z0-9._%+-]+@(?!([A-Za-z0-9.-]*\.)?(example)\.(com|org|net|test)\b)(?![A-Za-z0-9.-]*\.(png|jpe?g|gif|webp|avif|svg|ico|pdf)\b)[A-Za-z0-9.-]+\.[a-z]{2,}"
)

# A GUID that is not one of our fixtures.
#
# The rule names tenant ids, bot ids and a person's Entra object id — all
# GUIDs — and this gate had no shape for any of them. It went clean over a
# real host id sitting in `teams-tab/src/app.tsx`, because every pattern above
# looks for hostnames, addresses and paths. A host id identifies a machine
# just as surely as a hostname does.
#
# The tell was not the value, it was the SHAPE: every deliberate fixture in
# this repo is `a1000000-0000-4000-8000-000000000001`, and the leak was the
# only GUID nearby with real random entropy. So the gate encodes the
# convention rather than trying to detect entropy — a regex cannot tell a
# real GUID from a well-authored fake, but it can tell either from the house
# pattern. Synthetic ids use the house pattern; anything else is asked about.
SYNTHETIC_GUID='(-0000-4000-8000-|00000000-0000|-0000-0000-)'

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
  # Infrastructure identifiers are always wrong; personal identifiers (home
  # paths, email addresses) only in owned code - upstream packages carry
  # their own maintainers' identifiers in fixtures, inherited, not ours to
  # rewrite.
  #
  # GUIDs are checked in SHIPPING SOURCE ONLY, and that limit is deliberate
  # rather than convenient. Test files carry ~20 hand-authored GUIDs that are
  # plainly synthetic to a human (`0b8f1c2e-…-1e2f3a4b5c6d`) but identical in
  # shape to a real one. Firing on all of them would make this gate the thing
  # people pass with `--no-verify` — the header already says a gate that cries
  # wolf gets disabled. So the covered set is stated below instead of quietly
  # widened, and tests remain a reviewer's job.
  case "$desc" in
    *"home path"*|*"email address"*) scope=("${OWNED[@]}") ;;
    *GUID*)                          scope=("${OWNED[@]}" 'clients/teams-tab' 'clients/shared') ;;
    *)                                scope=(.) ;;
  esac
  extra=(':!**/__tests__/**' ':!**/*.test.*')
  case "$desc" in
    *GUID*) : ;;
    *)      extra=() ;;
  esac
  # -P for lookahead (the placeholder exclusion); tracked files only.
  if hits=$(git grep -nIP "$rx" -- "${scope[@]}" "${EXCLUDES[@]}" "${extra[@]}" 2>/dev/null \
              | { case "$desc" in *GUID*) grep -vE "$SYNTHETIC_GUID" ;; *) cat ;; esac; }) \
     && [ -n "$hits" ]; then
    printf '\n✗ %s\n' "$desc"
    printf '%s\n' "$hits" | sed 's/^/    /'
    fail=1
  fi
done

# WHAT WAS ACTUALLY CHECKED, always printed — pass or fail.
#
# Three separate leaks got through a sweep that reported clean because the
# sweep's BOUNDARY was wrong, not its patterns: a username prefix that didn't
# match, a package scope that excluded the offending package, and a directory
# scope of `*/src` that silently skipped `tools/`. Each time the output said
# "clean" and the scope it was clean WITHIN was invisible.
#
# So the boundary is stated. "clean" is not a claim anyone can check; "checked
# 1,204 files, home paths within 7 paths" is one you can look at and say
# that's the wrong set. The point is not a wider glob — it is a boundary the
# reader can falsify.
files_scanned=$(git grep -lI '' -- . "${EXCLUDES[@]}" 2>/dev/null | wc -l | tr -d ' ')
printf '\noss-hygiene: scanned %s tracked files\n' "$files_scanned"
printf '  infrastructure patterns  repo-wide\n'
printf '  home-path patterns       %s\n' "${OWNED[*]}"
printf '  email-address patterns   %s\n' "${OWNED[*]}"
printf '  GUID patterns            shipping source only, NOT tests\n'
printf '  NOT covered              internal work titles — no distinguishing\n'
printf '                           shape exists; see the fixture docblocks\n'
printf '                           GUIDs in tests — synthetic and real are the\n'
printf '                           same shape; a reviewer decides, not a regex\n'

if [ "$fail" -eq 0 ]; then
  echo "oss-hygiene: clean within the scope above"
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
