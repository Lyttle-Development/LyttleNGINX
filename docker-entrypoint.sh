#!/bin/bash
set -Eeuo pipefail

# Color codes for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

NODE_PID=""
NGINX_PID=""
SHUTDOWN_REQUESTED=0
FINAL_EXIT_CODE=0
SERVICE_STARTUP_GRACE_SECONDS="${SERVICE_STARTUP_GRACE_SECONDS:-3}"
NODE_SHUTDOWN_TIMEOUT_SECONDS="${NODE_SHUTDOWN_TIMEOUT_SECONDS:-30}"
NGINX_SHUTDOWN_TIMEOUT_SECONDS="${NGINX_SHUTDOWN_TIMEOUT_SECONDS:-10}"
DB_CONNECT_RETRY_DELAY_SECONDS="${DB_CONNECT_RETRY_DELAY_SECONDS:-5}"
MIGRATION_RETRY_DELAY_SECONDS="${MIGRATION_RETRY_DELAY_SECONDS:-5}"
NODE_RESTART_MAX_ATTEMPTS="${NODE_RESTART_MAX_ATTEMPTS:-3}"
NGINX_RESTART_MAX_ATTEMPTS="${NGINX_RESTART_MAX_ATTEMPTS:-3}"
PROCESS_RESTART_WINDOW_SECONDS="${PROCESS_RESTART_WINDOW_SECONDS:-300}"
HEALTH_RECOVERY_MAX_ATTEMPTS="${HEALTH_RECOVERY_MAX_ATTEMPTS:-10}"
HEALTH_RECOVERY_DELAY_SECONDS="${HEALTH_RECOVERY_DELAY_SECONDS:-3}"
NGINX_PID_FILE="${NGINX_PID_FILE:-/run/nginx.pid}"
NGINX_RUNTIME_DIR="${NGINX_RUNTIME_DIR:-/etc/nginx/runtime}"
NGINX_RUNTIME_RELEASES_DIR="${NGINX_RUNTIME_RELEASES_DIR:-${NGINX_RUNTIME_DIR}/releases}"
NGINX_RUNTIME_CURRENT_LINK="${NGINX_RUNTIME_CURRENT_LINK:-${NGINX_RUNTIME_DIR}/current}"
NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK="${NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK:-${NGINX_RUNTIME_DIR}/last-known-good}"
NGINX_BUNDLED_SOURCE_DIR="${NGINX_BUNDLED_SOURCE_DIR:-/app/nginx}"
NODE_RESTART_ATTEMPTS=0
NODE_RESTART_WINDOW_STARTED_AT=0
NGINX_RESTART_ATTEMPTS=0
NGINX_RESTART_WINDOW_STARTED_AT=0

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

normalize_quoted_env_value() {
    local value="${1-}"

    # Trim leading/trailing whitespace first.
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [ -z "$value" ]; then
        echo ""
        return
    fi

    local first_char="${value:0:1}"
    local last_char="${value: -1}"
    if { [ "$first_char" = '"' ] && [ "$last_char" = '"' ]; } || { [ "$first_char" = "'" ] && [ "$last_char" = "'" ]; }; then
        value="${value:1:${#value}-2}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
    fi

    echo "$value"
}

normalize_exit_code() {
    local exit_code="${1:-1}"

    if ! [[ "$exit_code" =~ ^[0-9]+$ ]]; then
        echo 1
        return
    fi

    if [ "$exit_code" -eq 0 ]; then
        echo 1
    else
        echo "$exit_code"
    fi
}

remember_exit_code() {
    local exit_code="$1"

    if [ "$FINAL_EXIT_CODE" -eq 0 ] || [ "$exit_code" -ne 0 ]; then
        FINAL_EXIT_CODE="$exit_code"
    fi
}

clear_restart_budget() {
    local attempts_var="$1"
    local window_var="$2"

    printf -v "$attempts_var" '%s' 0
    printf -v "$window_var" '%s' 0
}

