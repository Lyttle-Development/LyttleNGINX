# Docker Compose Configuration Example

Here's an updated `docker-compose.yml` with TLS configuration:

```yaml
version: '3.8'

services:
  app:
    image: ghcr.io/lyttle-development/lyttlenginx:main
    # Or build locally:
    # build: .
    
    environment:
      # Database
      DATABASE_URL: postgresql://user:pass@host:port/db
      
      # TLS/SSL Configuration
      ADMIN_EMAIL: admin@example.com           # Required for Let's Encrypt
      RENEW_BEFORE_DAYS: 30                    # Days before expiry to renew
      NODE_ENV: production                     # production | development
      
      # Optional: Custom DNS resolvers
      # DNS_RESOLVERS: 8.8.8.8,8.8.4.4,1.1.1.1

    # Volumes for persistent certificate storage
    volumes:
      - letsencrypt-data:/etc/letsencrypt
      - certbot-webroot:/var/www/certbot
      - nginx-ssl:/etc/nginx/ssl
    
    # Network Configuration - Choose ONE:
    
    # OPTION 1: Host network (recommended for production)
    network_mode: host
    
    # OPTION 2: Port mapping
    # ports:
    #   - "80:80"      # HTTP
    #   - "443:443"    # HTTPS
    #   - "3000:3000"  # API
    
    restart: unless-stopped
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:3000/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

volumes:
  letsencrypt-data:
    driver: local
  certbot-webroot:
    driver: local
  nginx-ssl:
    driver: local
```

## With PostgreSQL Database

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: lyttlenginx
      POSTGRES_USER: lyttlenginx
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lyttlenginx"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    image: ghcr.io/lyttle-development/lyttlenginx:main
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://lyttlenginx:${POSTGRES_PASSWORD}@postgres:5432/lyttlenginx
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      RENEW_BEFORE_DAYS: 30
      NODE_ENV: production
    volumes:
      - letsencrypt-data:/etc/letsencrypt
      - certbot-webroot:/var/www/certbot
      - nginx-ssl:/etc/nginx/ssl
    network_mode: host
    restart: unless-stopped

volumes:
  postgres-data:
  letsencrypt-data:
  certbot-webroot:
  nginx-ssl:
```

## With Traefik (Alternative Reverse Proxy Setup)

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ADMIN_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"  # Traefik dashboard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt
    restart: unless-stopped

  app:
    image: ghcr.io/lyttle-development/lyttlenginx:main
    environment:
      DATABASE_URL: postgresql://user:pass@host:port/db
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      NODE_ENV: production
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.lyttlenginx.rule=Host(`admin.example.com`)"
      - "traefik.http.routers.lyttlenginx.entrypoints=websecure"
      - "traefik.http.routers.lyttlenginx.tls.certresolver=letsencrypt"
      - "traefik.http.services.lyttlenginx.loadbalancer.server.port=3000"
    volumes:
      - letsencrypt-data:/etc/letsencrypt
      - nginx-ssl:/etc/nginx/ssl
    restart: unless-stopped

volumes:
  traefik-certs:
  letsencrypt-data:
  nginx-ssl:
```

## Development Setup

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: lyttlenginx
      POSTGRES_USER: lyttlenginx
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://lyttlenginx:devpassword@postgres:5432/lyttlenginx
      ADMIN_EMAIL: dev@localhost
      NODE_ENV: development  # Skip Let's Encrypt
      RENEW_BEFORE_DAYS: 30
    ports:
      - "80:80"
      - "443:443"
      - "3000:3000"
    volumes:
      # Mount source code for hot reload
      - ./src:/app/src
      - ./nginx:/app/nginx
      # Certificate storage
      - letsencrypt-data:/etc/letsencrypt
      - certbot-webroot:/var/www/certbot
      - nginx-ssl:/etc/nginx/ssl
    command: npm run start:dev
    depends_on:
      - postgres

volumes:
  postgres-data:
  letsencrypt-data:
  certbot-webroot:
  nginx-ssl:
```

## Environment File (.env)

Create a `.env` file in the same directory:

```env
# Copy from .env.example
ADMIN_EMAIL=admin@example.com
POSTGRES_PASSWORD=your-secure-password
NODE_ENV=production
```

## Usage

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Check certificate status
curl http://localhost:3000/certificates

# Generate self-signed cert for testing
curl -X POST http://localhost:3000/certificates/generate-self-signed \
  -H "Content-Type: application/json" \
  -d '{"domains": ["test.local"]}'

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## Important Notes

1. **Volume Persistence**: The volumes ensure certificates persist across container restarts
2. **Network Mode**: Use `host` mode in production for direct access to all network interfaces
3. **Port Mapping**: Only use port mapping in development or when `host` mode isn't suitable
4. **Database**: Ensure DATABASE_URL is correctly configured
5. **Email**: Set ADMIN_EMAIL for Let's Encrypt notifications
6. **Backups**: Regularly backup the `letsencrypt-data` volume

## Backup Script

```bash
#!/bin/bash
# backup-certs.sh

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup Let's Encrypt certificates
docker-compose run --rm -v letsencrypt-data:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine \
  tar czf /backup/letsencrypt.tar.gz -C /data .

# Backup database
docker-compose exec -T postgres pg_dump -U lyttlenginx lyttlenginx > "$BACKUP_DIR/database.sql"

echo "Backup completed: $BACKUP_DIR"
```

Make executable:

```bash
chmod +x backup-certs.sh
./backup-certs.sh
```

