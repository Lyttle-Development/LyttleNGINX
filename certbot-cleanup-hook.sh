#!/bin/bash
set -e

# Certbot Cleanup Hook - Removes ACME challenge from database
# This script is called by certbot after certificate issuance

TOKEN="${CERTBOT_TOKEN}"

if [ -z "$TOKEN" ]; then
    echo "[Cleanup Hook] ERROR: Missing CERTBOT_TOKEN"
    exit 1
fi

echo "[Cleanup Hook] Removing challenge: $TOKEN"

# Remove challenge from database using psql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
DELETE FROM \"AcmeChallenge\" WHERE token = '$TOKEN';
" 2>&1

if [ $? -eq 0 ]; then
    echo "[Cleanup Hook] Challenge removed successfully"
    exit 0
else
    echo "[Cleanup Hook] ERROR: Failed to remove challenge"
    exit 1
fi