increment_restart_budget() {
    local attempts_var="$1"
    local window_var="$2"
    local max_attempts="$3"
    local process_name="$4"
    local current_epoch
    current_epoch="$(date +%s)"

    local attempts="${!attempts_var:-0}"
    local window_started_at="${!window_var:-0}"

    if [ "$window_started_at" -eq 0 ] || [ $((current_epoch - window_started_at)) -ge "$PROCESS_RESTART_WINDOW_SECONDS" ]; then
        attempts=0
        window_started_at="$current_epoch"
    fi

    attempts=$((attempts + 1))
    printf -v "$attempts_var" '%s' "$attempts"
    printf -v "$window_var" '%s' "$window_started_at"

    if [ "$attempts" -gt "$max_attempts" ]; then
        log_error "${process_name} exceeded restart budget (${max_attempts} attempts in ${PROCESS_RESTART_WINDOW_SECONDS}s)"
        return 1
    fi

    log_warn "Attempting ${process_name} recovery (${attempts}/${max_attempts})"
    return 0
}

probe_liveness() {
    /healthcheck.sh >/dev/null 2>&1
}

wait_for_liveness() {
    local max_attempts="${1:-$HEALTH_RECOVERY_MAX_ATTEMPTS}"
    local delay_seconds="${2:-$HEALTH_RECOVERY_DELAY_SECONDS}"
    local attempt

    for attempt in $(seq 1 "$max_attempts"); do
        if probe_liveness; then
            return 0
        fi

        if [ "$attempt" -lt "$max_attempts" ]; then
            sleep "$delay_seconds"
        fi
    done

    return 1
}

read_nginx_master_pid() {
    local pid

    if [ ! -f "$NGINX_PID_FILE" ]; then
        return 1
    fi

    pid="$(tr -d '[:space:]' < "$NGINX_PID_FILE" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        echo "$pid"
        return 0
    fi

    return 1
}

adopt_running_nginx_master() {
    local live_pid=""

    if ! live_pid="$(read_nginx_master_pid)"; then
        return 1
    fi

    if [ "$live_pid" != "$NGINX_PID" ]; then
        log_warn "Detected active NGINX master PID ${live_pid}; adopting it instead of exiting the container"
    fi

    NGINX_PID="$live_pid"
    return 0
}

wait_for_process_exit() {
    local pid="$1"
    local timeout_seconds="$2"
    local waited=0

    while kill -0 "$pid" 2>/dev/null; do
        if [ "$waited" -ge "$timeout_seconds" ]; then
            return 1
        fi

        sleep 1
        waited=$((waited + 1))
    done

    wait "$pid" 2>/dev/null || true
    return 0
}

