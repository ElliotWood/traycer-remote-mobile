#!/bin/sh
# Rate-limit /push/ on the public ingress.
#
# `set -eu` only - see the note in vm-install-push-service.sh about dash and
# pipefail.
#
# ## Why /push/ specifically, and why it is not enough to say "it is public"
#
# Every route in `http-api.ts` requires a bearer, and `authorize()` validates it
# by calling `https://authn.traycer.ai` (`validateAuthTokenIdentityAccessOnly`).
# A MISSING bearer 401s locally with no outbound call; a bearer that is merely
# WRONG does not - `Authorization: Bearer x` from anyone on the internet costs
# this box one outbound HTTPS request to Traycer's production authn. That is
# amplification, not just load, and it lands on a service that is not ours to
# saturate. `client_max_body_size 16k` bounds the body and says nothing about
# the rate.
#
# ## Measured before writing this, because the config said otherwise
#
# `infra/azure/scripts/bootstrap.sh:291` puts
# `limit_req zone=traycer_ingress burst=20 nodelay` at SERVER level in the 443
# block, where nginx inherits it into every location - so on paper /push/ was
# already covered. THE LIVE BOX HAS NO SUCH LINE. Measured from off-box at
# 70-283 req/s (`scratch/checkin-1215/rate-limit-probe.mjs`):
#
#   /push/vapid-public-key   60 requests ->  60x 401,  0 limited
#   /next/index.html         60 requests ->  60x 200,  0 limited
#   /authn/api/v3/user       60 requests ->  13x 401, 47x 429   <- THE CONTROL
#
# The authn arm is the control and it is the reason the other two zeroes mean
# anything: it is the one location on the live box carrying its own `limit_req`,
# and it fired exactly as configured (burst 10 + ~3 replenished at 5r/s over
# 713ms = 13 through). Had it read zero as well, the probe would have been
# measuring its own request rate rather than the config.
#
# So `traycer_ingress` is a zone that is DEFINED AND NEVER USED, and everything
# except the authn allowlist is unlimited. This script closes /push/ only - see
# the deliberate non-fix at the bottom.
#
# ## Why 5r/s burst 10 is generous rather than cautious
#
# A client's entire real interaction with this service is TWO requests per
# session: `GET /vapid-public-key` then `POST /subscribe`
# (`push-subscription.ts`'s `ensurePushSubscription`). Even allowing for the
# re-post-on-key-mismatch path, a genuine user never reaches double figures in a
# minute. The budget matches the authn proxy's, which has been live since July
# and has never been reported inconveniencing a real signer-in - and unlike
# authn, this one guards a route with no allowlist in front of it.
#
# `limit_req_status 429` is not decoration: nginx's default for a limited
# request is 503, which reads as "the service fell over" in exactly the logs
# someone would check first.
set -eu

SITE="${SITE:-/etc/nginx/sites-available/traycer}"
LIMITS="${LIMITS:-/etc/nginx/conf.d/traycer-limits.conf}"
# NOT beside the file being backed up. `nginx.conf` globs `conf.d/*.conf`, so a
# `traycer-limits.conf.bak` is LOADED, and a second `limit_req_zone` for the
# same zone name fails the whole config with a message naming neither the
# duplicate nor the backup. bootstrap.sh records this trap costing one repair
# cycle already; sites-available is not globbed, conf.d is.
BACKUP_DIR="${BACKUP_DIR:-/root/nginx-backups}"
ZONE="${ZONE:-traycer_push}"
RATE="${RATE:-5r/s}"
BURST="${BURST:-10}"

if [ ! -f "$SITE" ]; then
  echo "REFUSING: $SITE does not exist" >&2
  exit 1
fi
if ! grep -q "location /push/" "$SITE"; then
  echo "REFUSING: no 'location /push/' in $SITE - run vm-nginx-push-route.sh first" >&2
  exit 1
