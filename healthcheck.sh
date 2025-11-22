#!/bin/bash
# Enhanced health check script with multiple checks

set -e

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

# 3. Check API readiness endpoint
if ! curl -fsSL --max-time 5 http://127.0.0.1:3000/ready > /dev/null 2>&1; then
    log_error "API readiness check failed (http://127.0.0.1:3000/ready)"
    HEALTHY=false
else
    log_success "API is ready"
fi

# 4. Check NGINX HTTP port
if ! curl -fsSL --max-time 5 http://127.0.0.1:80/ > /dev/null 2>&1; then
    log_warn "NGINX HTTP port not responding (may be expected if no configs)"
    # Don't fail on this - it's ok if no proxy entries exist yet
else
    log_success "NGINX HTTP port is responding"
fi

# 5. Check if NGINX config is valid
if ! nginx -t > /dev/null 2>&1; then
    log_error "NGINX configuration is invalid"
    HEALTHY=false
else
    log_success "NGINX configuration is valid"
fi

# 6. Check database connectivity (via app's health endpoint)
HEALTH_RESPONSE=$(curl -fsSL --max-time 5 http://127.0.0.1:3000/health 2>&1 || echo "failed")
if [[ "$HEALTH_RESPONSE" == "failed" ]] || [[ ! "$HEALTH_RESPONSE" =~ "ok" ]]; then
    log_error "Database connectivity check failed"
    HEALTHY=false
else
    log_success "Database is accessible"
fi

# Final decision
if [ "$HEALTHY" = true ]; then
    log_success "All health checks passed"
    exit 0
else
    log_error "One or more health checks failed"
    exit 1
fi

