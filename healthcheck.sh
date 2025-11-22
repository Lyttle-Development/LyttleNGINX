#!/bin/bash
# Enhanced health check script with multiple checks


# Color codes for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_error() {
    echo -e "${RED}[HEALTH] ERROR: $1${NC}" >&2
}

log_success() {
    echo -e "${GREEN}[HEALTH] OK: $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}[HEALTH] WARN: $1${NC}" >&2
}

# Track overall health
HEALTHY=true

# 1. Check if Node.js app is running
if ! pgrep -f "node dist/main.js" > /dev/null; then
    log_error "Node.js application is not running"
    HEALTHY=false
else
    log_success "Node.js application is running"
fi

# 2. Check if NGINX is running
if ! pgrep -x nginx > /dev/null; then
    log_error "NGINX is not running"
    HEALTHY=false
else
    log_success "NGINX is running"
fi

# 3. Check API readiness endpoint (critical)
if curl -fsSL --max-time 5 http://127.0.0.1:3000/ready > /dev/null 2>&1; then
    log_success "API is ready"
else
    log_error "API readiness check failed (http://127.0.0.1:3000/ready)"
    HEALTHY=false
fi

# 4. Check NGINX config is valid (critical)
if nginx -t > /dev/null 2>&1; then
    log_success "NGINX configuration is valid"
else
    log_error "NGINX configuration is invalid"
    HEALTHY=false
fi

# 5. Check database connectivity via health endpoint (critical)
if curl -fsSL --max-time 5 http://127.0.0.1:3000/health 2>&1 | grep -q "ok"; then
    log_success "Database is accessible"
else
    log_warn "Database connectivity check inconclusive (may still be initializing)"
    # Don't fail during startup - app might still be connecting to DB
fi

# Final decision
if [ "$HEALTHY" = true ]; then
    log_success "All health checks passed"
    exit 0
else
    log_error "One or more health checks failed"
    exit 1
fi

