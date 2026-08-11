#!/bin/sh
set -eu

schedule="${BACKUP_CRON:-0 3 * * *}"
timezone="${TZ:-Europe/Warsaw}"

if [ -f "/usr/share/zoneinfo/$timezone" ]; then
  ln -snf "/usr/share/zoneinfo/$timezone" /etc/localtime
  printf '%s\n' "$timezone" > /etc/timezone
fi

# Cron nie dziedziczy środowiska kontenera — retencję trzeba wpisać do crontaba.
printf 'BACKUP_RETENTION_DAYS=%s\n%s root /app/scripts/backup.sh >> /proc/1/fd/1 2>&1\n' \
  "${BACKUP_RETENTION_DAYS:-7}" "$schedule" \
  > /etc/cron.d/networthtracker-backup
chmod 0644 /etc/cron.d/networthtracker-backup

if [ "${RUN_BACKUP_ON_START:-true}" = "true" ] && [ -f /data/networth.db ]; then
  /app/scripts/backup.sh
elif [ "${RUN_BACKUP_ON_START:-true}" = "true" ]; then
  echo "[backup] Pierwszy start — backup rozpocznie się po utworzeniu bazy"
fi

cron
echo "[backup] Harmonogram: $schedule ($timezone)"

exec "$@"
