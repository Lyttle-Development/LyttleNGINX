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

# Copy built NestJS app and package.json files
COPY package*.json ./
COPY . .

# Install Node dependencies and build NestJS app
RUN npm ci && npm run build

# Copy entrypoint scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf
# Ensure virtual hosts and static assets (including error pages) are available to Nginx
COPY nginx/conf.d /etc/nginx/conf.d
COPY nginx/html /etc/nginx/html

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
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fS --max-time 5 http://127.0.0.1:3000/ready || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]