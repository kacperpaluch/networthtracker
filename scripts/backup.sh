#!/bin/sh
set -eu

source_db="/data/networth.db"
backup_dir="/backups"
retention_days="${BACKUP_RETENTION_DAYS:-7}"

if [ ! -f "$source_db" ]; then
  echo "[backup] Nie znaleziono bazy: $source_db"
  exit 1
fi

mkdir -p "$backup_dir"
timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
target_file="$backup_dir/networthtracker-$timestamp.db"
temporary_file="$backup_dir/.networthtracker-$timestamp.tmp"

sqlite3 "$source_db" ".timeout 10000" ".backup '$temporary_file'"

integrity_result="$(sqlite3 "$temporary_file" "PRAGMA integrity_check;")"
if [ "$integrity_result" != "ok" ]; then
  rm -f "$temporary_file"
  echo "[backup] Kontrola integralności nie powiodła się: $integrity_result"
  exit 1
fi

mv "$temporary_file" "$target_file"
find "$backup_dir" -type f -name 'networthtracker-*.db' -mtime "+$retention_days" -delete
echo "[backup] Utworzono $target_file"
