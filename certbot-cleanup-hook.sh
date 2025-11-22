#!/bin/bash

# Certbot manual cleanup hook - Remove ACME challenge from database

if [ -z "$CERTBOT_TOKEN" ]; then
    echo "Error: CERTBOT_TOKEN not set"
    exit 1
fi

# Remove from database
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
DELETE FROM \"public\".\"AcmeChallenge\" WHERE token = '$CERTBOT_TOKEN';
" 2>&1

if [ $? -eq 0 ]; then
    echo "Challenge removed from database: $CERTBOT_TOKEN"
    exit 0
else
    echo "Failed to remove challenge from database"
    exit 1
fi

