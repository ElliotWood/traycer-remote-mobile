#!/usr/bin/env bash
# Checks that the drop-in `include` inserted by the two Teams ingress scripts
# lands in the right place in the vhost bootstrap.sh actually generates.
#
# ─── Why this exists ───
#
# The ingress scripts insert before the FIRST `location / {`. That anchor is
# in someone else's file (infra/azure/scripts/bootstrap.sh), it is matched by
# a regex, and the generated vhost has TWO `location / {` — the TLS block's
# catch-all and the port-80 redirect. Insert against the wrong one and the
# include lands in the :80 server, where /tab/ and /api/messages would be
# served over plain HTTP or not at all. Nothing on the box would report that
# as an error: nginx -t passes, the reload succeeds, and the routes 404.
#
# There is no nginx and no Linux VM in this worktree, so the *effect* cannot
# be measured here. What CAN be measured here is the thing most likely to be
# wrong and cheapest to get wrong silently: whether the anchor matches, how
# many times, and in which server block. That is what this asserts.
#
# ─── What this deliberately does NOT cover ───
#
#   * that nginx accepts an `include` with a glob matching ZERO files (the
#     rebuilt-VM state). Believed fine — nginx only hard-errors on a literal
#     filename that is missing — but BELIEVED, not measured. First rebuild
#     settles it; `nginx -t` on the box is the check.
#   * that `alias` + `try_files` behave identically from a drop-in as from an
#     inlined block. Same server context, so expected — again, not measured.
#   * anything about the bundle, the unit, or the secret. A route is not a
#     deployment.
#
# Run under Git Bash. Exits non-zero on failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BOOTSTRAP="$REPO_ROOT/infra/azure/scripts/bootstrap.sh"
TAB_SCRIPT="$REPO_ROOT/clients/teams-tab/deploy/vm-serve-tab.sh"
BOT_SCRIPT="$REPO_ROOT/clients/teams-bot/deploy/vm-bot-ingress.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0
pass() { echo "  ok    $1"; }
bad()  { echo "  FAIL  $1" >&2; fail=$((fail + 1)); }

# --- the vhost bootstrap.sh really generates -------------------------------
#
# Extracted from the heredoc rather than hand-copied: a hand-copied fixture
# stops being the thing under test the moment bootstrap.sh changes, and would
# then pass while the real anchor had moved.
awk '/cat > \/etc\/nginx\/sites-available\/traycer <<.TRAYCER_NGINX_TLS_EOF./{f=1;next} /^TRAYCER_NGINX_TLS_EOF$/{f=0} f' \
  "$BOOTSTRAP" > "$WORK/vhost.conf"

echo "=== fixture: the vhost bootstrap.sh generates ==="
if [ ! -s "$WORK/vhost.conf" ]; then
  bad "extracted an EMPTY vhost — the heredoc marker in bootstrap.sh moved"
  echo "$fail failure(s)"; exit 1
fi
anchors=$(grep -c '^[[:space:]]*location / {' "$WORK/vhost.conf")
echo "  $(wc -l < "$WORK/vhost.conf") lines, $anchors 'location / {' anchor(s)"
# A fixture with one anchor could not distinguish "matched the right one"
# from "matched the only one" — the hostile-fixture rule. Assert the shape
# the test needs before trusting any result from it.
[ "$anchors" -eq 2 ] || bad "expected 2 anchors (TLS catch-all + :80 redirect), found $anchors"

# --- the awk each script really runs ---------------------------------------
#
# Lifted from the scripts themselves, so an edit there that breaks the anchor
# is caught here. Verified to be present and identical in both first: a
# silently-empty extraction would run no awk at all and pass everything.
extract_awk() {
  awk '/^  awk .$/{f=1;next} f&&/SITE" > \/tmp\/traycer.new/{f=0} f' "$1"
}

