#!/bin/bash
# Don't exit on error immediately - we need to handle errors gracefully
set -u  # Exit on undefined variables

# Certbot Cleanup Hook - Removes ACME challenge from database
# This script is called by certbot after certificate issuance

echo "[Cleanup Hook] Starting cleanup hook..." >&2

TOKEN="${CERTBOT_TOKEN:-}"

if [ -z "$TOKEN" ]; then
    echo "[Cleanup Hook] ERROR: Missing CERTBOT_TOKEN" >&2
    exit 1
fi

echo "[Cleanup Hook] Removing challenge: $TOKEN" >&2

# Check DB credentials
if [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_HOST:-}" ] || [ -z "${DB_PORT:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
    echo "[Cleanup Hook] ERROR: Missing database credentials" >&2
    echo "[Cleanup Hook] DB_HOST=${DB_HOST:-empty}, DB_PORT=${DB_PORT:-empty}, DB_USER=${DB_USER:-empty}, DB_NAME=${DB_NAME:-empty}" >&2
    exit 1
fi

echo "[Cleanup Hook] Database config: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME" >&2

# Escape single quotes in token
TOKEN_ESC="${TOKEN//\'/\'\'}"

# Remove challenge from database using psql
echo "[Cleanup Hook] Deleting challenge from database..." >&2
SQL_OUTPUT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
DELETE FROM \"AcmeChallenge\" WHERE token = '$TOKEN_ESC';
" 2>&1)

SQL_EXIT=$?

if [ $SQL_EXIT -eq 0 ]; then
    echo "[Cleanup Hook] Challenge removed successfully" >&2
    echo "[Cleanup Hook] SQL output: $SQL_OUTPUT" >&2
    exit 0
else
    echo "[Cleanup Hook] ERROR: Failed to remove challenge (exit code: $SQL_EXIT)" >&2
    echo "[Cleanup Hook] SQL output: $SQL_OUTPUT" >&2
    exit 1
fi

