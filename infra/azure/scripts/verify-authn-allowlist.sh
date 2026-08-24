#!/usr/bin/env bash
# Proves the /authn proxy is an ALLOWLIST and not a relay.
#
# The positive rows only prove the four endpoints the PWA needs still work.
# The NEGATIVE rows are the point: each uses a REAL authn path that would
# succeed through an open relay, so a 404 there proves the allowlist is
# actually enforcing rather than that the path happens not to exist upstream.
# A nonsense path would 404 either way and would prove nothing — that
# distinction is the whole reason this script exists rather than a curl.
#
# Usage: verify-authn-allowlist.sh <origin>   e.g. https://host.example.com
set -uo pipefail

ORIGIN="${1:?origin required, e.g. https://host.example.com}"
pass=0
fail=0

probe() {
  local desc="$1" path="$2" method="$3" expect="$4"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" \
    -H 'Content-Type: application/json' \
    --max-time 20 "${ORIGIN}${path}" 2>/dev/null || echo "000")"
  if [ "$code" = "$expect" ]; then
    echo "PASS  ${desc} -> ${code}"
    pass=$((pass + 1))
  else
    echo "FAIL  ${desc} -> ${code} (expected ${expect})"
    fail=$((fail + 1))
  fi
}

echo "--- allowed: the four endpoints the PWA actually calls ---"
# 401 (not 404) proves the request REACHED authn and was rejected on
# credentials — i.e. the proxy forwarded it. A 404 here would mean our own
# nginx refused it before it ever left the box.
probe "GET  /authn/api/v3/user (no bearer)"                 "/authn/api/v3/user"                  GET  401
# The device endpoints reject a malformed/absent body with a 4xx of their own.
# Asserting "not 404" is the meaningful claim; the exact code is authn's to
# choose and pinning it would make this test brittle against their changes.
for p in "/authn/api/v3/auth/device/authorize" "/authn/api/v3/auth/device/token" "/authn/api/v3/auth/refresh"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' \
    -H 'Content-Type: application/json' --max-time 20 "${ORIGIN}${p}" 2>/dev/null || echo "000")"
  if [ "$code" != "404" ] && [ "$code" != "000" ]; then
    echo "PASS  POST ${p} reached authn -> ${code} (not 404)"
    pass=$((pass + 1))
  else
    echo "FAIL  POST ${p} -> ${code} (404 means our nginx refused a path the PWA needs)"
    fail=$((fail + 1))
  fi
done

echo
echo "--- refused: REAL authn paths that an open relay would have forwarded ---"
probe "GET  /authn/api/v3/auth/exchange-code (desktop-only, not for mobile)" "/authn/api/v3/auth/exchange-code" GET 404
probe "GET  /authn/api/v3/organization"                     "/authn/api/v3/organization"          GET  404
probe "GET  /authn/api/v3/user/subscription"                "/authn/api/v3/user/subscription"     GET  404
probe "GET  /authn/ (bare prefix)"                          "/authn/"                             GET  404
echo "--- refused: suffix/traversal attempts against the anchored allowlist ---"
probe "GET  /authn/api/v3/users (plural, near-miss)"        "/authn/api/v3/users"                 GET  404
probe "GET  /authn/api/v3/user/extra"                       "/authn/api/v3/user/extra"            GET  404

echo
echo "--- unaffected: the rest of the site still serves ---"
probe "GET  / (PWA shell)"                                  "/"                                   GET  200
probe "GET  /nonexistent-xyz (catch-all still gone)"        "/nonexistent-xyz"                    GET  404

echo
echo "${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ] || exit 1
