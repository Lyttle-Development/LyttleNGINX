#!/bin/bash
# Don't use set -e at the top - we want to handle errors explicitly
# Log to stderr so certbot sees it
exec 2>&1

echo "[Auth Hook] Starting authentication hook..."

# Check required environment variables
TOKEN="${CERTBOT_TOKEN:-}"
VALIDATION="${CERTBOT_VALIDATION:-}"
DOMAIN="${CERTBOT_DOMAIN:-}"

if [ -z "$TOKEN" ] || [ -z "$VALIDATION" ] || [ -z "$DOMAIN" ]; then
    echo "[Auth Hook] ERROR: Missing required certbot environment variables"
    echo "[Auth Hook] TOKEN='$TOKEN', VALIDATION length=${#VALIDATION}, DOMAIN='$DOMAIN'"
    exit 1
fi

echo "[Auth Hook] Domain: $DOMAIN"
echo "[Auth Hook] Token: $TOKEN"

# Check DB credentials
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-}"
DB_USER="${DB_USER:-}"
DB_NAME="${DB_NAME:-}"

if [ -z "$DB_PASSWORD" ] || [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
    echo "[Auth Hook] ERROR: Missing database credentials"
    echo "[Auth Hook] DB_HOST='$DB_HOST', DB_PORT='$DB_PORT', DB_USER='$DB_USER', DB_NAME='$DB_NAME', DB_PASSWORD_SET=${DB_PASSWORD:+yes}"
    exit 1
fi

echo "[Auth Hook] Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# Check if psql is available
if ! command -v psql >/dev/null 2>&1; then
    echo "[Auth Hook] ERROR: psql command not found"
    echo "[Auth Hook] PATH=$PATH"
    exit 1
fi

echo "[Auth Hook] psql found: $(which psql)"

# Calculate expiry (1 hour from now)
EXPIRES_AT=$(date -u -d '+1 hour' '+%Y-%m-%d %H:%M:%S' 2>&1)
if [ $? -ne 0 ]; then
    echo "[Auth Hook] ERROR: Failed to calculate expiry date"
    echo "[Auth Hook] date command output: $EXPIRES_AT"
    exit 1
fi

echo "[Auth Hook] Expiry: $EXPIRES_AT"

# Escape single quotes by doubling them for SQL
TOKEN_ESC="${TOKEN//\'/\'\'}"
VALIDATION_ESC="${VALIDATION//\'/\'\'}"
DOMAIN_ESC="${DOMAIN//\'/\'\'}"

# Store challenge in database
echo "[Auth Hook] Storing challenge in database..."

SQL_OUTPUT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 2>&1 <<EOSQL
INSERT INTO "AcmeChallenge" (token, "keyAuth", domain, "expiresAt", "createdAt")
VALUES ('$TOKEN_ESC', '$VALIDATION_ESC', '$DOMAIN_ESC', TIMESTAMP '$EXPIRES_AT', NOW())
ON CONFLICT (token)
DO UPDATE SET
    "keyAuth" = EXCLUDED."keyAuth",
    domain = EXCLUDED.domain,
    "expiresAt" = EXCLUDED."expiresAt";
EOSQL
)

SQL_EXIT_CODE=$?

echo "[Auth Hook] SQL exit code: $SQL_EXIT_CODE"
echo "[Auth Hook] SQL output: $SQL_OUTPUT"

if [ $SQL_EXIT_CODE -eq 0 ]; then
    echo "[Auth Hook] Challenge stored successfully"
    # Give Let's Encrypt time to propagate and query our endpoint
    sleep 2
    exit 0
else
    echo "[Auth Hook] ERROR: Failed to store challenge (exit code: $SQL_EXIT_CODE)"
    exit 1
fi

