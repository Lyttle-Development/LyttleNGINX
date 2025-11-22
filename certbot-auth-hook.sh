#!/bin/bash
set -e  # Exit on error

# Certbot Auth Hook - Stores ACME challenge in database
# This script is called by certbot during certificate issuance

# Log to stderr so certbot sees it
exec 2>&1

echo "[Auth Hook] Starting authentication hook..."

TOKEN="${CERTBOT_TOKEN}"
VALIDATION="${CERTBOT_VALIDATION}"
DOMAIN="${CERTBOT_DOMAIN}"

if [ -z "$TOKEN" ] || [ -z "$VALIDATION" ] || [ -z "$DOMAIN" ]; then
    echo "[Auth Hook] ERROR: Missing required environment variables"
    echo "[Auth Hook] TOKEN='${TOKEN:-}', DOMAIN='${DOMAIN:-}'"
    exit 1
fi

echo "[Auth Hook] Domain: $DOMAIN"
echo "[Auth Hook] Token: $TOKEN"

# Check DB credentials
if [ -z "${DB_PASSWORD}" ] || [ -z "${DB_HOST}" ] || [ -z "${DB_PORT}" ] || [ -z "${DB_USER}" ] || [ -z "${DB_NAME}" ]; then
    echo "[Auth Hook] ERROR: Missing database credentials"
    echo "[Auth Hook] DB_HOST='${DB_HOST:-}', DB_PORT='${DB_PORT:-}', DB_USER='${DB_USER:-}', DB_NAME='${DB_NAME:-}'"
    exit 1
fi

echo "[Auth Hook] Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# Calculate expiry (1 hour from now)
EXPIRES_AT=$(date -u -d '+1 hour' '+%Y-%m-%d %H:%M:%S')
echo "[Auth Hook] Expiry: $EXPIRES_AT"

# Escape single quotes by doubling them for SQL
TOKEN_ESC="${TOKEN//\'/\'\'}"
VALIDATION_ESC="${VALIDATION//\'/\'\'}"
DOMAIN_ESC="${DOMAIN//\'/\'\'}"

# Store challenge in database
echo "[Auth Hook] Storing challenge in database..."

PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<-EOSQL
    INSERT INTO "AcmeChallenge" (token, "keyAuth", domain, "expiresAt", "createdAt")
    VALUES ('$TOKEN_ESC', '$VALIDATION_ESC', '$DOMAIN_ESC', TIMESTAMP '$EXPIRES_AT', NOW())
    ON CONFLICT (token)
    DO UPDATE SET
        "keyAuth" = EXCLUDED."keyAuth",
        domain = EXCLUDED.domain,
        "expiresAt" = EXCLUDED."expiresAt";
EOSQL

if [ $? -eq 0 ]; then
    echo "[Auth Hook] Challenge stored successfully"
    # Give Let's Encrypt time to propagate and query our endpoint
    sleep 2
    exit 0
else
    echo "[Auth Hook] ERROR: Failed to store challenge"
    exit 1
fi

