# Multi-stage build for smaller, more secure image
FROM node:24.16.0-bookworm-slim AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci && \
    npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production && \
    npm cache clean --force

# Production stage
FROM node:24.16.0-bookworm-slim

# Add labels for better container management
LABEL maintainer="lyttle-development"
LABEL description="NGINX proxy with SSL management and database integration"
LABEL version="1.0"

# Install runtime system packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        nginx \
        openssl \
        bash \
        tini \
        procps \
        netcat-openbsd \
        postgresql-client && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint scripts and make them executable
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /docker-entrypoint.sh /healthcheck.sh

# Copy nginx config to /app/nginx (for reloader service to access)
COPY nginx /app/nginx

# Also copy initial config to /etc/nginx
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/conf.d /etc/nginx/conf.d
COPY nginx/html /etc/nginx/html

# Ensure proper permissions and create necessary directories
RUN mkdir -p /var/log/nginx /var/lib/nginx /var/run && \
    touch /var/log/nginx/error.log /var/log/nginx/access.log && \
    chmod 666 /var/log/nginx/*.log && \
    mkdir -p /etc/nginx/ssl && chmod 755 /etc/nginx/ssl && \
    mkdir -p /etc/letsencrypt/live && chmod 755 /etc/letsencrypt/live && \
    mkdir -p /app/logs && chmod 755 /app/logs

# Create nginx user/group and set ownership
RUN groupadd --system --gid 101 nginx || true && \
    useradd --system --no-create-home --uid 101 --gid 101 nginx || true && \
    chown -R nginx:nginx /etc/nginx /var/log/nginx /var/lib/nginx

# Create app state directory for crash recovery and persistent ACME account state
RUN mkdir -p /app/state/acme && chmod 755 /app/state /app/state/acme

# Expose API and Nginx ports
EXPOSE 80 443 3000

# Enhanced healthcheck with proper retry logic
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
  CMD /healthcheck.sh || exit 1

# Use tini for proper signal handling and zombie reaping
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/docker-entrypoint.sh"]
