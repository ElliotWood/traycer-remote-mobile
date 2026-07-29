cat > /etc/systemd/system/traycer-host@.service <<'TRAYCER_UNIT_EOF'
UNIT_CONTENT_PLACEHOLDER
TRAYCER_UNIT_EOF
sed -i "s|__TRAYCER_OS_USER__|traycer|g; s|__TRAYCER_HOME_ROOT__|/srv/traycer/tenants|g" /etc/systemd/system/traycer-host@.service
systemctl daemon-reload
echo "fix-hostunit: applied"
