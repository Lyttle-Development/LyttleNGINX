# Multi-stage build: NestJS + NGINX in one image, stateless

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Final image: NGINX + built NestJS app ---
FROM nginx:alpine

# Install tini, bash, and node for running NestJS
RUN apk add --no-cache nodejs bash tini

WORKDIR /app

# Copy built NestJS app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Minimal default NGINX config to start
COPY nginx-minimal.conf /etc/nginx/nginx.conf

# Expose API and NGINX ports
EXPOSE 80 3000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]