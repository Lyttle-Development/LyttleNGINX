#!/bin/bash
# Don't exit on error immediately - we need to handle errors gracefully
set -u  # Exit on undefined variables

# Certbot Auth Hook - Stores ACME challenge in database
# This script is called by certbot during certificate issuance

echo "[Auth Hook] Starting authentication hook..." >&2

TOKEN="${CERTBOT_TOKEN:-}"
VALIDATION="${CERTBOT_VALIDATION:-}"
DOMAIN="${CERTBOT_DOMAIN:-}"

if [ -z "$TOKEN" ] || [ -z "$VALIDATION" ] || [ -z "$DOMAIN" ]; then
    echo "[Auth Hook] ERROR: Missing required environment variables" >&2
    echo "[Auth Hook] TOKEN=${TOKEN:-empty}, VALIDATION=${VALIDATION:0:20}..., DOMAIN=${DOMAIN:-empty}" >&2
    exit 1
fi

echo "[Auth Hook] Storing challenge for domain: $DOMAIN" >&2
echo "[Auth Hook] Token: $TOKEN" >&2

# Check DB credentials
if [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_HOST:-}" ] || [ -z "${DB_PORT:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
    echo "[Auth Hook] ERROR: Missing database credentials" >&2
    echo "[Auth Hook] DB_HOST=${DB_HOST:-empty}, DB_PORT=${DB_PORT:-empty}, DB_USER=${DB_USER:-empty}, DB_NAME=${DB_NAME:-empty}" >&2
    exit 1
fi

echo "[Auth Hook] Database config: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME" >&2

# Calculate expiry (1 hour from now)
EXPIRES_AT=$(date -u -d '+1 hour' '+%Y-%m-%d %H:%M:%S' 2>/dev/null)

if [ $? -ne 0 ] || [ -z "$EXPIRES_AT" ]; then
    echo "[Auth Hook] ERROR: Failed to calculate expiry date" >&2
    exit 1
fi

echo "[Auth Hook] Expiry: $EXPIRES_AT" >&2

# Escape single quotes in values by doubling them
TOKEN_ESC="${TOKEN//\'/\'\'}"
VALIDATION_ESC="${VALIDATION//\'/\'\'}"
DOMAIN_ESC="${DOMAIN//\'/\'\'}"

# Use a single psql connection to test and insert (reduces connection overhead)
echo "[Auth Hook] Connecting to database and storing challenge..." >&2
SQL_OUTPUT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << EOF 2>&1
-- Test connection
SELECT 1 AS connection_test;

-- Store challenge
INSERT INTO "AcmeChallenge" (token, "keyAuth", domain, "expiresAt", "createdAt")
VALUES ('$TOKEN_ESC', '$VALIDATION_ESC', '$DOMAIN_ESC', TIMESTAMP '$EXPIRES_AT', NOW())
ON CONFLICT (token)
DO UPDATE SET
    "keyAuth" = EXCLUDED."keyAuth",
    domain = EXCLUDED.domain,
    "expiresAt" = EXCLUDED."expiresAt";
EOF
)

SQL_EXIT=$?

if [ $SQL_EXIT -eq 0 ]; then
    echo "[Auth Hook] Challenge stored successfully" >&2
    echo "[Auth Hook] SQL output: $SQL_OUTPUT" >&2
    # Give Let's Encrypt time to propagate and query our endpoint
    sleep 2
    exit 0
else
    echo "[Auth Hook] ERROR: Failed to store challenge (exit code: $SQL_EXIT)" >&2
    echo "[Auth Hook] SQL output: $SQL_OUTPUT" >&2
    exit 1
fi

