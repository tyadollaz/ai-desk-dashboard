#!/usr/bin/env bash
# Online backup of the SQLite database to ./backups/dashboard-<UTC timestamp>.db
# Run from the repository root:  deploy/backup.sh [output-dir]
#
# IMPORTANT: encrypted provider tokens in the DB are useless without TOKEN_ENCRYPTION_KEY.
# Back that key up SEPARATELY (e.g. a password manager). NEVER store it alongside the DB
# backup, otherwise a leaked backup exposes the tokens.
set -euo pipefail

OUT_DIR="${1:-backups}"
COMPOSE=(docker compose -f deploy/docker-compose.yml)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/dashboard-$STAMP.db"
mkdir -p "$OUT_DIR"

# Uses better-sqlite3's db.backup() inside the container: consistent even while the app writes.
# The backup is written inside the volume first, then copied out.
"${COMPOSE[@]}" exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database(process.env.DATABASE_PATH || "/data/dashboard.db", { readonly: true });
db.backup("/data/backup.tmp.db").then(() => { db.close(); }).catch((e) => { console.error(e.message); process.exit(1); });
'
"${COMPOSE[@]}" cp app:/data/backup.tmp.db "$DEST"
"${COMPOSE[@]}" exec -T app rm -f /data/backup.tmp.db
chmod 600 "$DEST"
echo "Backup written to $DEST"
echo "Reminder: TOKEN_ENCRYPTION_KEY is NOT included. Store it separately."