stop_process() {
    local pid="$1"
    local signal="$2"
    local timeout_seconds="$3"
    local process_name="$4"

    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return
    fi

    log_info "Stopping ${process_name} (PID: ${pid}) with SIG${signal}..."
    kill -"$signal" "$pid" 2>/dev/null || true

    if wait_for_process_exit "$pid" "$timeout_seconds"; then
        log_success "${process_name} stopped gracefully"
        return
    fi

    log_warn "${process_name} did not stop within ${timeout_seconds}s; force killing"
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

stop_services() {
    stop_process "$NODE_PID" TERM "$NODE_SHUTDOWN_TIMEOUT_SECONDS" "Node.js application"
    stop_process "$NGINX_PID" TERM "$NGINX_SHUTDOWN_TIMEOUT_SECONDS" "NGINX"
}

request_shutdown() {
    local exit_code="${1:-0}"
    local reason="${2:-shutdown requested}"

    remember_exit_code "$exit_code"

    if [ "$SHUTDOWN_REQUESTED" -eq 1 ]; then
        return
    fi

    SHUTDOWN_REQUESTED=1
    log_info "${reason}; shutting down supervised services..."
    stop_services
}

handle_signal() {
    local signal_name="$1"
    request_shutdown 0 "Received ${signal_name}"
    log_info "Container supervision finished with exit code $FINAL_EXIT_CODE"
    exit "$FINAL_EXIT_CODE"
}

# Set up signal handlers
trap 'handle_signal SIGTERM' SIGTERM
trap 'handle_signal SIGINT' SIGINT
trap 'handle_signal SIGQUIT' SIGQUIT

# Verify prerequisites
verify_prerequisites() {
    log_info "Verifying prerequisites..."

    # Check if required environment variables are set
    if [ -z "${DATABASE_URL:-}" ]; then
        log_error "DATABASE_URL environment variable is not set"
        exit 1
    fi

    # Test database connectivity using psql or pg_isready if available
    log_info "Testing database connectivity..."

    # Extract host, port, database from DATABASE_URL
    # Format: postgresql://user:pass@host:port/database
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\).*|\1|p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')

    if [ -z "$DB_PORT" ]; then
        DB_PORT=5432
    fi

    log_info "Testing connection to $DB_HOST:$DB_PORT..."

    # Simple TCP connectivity test using netcat
    if command -v nc > /dev/null 2>&1; then
        if nc -z -w5 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
            log_success "Database is accessible at $DB_HOST:$DB_PORT"
        else
            log_warn "Cannot connect to $DB_HOST:$DB_PORT, will retry in ${DB_CONNECT_RETRY_DELAY_SECONDS}s..."
            sleep "$DB_CONNECT_RETRY_DELAY_SECONDS"
            if ! nc -z -w5 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
                log_error "Cannot connect to database after retry"
                log_error "Check DATABASE_URL and ensure database is running"
                exit 1
            fi
            log_success "Database is accessible after retry"
        fi
    else
        log_warn "netcat not available, skipping connectivity test"
        log_info "Will attempt to connect during Prisma migration"
    fi

  # Generate Prisma client first (must be done before migrations)
  log_info "Generating Prisma client..."
  if ! npx prisma generate 2>&1; then
    log_error "Failed to generate Prisma client"
    log_error "This is usually a configuration issue. Check prisma/schema.prisma"
    exit 1
  fi
  log_success "Prisma client generated"

  # Run Prisma migrations with retry
  log_info "Running Prisma migrations..."
  MIGRATION_RETRIES=3
  MIGRATION_SUCCESS=false

  for i in $(seq 1 $MIGRATION_RETRIES); do
        log_info "Migration attempt $i/$MIGRATION_RETRIES..."

    if npx prisma migrate deploy 2>&1; then
            MIGRATION_SUCCESS=true
            break
    else
            if [ $i -lt $MIGRATION_RETRIES ]; then
                log_warn "Migration failed, waiting ${MIGRATION_RETRY_DELAY_SECONDS}s before retry..."
                sleep "$MIGRATION_RETRY_DELAY_SECONDS"
            fi
    fi
    done

    if [ "$MIGRATION_SUCCESS" = false ]; then
        log_error "Failed to run Prisma migrations after $MIGRATION_RETRIES attempts"
        log_error "Common causes:"
        log_error "  1. Database is not accessible (check DATABASE_URL)"
        log_error "  2. Database permissions are insufficient"
        log_error "  3. Database schema is corrupted"
        log_error "  4. Network issues between container and database"
        log_error ""
        log_error "DATABASE_URL: ${DATABASE_URL%%@*}@***"
        exit 1
    fi

    log_success "Prisma migrations completed"


    log_success "Prerequisites verified"
}

