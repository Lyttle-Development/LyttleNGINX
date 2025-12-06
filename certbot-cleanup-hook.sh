#!/bin/bash
# Don't use set -e - handle errors explicitly
# Log to stderr so certbot sees it
exec 2>&1

echo "[Cleanup Hook] Starting cleanup hook..."

TOKEN="${CERTBOT_TOKEN:-}"

if [ -z "$TOKEN" ]; then
    echo "[Cleanup Hook] ERROR: Missing CERTBOT_TOKEN"
    exit 1
fi

echo "[Cleanup Hook] Token: $TOKEN"

# Check DB credentials
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-}"
DB_USER="${DB_USER:-}"
DB_NAME="${DB_NAME:-}"

if [ -z "$DB_PASSWORD" ] || [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
    echo "[Cleanup Hook] ERROR: Missing database credentials"
    echo "[Cleanup Hook] DB_HOST='$DB_HOST', DB_PORT='$DB_PORT', DB_USER='$DB_USER', DB_NAME='$DB_NAME', DB_PASSWORD_SET=${DB_PASSWORD:+yes}"
    exit 1
fi

echo "[Cleanup Hook] Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# Escape single quotes in token
TOKEN_ESC="${TOKEN//\'/\'\'}"

# Remove challenge from database
echo "[Cleanup Hook] Deleting challenge from database..."

SQL_OUTPUT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 2>&1 <<EOSQL
DELETE FROM "AcmeChallenge" WHERE token = '$TOKEN_ESC';
EOSQL
)

SQL_EXIT_CODE=$?

echo "[Cleanup Hook] SQL exit code: $SQL_EXIT_CODE"
echo "[Cleanup Hook] SQL output: $SQL_OUTPUT"

if [ $SQL_EXIT_CODE -eq 0 ]; then
    echo "[Cleanup Hook] Challenge removed successfully"
    exit 0
else
    echo "[Cleanup Hook] ERROR: Failed to remove challenge (exit code: $SQL_EXIT_CODE)"
    exit 1
fi

