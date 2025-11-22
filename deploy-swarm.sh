#!/bin/bash
# Quick deployment script for LyttleNGINX in Docker Swarm

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LyttleNGINX Swarm Deployment Script     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Check if running in swarm mode
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo -e "${RED}Error: Docker Swarm is not active${NC}"
    echo "Initialize swarm with: docker swarm init"
    exit 1
fi

# Check for required environment variables
REQUIRED_VARS=("DATABASE_URL" "ADMIN_EMAIL" "API_KEY" "JWT_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}Error: Missing required environment variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo -e "  - $var"
    done
    echo ""
    echo "Please set these variables or create a .env file"
    exit 1
fi

echo -e "${GREEN}✓ Environment variables validated${NC}"

# Check if stack already exists
if docker stack ls | grep -q "lyttlenginx"; then
    echo -e "${YELLOW}⚠ Stack 'lyttlenginx' already exists${NC}"
    read -p "Do you want to update it? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled"
        exit 0
    fi
fi

# Check database connectivity
echo ""
echo -e "${BLUE}Testing database connectivity...${NC}"
if command -v psql > /dev/null 2>&1; then
    if psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Database connection successful${NC}"
    else
        echo -e "${YELLOW}⚠ Could not connect to database${NC}"
        echo "Deployment will continue, but verify database settings"
    fi
else
    echo -e "${YELLOW}⚠ psql not found, skipping database check${NC}"
fi

echo ""
echo -e "${GREEN}✓ Certificate storage: Database-driven (no shared storage needed)${NC}"
echo "  Certificates are stored in PostgreSQL and synced to local filesystem on each node"

# Deploy stack
echo ""
echo -e "${BLUE}Deploying stack...${NC}"
if docker stack deploy -c docker-compose.swarm.yml lyttlenginx; then
    echo -e "${GREEN}✓ Stack deployed successfully${NC}"
else
    echo -e "${RED}✗ Stack deployment failed${NC}"
    exit 1
fi

# Wait for services to start
echo ""
echo -e "${BLUE}Waiting for services to start...${NC}"
sleep 5

# Show service status
echo ""
echo -e "${BLUE}Service Status:${NC}"
docker service ls --filter name=lyttlenginx

echo ""
echo -e "${BLUE}Tasks (one per node in global mode):${NC}"
docker service ps lyttlenginx_lyttlenginx --format "table {{.Name}}\t{{.Node}}\t{{.CurrentState}}\t{{.Error}}"

# Show useful commands
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Deployment Complete! 🎉           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo ""
echo "  View logs:"
echo "    docker service logs -f lyttlenginx_lyttlenginx"
echo ""
echo "  Check service status:"
echo "    docker service ps lyttlenginx_lyttlenginx"
echo ""
echo "  View cluster nodes:"
echo "    curl -H 'Authorization: Bearer YOUR_JWT' http://localhost:3003/cluster/nodes"
echo ""
echo "  View leader:"
echo "    docker service logs lyttlenginx_lyttlenginx 2>&1 | grep LEADER"
echo ""
echo "  Update service:"
echo "    docker service update --image ghcr.io/lyttle-development/lyttlenginx:latest lyttlenginx_lyttlenginx"
echo ""
echo "  Remove stack:"
echo "    docker stack rm lyttlenginx"
echo ""

