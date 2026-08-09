#!/bin/sh
echo "===== units ====="
for u in nginx traycer-host@elliot traycer-teams-bot traycer-push-service@elliot; do
  printf '%s: %s\n' "$u" "$(systemctl is-active $u 2>&1)"
done
echo "===== conf.d (nothing globbable added) ====="
ls -la /etc/nginx/conf.d/
echo "===== backups are OUTSIDE the glob ====="
ls -la /root/nginx-backups/ 2>&1
echo "===== nginx -t ====="
nginx -t 2>&1
echo "===== push service still subscribed to the host? ====="
PID=$(systemctl show -p MainPID --value traycer-push-service@elliot)
echo "MainPID=$PID"
ss -tnp 2>/dev/null | grep "pid=$PID" || echo "no socket found for pid $PID"
echo "===== host pid.json websocketUrl ====="
grep -o '"websocketUrl":"[^"]*"' /home/traycer/.traycer/host/pid.json 2>/dev/null || sudo -u traycer cat /home/traycer/.traycer/host/pid.json 2>&1 | head -c 400
