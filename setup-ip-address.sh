#!/bin/bash

# IP Address Feature Setup Script
# This script applies the database migration and regenerates the Prisma client

set -e  # Exit on error

echo "============================================"
echo "IP Address Feature Setup"
echo "============================================"
echo ""

# Check if we're in the right directory
if [ ! -f "prisma/schema.prisma" ]; then
    echo "❌ Error: prisma/schema.prisma not found"
    echo "Please run this script from the project root directory"
    exit 1
fi

echo "✓ Found Prisma schema"
echo ""

# Step 1: Generate Prisma Client
echo "Step 1: Generating Prisma Client..."
if npx prisma generate; then
    echo "✓ Prisma Client generated successfully"
else
    echo "❌ Failed to generate Prisma Client"
    exit 1
fi
echo ""

# Step 2: Check database connection
echo "Step 2: Checking database connection..."
if npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
    echo "✓ Database connection successful"
else
    echo "⚠ Warning: Could not verify database connection"
    echo "  Make sure DATABASE_URL is set correctly in .env"
fi
echo ""

# Step 3: Apply migration
echo "Step 3: Applying database migration..."
echo "Choose migration method:"
echo "  1) migrate deploy (production - recommended)"
echo "  2) migrate dev (development)"
echo "  3) db push (quick schema sync)"
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        echo "Running: npx prisma migrate deploy"
        if npx prisma migrate deploy; then
            echo "✓ Migration deployed successfully"
        else
            echo "❌ Migration deployment failed"
            exit 1
        fi
        ;;
    2)
        echo "Running: npx prisma migrate dev"
        if npx prisma migrate dev; then
            echo "✓ Migration applied in dev mode"
        else
            echo "❌ Migration failed"
            exit 1
        fi
        ;;
    3)
        echo "Running: npx prisma db push"
        if npx prisma db push; then
            echo "✓ Schema pushed successfully"
        else
            echo "❌ Schema push failed"
            exit 1
        fi
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac
echo ""

# Step 4: Verify migration
echo "Step 4: Verifying migration..."
if npx prisma db execute --stdin <<< "SELECT ipAddress FROM \"ClusterNode\" LIMIT 1;" > /dev/null 2>&1; then
    echo "✓ ipAddress column exists in database"
else
    echo "❌ Warning: Could not verify ipAddress column"
fi
echo ""

# Step 5: Build application
echo "Step 5: Building application..."
if npm run build; then
    echo "✓ Application built successfully"
else
    echo "❌ Build failed - please check TypeScript errors"
    exit 1
fi
echo ""

echo "============================================"
echo "✓ Setup Complete!"
echo "============================================"
echo ""
echo "The ipAddress column has been added to ClusterNode."
echo ""
echo "Next steps:"
echo "  1. Restart your application"
echo "  2. Check logs for IP address in registration message"
echo "  3. Query /cluster/nodes API to verify IP addresses"
echo ""
echo "For more information, see: IP_ADDRESS_FEATURE.md"