for script in "$TAB_SCRIPT" "$BOT_SCRIPT"; do
  name="$(basename "$(dirname "$(dirname "$script")")")/$(basename "$script")"
  echo "=== $name ==="

  extract_awk "$script" > "$WORK/prog.awk"
  if [ ! -s "$WORK/prog.awk" ]; then
    bad "$name: could not extract the awk program — the script's shape changed"
    continue
  fi
  grep -q 'traycer-locations.d' "$WORK/prog.awk" \
    || bad "$name: extracted awk does not insert the include — wrong block extracted"

  awk -f "$WORK/prog.awk" "$WORK/vhost.conf" > "$WORK/after.conf" 2>"$WORK/awk.err"
  if [ -s "$WORK/awk.err" ]; then
    bad "$name: awk wrote to stderr: $(cat "$WORK/awk.err")"
  fi

  # (1) exactly one include, not zero and not one per anchor
  n=$(grep -c 'include /etc/nginx/traycer-locations.d/\*\.conf;' "$WORK/after.conf")
  [ "$n" -eq 1 ] && pass "include inserted exactly once" \
                 || bad "$name: include appears $n time(s), expected 1"

  # (2) in the TLS block, NOT the :80 redirect.
  #
  #     ⚠️ This started as "the include must come before the `listen 80`
  #     line" and that assertion was WORTHLESS: a mutation that re-anchored
  #     the awk onto `listen 80;` inserts IMMEDIATELY BEFORE it, which is
  #     "before listen 80" and passed green. It survived only because the
  #     no-anchor case below happened to catch the same mutation — incidental
  #     coverage, which is the shape that reads as a working check right up
  #     until the unrelated thing holding it up moves.
  #
  #     Counting `server {` openings before the include is the discriminating
  #     form: the TLS block is the first, the redirect is the second, and
  #     "immediately before listen 80" now lands at 2 and fails.
  inc_line=$(grep -n 'traycer-locations.d' "$WORK/after.conf" | head -1 | cut -d: -f1)
  if [ -z "$inc_line" ]; then
    bad "$name: could not locate the include in the output"
  else
    blocks=$(head -n "$inc_line" "$WORK/after.conf" | grep -c '^server {')
    [ "$blocks" -eq 1 ] \
      && pass "include is inside the FIRST server block, the TLS one (line $inc_line)" \
      || bad "$name: include at line $inc_line is inside server block #$blocks, expected #1 (the TLS block)"
  fi

  # (3) nothing else moved. The awk prints every line it does not act on, so
  #     the output must be the input plus exactly the inserted lines.
  added=$(( $(wc -l < "$WORK/after.conf") - $(wc -l < "$WORK/vhost.conf") ))
  [ "$added" -eq 5 ] && pass "added exactly 5 lines (3 comment + include + blank)" \
                     || bad "$name: line count moved by $added, expected 5"
  removed=$(grep -vxF -f "$WORK/after.conf" "$WORK/vhost.conf" | wc -l)
  [ "$removed" -eq 0 ] && pass "no original line dropped" \
                       || bad "$name: $removed original line(s) missing from the output"

  # (4) the guard fires when the anchor is absent. Without this the whole
  #     suite is compatible with an awk that matches nothing and a script that
  #     ships an unmodified config while reporting success.
  #     "No include in the output" is ALSO true of an awk that crashed and
  #     wrote nothing — this check read green during a run where the awk
  #     program failed to parse. So assert the pass-through too: the output
  #     must be the input, byte for byte, not merely include-free.
  grep -v '^[[:space:]]*location / {' "$WORK/vhost.conf" > "$WORK/noanchor.conf"
  awk -f "$WORK/prog.awk" "$WORK/noanchor.conf" > "$WORK/noanchor.after" 2>/dev/null
  if grep -q 'traycer-locations.d' "$WORK/noanchor.after"; then
    bad "$name: inserted an include into a config with NO anchor"
  elif ! cmp -s "$WORK/noanchor.conf" "$WORK/noanchor.after"; then
    bad "$name: no-anchor output differs from its input — the awk did not pass through"
  else
    pass "no anchor -> unmodified pass-through (the script's grep guard then aborts)"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "ingress anchor: all checks passed."
  echo "NOT COVERED: that nginx accepts the resulting config, that a zero-match"
  echo "glob is legal, or that anything is actually served. This is anchor"
  echo "placement only — the box is the only place the rest can be measured."
else
  echo "ingress anchor: $fail check(s) FAILED." >&2
fi
exit $(( fail > 0 ? 1 : 0 ))