fi
if grep -q "limit_req zone=${ZONE}" "$SITE"; then
  echo "already limited: 'limit_req zone=${ZONE}' exists in $SITE - leaving it alone"
  grep -n -A9 "location /push/" "$SITE"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%s)"
cp "$SITE" "${BACKUP_DIR}/traycer.site.${STAMP}"
cp "$LIMITS" "${BACKUP_DIR}/traycer-limits.conf.${STAMP}"
echo "backups: ${BACKUP_DIR}/traycer.site.${STAMP} ${BACKUP_DIR}/traycer-limits.conf.${STAMP}"

# 1. The zone, at http{} level. Separate from traycer_authn on purpose: shared
#    zone state is keyed per address, so an abuser burning /push/ would also
#    lock that address out of SIGN-IN. Two budgets, two failure domains.
if ! grep -q "zone=${ZONE}:" "$LIMITS"; then
  cat >> "$LIMITS" <<LIMITS_EOF

# /push/ - mobile-push-service. A wrong (not missing) bearer makes this box
# issue one outbound request to authn.traycer.ai per inbound request, so the
# rate here is an amplification control, not just a load one. Real usage is two
# requests per client per session; 5r/s is far above that.
limit_req_zone \$binary_remote_addr zone=${ZONE}:10m rate=${RATE};
LIMITS_EOF
  echo "zone ${ZONE} appended to $LIMITS"
else
  echo "zone ${ZONE} already present in $LIMITS"
fi

# 2. The directive, inside the existing location block. Anchored on the
#    proxy_pass line rather than on `location /push/ {` so the insertion lands
#    inside the block whichever way it was written.
awk -v zone="$ZONE" -v burst="$BURST" '
  /^[[:space:]]*proxy_pass http:\/\/127\.0\.0\.1:5276\/;[[:space:]]*$/ && !done {
    print
    print "        # See clients/mobile-push-service/deploy/vm-nginx-push-ratelimit.sh."
    print "        # 429, not nginx'"'"'s default 503: a limited request is not an outage."
    print "        limit_req zone=" zone " burst=" burst " nodelay;"
    print "        limit_req_status 429;"
    done = 1
    next
  }
  { print }
' "${BACKUP_DIR}/traycer.site.${STAMP}" > "$SITE"

if ! grep -q "limit_req zone=${ZONE}" "$SITE"; then
  echo "REFUSING: insertion produced no limit_req line - rolling back" >&2
  cp "${BACKUP_DIR}/traycer.site.${STAMP}" "$SITE"
  cp "${BACKUP_DIR}/traycer-limits.conf.${STAMP}" "$LIMITS"
  exit 1
fi

if ! nginx -t; then
  echo "generated config failed nginx -t - rolling back" >&2
  cp "${BACKUP_DIR}/traycer.site.${STAMP}" "$SITE"
  cp "${BACKUP_DIR}/traycer-limits.conf.${STAMP}" "$LIMITS"
  nginx -t >/dev/null 2>&1 && echo "rolled back, original config is valid" >&2
  exit 1
fi

systemctl reload nginx
echo "nginx reloaded"
grep -n -A9 "location /push/" "$SITE"

# ## DELIBERATELY NOT DONE HERE: the server-level limit the IaC intends
#
# Adding `limit_req zone=traycer_ingress burst=20 nodelay` at server level - what
# bootstrap.sh believes is already there - WOULD BREAK THE PWA THAT SHIPPED
# YESTERDAY, and the two facts have never been put side by side:
#
#   - the served `/next/sw.js` precaches 66 entries, counted in the SERVED bytes;
#   - `cache.addAll` fires them as one burst, and a single client was measured
#     at 283 req/s against `/next/` on this origin.
#
# 66 requests against burst=20 at 10r/s leaves ~46 of them 429ing, `addAll`
# rejects, `install` fails, and the app has no offline mode - reported by
# nothing, because a failed install is silent and the app still works online.
#
# That is a derivation from two measurements, not an end-to-end measurement, and
# it is why this script limits one route instead of the server. Whoever fixes
# the drift must size the static budget for a precache burst first.