# Start NGINX
bootstrap_nginx_runtime_layout() {
    local bootstrap_release="${NGINX_RUNTIME_RELEASES_DIR}/bootstrap"

    log_info "Ensuring managed NGINX runtime layout exists..."
    if ! mkdir -p "$NGINX_RUNTIME_RELEASES_DIR"; then
        log_warn "Cannot create NGINX runtime directory $NGINX_RUNTIME_RELEASES_DIR; continuing without bootstrap layout"
        return 0
    fi

    if [ ! -d "$bootstrap_release" ]; then
        log_info "Creating bootstrap NGINX release at $bootstrap_release"
        mkdir -p "$bootstrap_release"

        if [ -d "$NGINX_BUNDLED_SOURCE_DIR" ]; then
            cp -a "$NGINX_BUNDLED_SOURCE_DIR/." "$bootstrap_release/"
        elif [ -d /etc/nginx/conf.d ]; then
            log_warn "Bundled NGINX source directory $NGINX_BUNDLED_SOURCE_DIR is missing; falling back to existing /etc/nginx contents"
            mkdir -p "$bootstrap_release/conf.d"
            cp -a /etc/nginx/conf.d/. "$bootstrap_release/conf.d/" 2>/dev/null || true
            if [ -d /etc/nginx/html ]; then
                mkdir -p "$bootstrap_release/html"
                cp -a /etc/nginx/html/. "$bootstrap_release/html/" 2>/dev/null || true
            fi
            if [ -f /etc/nginx/mime.types ]; then
                cp -a /etc/nginx/mime.types "$bootstrap_release/mime.types" 2>/dev/null || true
            fi
        else
            log_warn "Bundled NGINX source directory $NGINX_BUNDLED_SOURCE_DIR is missing; creating an empty bootstrap release"
            mkdir -p "$bootstrap_release/conf.d" "$bootstrap_release/html/errors"
        fi
    fi

    if [ ! -L "$NGINX_RUNTIME_CURRENT_LINK" ]; then
        log_info "Initializing current NGINX release symlink"
        if ! ln -sfn "$bootstrap_release" "$NGINX_RUNTIME_CURRENT_LINK"; then
            log_warn "Failed to initialize current NGINX release symlink at $NGINX_RUNTIME_CURRENT_LINK"
        fi
    fi

    if [ ! -L "$NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK" ]; then
        log_info "Initializing last-known-good NGINX release symlink"
        if ! ln -sfn "$bootstrap_release" "$NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK"; then
            log_warn "Failed to initialize last-known-good NGINX release symlink at $NGINX_RUNTIME_LAST_KNOWN_GOOD_LINK"
        fi
    fi
}

start_nginx() {
    log_info "Starting NGINX..."

    # Test nginx configuration
    if ! nginx -t 2>&1; then
        log_error "NGINX configuration test failed"
        return 1
    fi

    # Start NGINX as a supervised foreground child so container exits when it dies
    nginx -g 'daemon off;' &
    NGINX_PID=$!

    sleep "$SERVICE_STARTUP_GRACE_SECONDS"

    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        local exit_code=0
        if wait "$NGINX_PID"; then
            exit_code=0
        else
            exit_code=$?
        fi
        log_error "NGINX exited during startup with code $exit_code"
        return "$(normalize_exit_code "$exit_code")"
    fi

    log_success "NGINX started (PID: $NGINX_PID)"
    return 0
}

# Start Node.js application
start_node_app() {
    log_info "Starting Node.js application..."

    # Start Node.js app in background
    node dist/main.js &
    NODE_PID=$!

    log_success "Node.js application started (PID: $NODE_PID)"

    # Wait a moment and verify it's still running
    sleep "$SERVICE_STARTUP_GRACE_SECONDS"
    if ! kill -0 "$NODE_PID" 2>/dev/null; then
        local exit_code=0
        if wait "$NODE_PID"; then
            exit_code=0
        else
            exit_code=$?
        fi
        log_error "Node.js application crashed immediately after start with code $exit_code"
        return "$(normalize_exit_code "$exit_code")"
    fi

    if ! wait_for_liveness; then
        log_error "Node.js application did not pass the liveness probe after startup"
        return 1
    fi

    log_success "Node.js application is running stably and liveness is healthy"
    return 0
}

recover_nginx_process() {
    if adopt_running_nginx_master; then
        if wait_for_liveness; then
            clear_restart_budget NGINX_RESTART_ATTEMPTS NGINX_RESTART_WINDOW_STARTED_AT
            log_success "Container remained healthy after NGINX master PID transition"
            return 0
        fi

        log_warn "Adopted running NGINX master, but container liveness has not recovered yet"
    fi

    if ! increment_restart_budget NGINX_RESTART_ATTEMPTS NGINX_RESTART_WINDOW_STARTED_AT "$NGINX_RESTART_MAX_ATTEMPTS" "NGINX"; then
        return 1
    fi

    if start_nginx; then
        :
    else
        local restart_exit_code="$?"
        log_error "NGINX recovery start failed with code $restart_exit_code"
        return "$restart_exit_code"
    fi

    if ! wait_for_liveness; then
        log_error "NGINX restarted, but container liveness did not recover"
        return 1
    fi

    clear_restart_budget NGINX_RESTART_ATTEMPTS NGINX_RESTART_WINDOW_STARTED_AT
    log_success "NGINX recovered and container liveness is healthy again"
    return 0
}

