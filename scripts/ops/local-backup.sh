#!/usr/bin/env bash
# Run as root on the primary server. Never connects to a public database host.
set -euo pipefail
umask 077

BACKUP_DIR=/home/skyseo/backups
PROJECT_DIR=/home/skyseo
DAILY_DIR="$BACKUP_DIR/daily"
WEEKLY_DIR="$BACKUP_DIR/weekly"
DB_NAME=skyseo_db
PG_SOCKET=/var/run/postgresql
WORK_DIR=
PARTIAL=

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$PARTIAL" ]]; then rm -f -- "$PARTIAL"; fi
  if [[ -n "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi
  if (( status != 0 )); then log "Backup failed; existing archives preserved" >&2; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if (( EUID != 0 )); then
  printf 'Run this script as root\n' >&2
  exit 1
fi
for command in flock runuser pg_dump pg_restore tar gzip find; do
  command -v "$command" >/dev/null
done
[[ -d "$PROJECT_DIR/skyseo_back" && -d "$PROJECT_DIR/skyseo_front" ]]
install -d -m 0700 "$BACKUP_DIR" "$DAILY_DIR" "$WEEKLY_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  log 'Another local backup is running; skipping this invocation'
  exit 0
fi

STAMP=$(date -u +%Y-%m-%d_%H-%M-%S)
DAILY_FILE="$DAILY_DIR/backup_$STAMP.tar.gz"
WEEKLY_FILE="$WEEKLY_DIR/weekly_$STAMP.tar.gz"
[[ ! -e "$DAILY_FILE" && ! -e "$WEEKLY_FILE" ]]
WORK_DIR=$(mktemp -d "$BACKUP_DIR/.backup-work.XXXXXX")
PARTIAL=$(mktemp "$DAILY_DIR/.backup_$STAMP.XXXXXX.tar.gz")
log 'Starting local PostgreSQL and source backup'

# Root opens the dump file; postgres only needs access to its local socket.
runuser -u postgres -- pg_dump \
  --host="$PG_SOCKET" --port=5432 --username=postgres \
  --format=custom --dbname="$DB_NAME" > "$WORK_DIR/db_skyseo.dump"
[[ -s "$WORK_DIR/db_skyseo.dump" ]]
pg_restore --list "$WORK_DIR/db_skyseo.dump" >/dev/null
{
  printf 'created_at_utc=%s\ndatabase=%s\ntransport=local_unix_socket\n' "$(date -u +%FT%TZ)" "$DB_NAME"
  pg_dump --version
  for project in skyseo_back skyseo_front; do
    revision=$(git -C "$PROJECT_DIR/$project" rev-parse HEAD 2>/dev/null || printf 'unknown')
    printf '%s_revision=%s\n' "$project" "$revision"
  done
} > "$WORK_DIR/manifest.txt"

# Include .env files needed for restoration. The archive and parent directories
# must remain private. Generated dependencies/builds can be rebuilt from source.
tar -czf "$PARTIAL" \
  --exclude='*/node_modules' --exclude='*/.next' --exclude='*/dist' \
  --exclude='*/.git' --exclude='*/.local-check-dist' --exclude='*/.cache' \
  --exclude='*/backups' --exclude='*/logs' \
  -C "$WORK_DIR" db_skyseo.dump manifest.txt \
  -C "$PROJECT_DIR" skyseo_back skyseo_front
gzip -t "$PARTIAL"
tar -tzf "$PARTIAL" >/dev/null
chmod 0600 "$PARTIAL"
mv -- "$PARTIAL" "$DAILY_FILE"
PARTIAL=
log "Daily backup verified and published: $DAILY_FILE ($(stat -c %s "$DAILY_FILE") bytes)"

# Preserve the existing Sunday schedule, using a hard link on the same disk.
if [[ "$(TZ=Europe/Moscow date +%u)" == 7 ]]; then
  ln -- "$DAILY_FILE" "$WEEKLY_FILE"
  log "Weekly backup published: $WEEKLY_FILE"
fi

# Keep the existing retention policy. Only prune after publishing a valid copy;
# named manual snapshots and unfinished files are outside these patterns.
find "$DAILY_DIR" -maxdepth 1 -type f -name 'backup_*.tar.gz' -mtime +7 -delete
find "$WEEKLY_DIR" -maxdepth 1 -type f -name 'weekly_*.tar.gz' -mtime +28 -delete
log 'Local backup completed'
