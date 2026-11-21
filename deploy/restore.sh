#!/usr/bin/env bash
# Restore a backup file into the app's data volume:  deploy/restore.sh backups/dashboard-XXXX.db
# Stops the app, replaces the database, starts the app again.
#
# The restored DB only works with the SAME TOKEN_ENCRYPTION_KEY that was in use when it was
# written (provider tokens are encrypted with it). That key must be backed up separately and
# must never be stored together with the DB backup.
set -euo pipefail

FILE="${1:?usage: deploy/restore.sh <backup-file.db>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
COMPOSE=(docker compose -f deploy/docker-compose.yml)

"${COMPOSE[@]}" stop app
# Run a throwaway container on the same volume (the app container is stopped).
"${COMPOSE[@]}" run --rm --no-deps -T -v "$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE"):/restore/in.db:ro" --entrypoint sh app -c '
  set -e
  rm -f /data/dashboard.db-wal /data/dashboard.db-shm
  cp /restore/in.db /data/dashboard.db
'
"${COMPOSE[@]}" start app
echo "Restored $FILE. Verify with: docker compose -f deploy/docker-compose.yml logs app"
