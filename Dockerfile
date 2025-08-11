FROM debian:bookworm-slim

# Install system packages
RUN apt-get update && \
    apt-get install -y curl nginx openssl bash tini && \
    apt-get install -y certbot python3-certbot-nginx && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the app
COPY . .

# Build NestJS app
RUN npm run build

# Copy entrypoint scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Ensure proper permissions for Nginx logs and SSL
RUN mkdir -p /var/log/nginx && touch /var/log/nginx/error.log /var/log/nginx/access.log && \
    chmod 666 /var/log/nginx/*.log && \
    mkdir -p /etc/nginx/ssl && chmod 755 /etc/nginx/ssl

# Create nginx user/group and set ownership
RUN addgroup --system --gid 101 nginx && \
    adduser --system --no-create-home --uid 101 --gid 101 nginx && \
    chown -R nginx:nginx /etc/nginx /var/log/nginx

# Expose API and Nginx ports
EXPOSE 80 443 3000

# Healthcheck
HEALTHCHECK --interval=300s --timeout=100s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]