recover_node_process() {
    if ! increment_restart_budget NODE_RESTART_ATTEMPTS NODE_RESTART_WINDOW_STARTED_AT "$NODE_RESTART_MAX_ATTEMPTS" "Node.js application"; then
        return 1
    fi

    if start_node_app; then
        :
    else
        local restart_exit_code="$?"
        log_error "Node.js recovery start failed with code $restart_exit_code"
        return "$restart_exit_code"
    fi

    clear_restart_budget NODE_RESTART_ATTEMPTS NODE_RESTART_WINDOW_STARTED_AT
    log_success "Node.js application recovered and container liveness is healthy again"
    return 0
}

# Monitor processes
monitor_processes() {
    log_info "Monitoring supervised processes (Node PID: $NODE_PID, NGINX PID: $NGINX_PID)..."

    while true; do
        local exited_pid=""
        local exit_code=0

        if wait -n -p exited_pid "$NODE_PID" "$NGINX_PID"; then
            exit_code=0
        else
            exit_code=$?
        fi

        if [ "$SHUTDOWN_REQUESTED" -eq 1 ]; then
            log_info "Shutdown in progress; child PID ${exited_pid:-unknown} exited with code $exit_code"
            break
        fi

        if [ "$exited_pid" = "$NODE_PID" ]; then
            log_error "Node.js application exited unexpectedly with code $exit_code"
            if recover_node_process; then
                continue
            fi
        elif [ "$exited_pid" = "$NGINX_PID" ]; then
            log_error "NGINX exited unexpectedly with code $exit_code"
            if recover_nginx_process; then
                continue
            fi
        else
            log_error "A supervised child process exited unexpectedly with code $exit_code"
        fi

        request_shutdown "$(normalize_exit_code "$exit_code")" "Fail-fast supervision triggered container restart"
        break
    done

    wait "$NODE_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true

    log_info "Container supervision finished with exit code $FINAL_EXIT_CODE"
    exit "$FINAL_EXIT_CODE"
}

# Main execution
log_info "Starting LyttleNGINX container..."

if [ -n "${DATABASE_URL:-}" ]; then
    NORMALIZED_DATABASE_URL="$(normalize_quoted_env_value "$DATABASE_URL")"
    if [ "$NORMALIZED_DATABASE_URL" != "$DATABASE_URL" ]; then
        log_warn "DATABASE_URL contained wrapping quotes; normalizing it for Prisma and application startup"
    fi
    export DATABASE_URL="$NORMALIZED_DATABASE_URL"
fi

log_info "Hostname: $(hostname)"
log_info "Instance: ${HOSTNAME:-unknown}"
log_info "Node version: $(node --version)"
log_info "NPM version: $(npm --version)"

# Show sanitized DATABASE_URL (hide password)
if [ -n "${DATABASE_URL:-}" ]; then
    SANITIZED_URL=$(echo "$DATABASE_URL" | sed 's|://[^:]*:[^@]*@|://***:***@|')
    log_info "Database: $SANITIZED_URL"
else
    log_error "DATABASE_URL is not set!"
fi


# Verify prerequisites
verify_prerequisites

# Ensure the runtime-managed NGINX release layout exists before validation/startup
bootstrap_nginx_runtime_layout

# Start services
if start_nginx; then
    :
else
    startup_exit_code="$?"
    exit "$startup_exit_code"
fi

if start_node_app; then
    :
else
    local_start_exit_code="$?"
    request_shutdown "$local_start_exit_code" "Node.js startup failure"
    exit "$FINAL_EXIT_CODE"
fi

# Monitor and wait
monitor_processes
