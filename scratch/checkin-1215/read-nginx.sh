#!/bin/sh
echo "===== nginx -v ====="
nginx -v 2>&1
echo "===== conf.d listing ====="
ls -la /etc/nginx/conf.d/
echo "===== traycer-limits.conf ====="
cat /etc/nginx/conf.d/traycer-limits.conf 2>&1
echo "===== sites-enabled listing ====="
ls -la /etc/nginx/sites-enabled/
echo "===== SITE: limit_req / location lines with numbers ====="
grep -n -E 'limit_req|location |server |client_max_body_size|listen ' /etc/nginx/sites-available/traycer
echo "===== traycer-locations.d ====="
ls -la /etc/nginx/traycer-locations.d/ 2>&1
for f in /etc/nginx/traycer-locations.d/*; do echo "--- $f ---"; cat "$f"; done 2>/dev/null
echo "===== push location block ====="
grep -n -A12 'location /push/' /etc/nginx/sites-available/traycer
echo "===== units ====="
systemctl is-active nginx traycer-host@elliot traycer-teams-bot traycer-push-service@elliot 2>&1
