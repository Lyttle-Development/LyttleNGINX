#!/bin/bash

# Certbot manual auth hook - Store ACME challenge in database
# This allows all nodes in the cluster to serve the challenge

# Certbot provides these environment variables:
# - CERTBOT_DOMAIN: Domain being authenticated
# - CERTBOT_TOKEN: Challenge token (filename)
# - CERTBOT_VALIDATION: Key authorization (file content)

if [ -z "$CERTBOT_TOKEN" ] || [ -z "$CERTBOT_VALIDATION" ] || [ -z "$CERTBOT_DOMAIN" ]; then
    echo "Error: Required environment variables not set"
    exit 1
fi

# Store challenge in database using direct PostgreSQL query
# This is more reliable than HTTP during certificate issuance
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
INSERT INTO \"public\".\"AcmeChallenge\" (id, token, \"keyAuth\", domain, \"createdAt\", \"expiresAt\")
VALUES (
    gen_random_uuid()::text,
    '$CERTBOT_TOKEN',
    '$CERTBOT_VALIDATION',
    '$CERTBOT_DOMAIN',
    NOW(),
    NOW() + INTERVAL '1 hour'
)
ON CONFLICT (token) DO UPDATE SET
    \"keyAuth\" = '$CERTBOT_VALIDATION',
    domain = '$CERTBOT_DOMAIN',
    \"expiresAt\" = NOW() + INTERVAL '1 hour';
" 2>&1

if [ $? -eq 0 ]; then
    echo "Challenge stored in database: $CERTBOT_TOKEN for $CERTBOT_DOMAIN"
    # Give Let's Encrypt a moment to propagate
    sleep 2
    exit 0
else
    echo "Failed to store challenge in database"
    exit 1
fi

