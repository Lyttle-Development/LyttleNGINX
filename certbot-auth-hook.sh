#!/bin/bash
fi
    exit 1
    echo "Failed to store challenge in database"
else
    exit 0
    sleep 2
    # Give Let's Encrypt a moment to propagate
    echo "Challenge stored in database: $CERTBOT_TOKEN for $CERTBOT_DOMAIN"
if [ $? -eq 0 ]; then

" 2>&1
    \"expiresAt\" = NOW() + INTERVAL '1 hour';
    domain = '$CERTBOT_DOMAIN',
    \"keyAuth\" = '$CERTBOT_VALIDATION',
ON CONFLICT (token) DO UPDATE SET
)
    NOW() + INTERVAL '1 hour'
    NOW(),
    '$CERTBOT_DOMAIN',
    '$CERTBOT_VALIDATION',
    '$CERTBOT_TOKEN',
    gen_random_uuid()::text,
VALUES (
INSERT INTO \"public\".\"AcmeChallenge\" (id, token, \"keyAuth\", domain, \"createdAt\", \"expiresAt\")
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
# This is more reliable than HTTP during certificate issuance
# Store in database using direct PostgreSQL query

EXPIRES_AT=$(date -u -d "+1 hour" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v+1H +"%Y-%m-%dT%H:%M:%SZ")
# Calculate expiration (1 hour from now)

API_URL="${API_URL:-http://localhost:3000}"
# Store challenge in database via API

fi
    exit 1
    echo "Error: Required environment variables not set"
if [ -z "$CERTBOT_TOKEN" ] || [ -z "$CERTBOT_VALIDATION" ] || [ -z "$CERTBOT_DOMAIN" ]; then

# - CERTBOT_VALIDATION: Key authorization (file content)
# - CERTBOT_TOKEN: Challenge token (filename)
# - CERTBOT_DOMAIN: Domain being authenticated
# Certbot provides these environment variables:

# This allows all nodes in the cluster to serve the challenge
# Certbot manual auth hook - Store ACME challenge in database


