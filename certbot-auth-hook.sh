#!/bin/bash
set -e

# Certbot Auth Hook - Stores ACME challenge in database
# This script is called by certbot during certificate issuance

TOKEN="${CERTBOT_TOKEN}"
VALIDATION="${CERTBOT_VALIDATION}"
DOMAIN="${CERTBOT_DOMAIN}"

if [ -z "$TOKEN" ] || [ -z "$VALIDATION" ] || [ -z "$DOMAIN" ]; then
    echo "[Auth Hook] ERROR: Missing required environment variables"
    exit 1
fi

echo "[Auth Hook] Storing challenge for domain: $DOMAIN"
echo "[Auth Hook] Token: $TOKEN"

# Calculate expiry (1 hour from now)
EXPIRES_AT=$(date -u -d '+1 hour' +"%Y-%m-%d %H:%M:%S")

# Store challenge in database using psql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
INSERT INTO \"AcmeChallenge\" (token, \"keyAuth\", domain, \"expiresAt\", \"createdAt\")
VALUES ('$TOKEN', '$VALIDATION', '$DOMAIN', '$EXPIRES_AT', NOW())
ON CONFLICT (token)
DO UPDATE SET
    \"keyAuth\" = '$VALIDATION',
    domain = '$DOMAIN',
    \"expiresAt\" = '$EXPIRES_AT';
" 2>&1

if [ $? -eq 0 ]; then
    echo "[Auth Hook] Challenge stored successfully"
    # Give Let's Encrypt time to propagate and query our endpoint
    sleep 2
    exit 0
else
    echo "[Auth Hook] ERROR: Failed to store challenge"
    exit 1
fi

