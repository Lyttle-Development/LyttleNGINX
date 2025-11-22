#!/bin/bash
# Pre-deployment migration script

set -e

echo "Running database migrations..."

# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

echo "Migrations complete!"

