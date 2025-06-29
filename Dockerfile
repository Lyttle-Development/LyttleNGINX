# --- Final image: NGINX + built NestJS app ---
FROM nginx:alpine

# Install tini, bash, and node for running NestJS
RUN apk add --no-cache nodejs npm bash tini

WORKDIR /app

# Copy built NestJS app
COPY . .
RUN npm ci

# Copy entrypoint scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Minimal default NGINX config to start
COPY nginx-minimal.conf /etc/nginx/nginx.conf

# Expose API and NGINX ports
EXPOSE 80 3000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]