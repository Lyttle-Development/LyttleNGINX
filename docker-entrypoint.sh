#!/bin/bash
set -e

# Color codes for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[ENTRYPOINT] INFO: $1${NC}"
}

log_success() {
    echo -e "${GREEN}[ENTRYPOINT] SUCCESS: $1${NC}"
}

log_error() {
    echo -e "${RED}[ENTRYPOINT] ERROR: $1${NC}" >&2
}

log_warn() {
    echo -e "${YELLOW}[ENTRYPOINT] WARN: $1${NC}"
}

# State file for tracking restarts
STATE_DIR="/app/state"
STATE_FILE="${STATE_DIR}/restart.state"
MAX_RESTART_ATTEMPTS=5
RESTART_WINDOW=300 # 5 minutes

# Cleanup function for graceful shutdown
cleanup() {
    log_info "Received shutdown signal, cleaning up..."

    # Stop Node.js app gracefully
    if [ ! -z "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
        log_info "Stopping Node.js application (PID: $NODE_PID)..."
        kill -TERM "$NODE_PID" 2>/dev/null || true

        # Wait up to 30 seconds for graceful shutdown
        for i in {1..30}; do
            if ! kill -0 "$NODE_PID" 2>/dev/null; then
                log_success "Node.js application stopped gracefully"
                break
            fi
            sleep 1
        done

        # Force kill if still running
        if kill -0 "$NODE_PID" 2>/dev/null; then
            log_warn "Force killing Node.js application"
            kill -KILL "$NODE_PID" 2>/dev/null || true
        fi
    fi

    # Stop NGINX gracefully
    if [ ! -z "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
        log_info "Stopping NGINX (PID: $NGINX_PID)..."
        nginx -s quit || kill -TERM "$NGINX_PID" 2>/dev/null || true

        # Wait up to 10 seconds
        for i in {1..10}; do
            if ! kill -0 "$NGINX_PID" 2>/dev/null; then
                log_success "NGINX stopped gracefully"
                break
            fi
            sleep 1
        done
    fi

    log_success "Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT SIGQUIT

# Check restart state
check_restart_state() {
    if [ -f "$STATE_FILE" ]; then
        LAST_RESTART=$(cat "$STATE_FILE")
        CURRENT_TIME=$(date +%s)
        TIME_DIFF=$((CURRENT_TIME - LAST_RESTART))

        if [ $TIME_DIFF -lt $RESTART_WINDOW ]; then
            RESTART_COUNT_FILE="${STATE_DIR}/restart.count"
            if [ -f "$RESTART_COUNT_FILE" ]; then
                COUNT=$(cat "$RESTART_COUNT_FILE")
                COUNT=$((COUNT + 1))
            else
                COUNT=1
            fi

            echo $COUNT > "$RESTART_COUNT_FILE"

            if [ $COUNT -ge $MAX_RESTART_ATTEMPTS ]; then
                log_error "Too many restarts ($COUNT) in ${RESTART_WINDOW}s window. Entering failure mode."
                log_error "Manual intervention required. Check logs for details."
                sleep infinity
            fi

            log_warn "Restart #$COUNT within ${RESTART_WINDOW}s window"
        else
            # Reset counter if outside window
            echo 0 > "${STATE_DIR}/restart.count"
        fi
    fi

    echo $(date +%s) > "$STATE_FILE"
}

# Verify prerequisites
verify_prerequisites() {
    log_info "Verifying prerequisites..."

    # Check if required environment variables are set
    if [ -z "$DATABASE_URL" ]; then
        log_error "DATABASE_URL environment variable is not set"
        exit 1
    fi

    # Test database connectivity
    log_info "Testing database connectivity..."
    if ! npx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1; then
        log_warn "Database connectivity test failed, will retry..."
        sleep 5
        if ! npx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1; then
            log_error "Cannot connect to database after retry"
            exit 1
        fi
    fi
    log_success "Database is accessible"

  # Generate Prisma client first (must be done before migrations)
  log_info "Generating Prisma client..."
  if ! npx prisma generate; then
    log_error "Failed to generate Prisma client"
    exit 1
  fi
  log_success "Prisma client generated"

  # Run Prisma migrations
  log_info "Running Prisma migrations..."
  if ! npx prisma migrate deploy; then
    log_error "Failed to run Prisma migrations"
    exit 1
  fi
  log_success "Prisma migrations completed"


    log_success "Prerequisites verified"
}

# Start NGINX
start_nginx() {
    log_info "Starting NGINX..."

    # Test nginx configuration
    if ! nginx -t 2>&1; then
        log_error "NGINX configuration test failed"
        exit 1
    fi

    # Start NGINX
    nginx
    NGINX_PID=$(pgrep -x nginx | head -n1)

    if [ -z "$NGINX_PID" ]; then
        log_error "Failed to start NGINX"
        exit 1
    fi

    log_success "NGINX started (PID: $NGINX_PID)"
}

# Start Node.js application
start_node_app() {
    log_info "Starting Node.js application..."

    # Start Node.js app in background
    node dist/main.js &
    NODE_PID=$!

    log_success "Node.js application started (PID: $NODE_PID)"

    # Wait a moment and verify it's still running
    sleep 3
    if ! kill -0 "$NODE_PID" 2>/dev/null; then
        log_error "Node.js application crashed immediately after start"
        exit 1
    fi

    log_success "Node.js application is running stably"
}

# Monitor processes
monitor_processes() {
    log_info "Monitoring processes (Node PID: $NODE_PID, NGINX PID: $NGINX_PID)..."

    while true; do
        # Check Node.js app
        if ! kill -0 "$NODE_PID" 2>/dev/null; then
            log_error "Node.js application died unexpectedly"
            cleanup
            exit 1
        fi

        # Check NGINX
        if ! kill -0 "$NGINX_PID" 2>/dev/null; then
            log_error "NGINX died unexpectedly, attempting restart..."
            start_nginx
        fi

        # Wait for Node.js to exit (normal shutdown)
        wait "$NODE_PID"
        EXIT_CODE=$?

        log_info "Node.js application exited with code $EXIT_CODE"
        cleanup
        exit $EXIT_CODE
    done
}

# Main execution
log_info "Starting LyttleNGINX container..."
log_info "Hostname: $(hostname)"
log_info "Instance: ${HOSTNAME:-unknown}"

# Check restart state
check_restart_state

# Verify prerequisites
verify_prerequisites

# Start services
start_nginx
start_node_app

# Monitor and wait
monitor_processes
