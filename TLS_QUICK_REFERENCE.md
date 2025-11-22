# 🔒 TLS Quick Reference Card

## Environment Variables

```bash
ADMIN_EMAIL=admin@example.com    # Required for Let's Encrypt
RENEW_BEFORE_DAYS=30             # Days before expiry to renew
NODE_ENV=production              # production | development
```

## Common Commands

### Certificate Management

```bash
# List all certificates with status
curl http://localhost:3000/certificates | jq

# Get certificate details
curl http://localhost:3000/certificates/{id} | jq

# Generate self-signed certificate
curl -X POST http://localhost:3000/certificates/generate-self-signed \
  -H "Content-Type: application/json" \
  -d '{"domains": ["test.local", "*.test.local"]}'

# Upload custom certificate
curl -X POST http://localhost:3000/certificates/upload \
  -H "Content-Type: application/json" \
  -d @certificate.json

# Renew specific certificate
curl -X POST http://localhost:3000/certificates/renew/{id}

# Renew all certificates
curl -X POST http://localhost:3000/certificates/renew-all

# Delete certificate
curl -X DELETE http://localhost:3000/certificates/{id}

# Validate domain
curl http://localhost:3000/certificates/validate/example.com | jq
```

### TLS Configuration

```bash
# Get recommended TLS config
curl http://localhost:3000/tls/config/example.com | jq

# Test TLS connection
curl http://localhost:3000/tls/test/example.com | jq

# Generate DH parameters (slow, runs in background)
curl -X POST http://localhost:3000/tls/dhparam \
  -H "Content-Type: application/json" \
  -d '{"bits": 2048}'

# Check DH parameters status
curl http://localhost:3000/tls/dhparam/status | jq

# Parse certificate PEM
curl -X POST http://localhost:3000/tls/certificate/info \
  -H "Content-Type: application/json" \
  -d '{"certPem": "-----BEGIN CERTIFICATE-----\n..."}'

# Validate certificate chain
curl -X POST http://localhost:3000/tls/certificate/validate-chain \
  -H "Content-Type: application/json" \
  -d '{"certPem": "...", "chainPem": "..."}'
```

## Docker Commands

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f app

# Filter certificate logs
docker-compose logs -f app | grep -i cert

# Check nginx config
docker-compose exec app nginx -t

# Reload nginx
docker-compose exec app nginx -s reload

# Stop services
docker-compose down

# Remove volumes
docker-compose down -v
```

## Database Queries

```sql
-- List all certificates
SELECT *
FROM "Certificate"
ORDER BY "expiresAt" ASC;

-- Find expiring certificates (within 30 days)
SELECT *
FROM "Certificate"
WHERE "expiresAt" < NOW() + INTERVAL '30 days'
  AND "expiresAt"
    > NOW();

-- Find expired certificates
SELECT *
FROM "Certificate"
WHERE "expiresAt" < NOW();

-- Find orphaned certificates
SELECT *
FROM "Certificate"
WHERE "isOrphaned" = true;

-- Enable SSL for a proxy entry
UPDATE "ProxyEntry"
SET ssl = true
WHERE id = 1;

-- Check proxy entries with SSL
SELECT id, domains, ssl
FROM "ProxyEntry"
WHERE ssl = true;
```

## File Locations

```
Configuration:
/etc/nginx/nginx.conf                     - Main NGINX config
/etc/nginx/conf.d/*.conf                  - Generated proxy configs
/etc/nginx/ssl/dhparam.pem                - DH parameters (optional)

Certificates:
/etc/letsencrypt/live/{domain}/fullchain.pem  - Certificate
/etc/letsencrypt/live/{domain}/privkey.pem    - Private key
/var/www/certbot/                             - ACME challenge directory

Logs:
/var/log/nginx/access.log                 - NGINX access log
/var/log/nginx/error.log                  - NGINX error log
```

## Monitoring Script

```bash
#!/bin/bash
# check-certs.sh

# Check for expiring certificates
curl -s http://localhost:3000/certificates | \
  jq -r '.[] | select(.daysUntilExpiry <= 14) | 
    "⚠️  \(.domains[0]) expires in \(.daysUntilExpiry) days"'

# Check for expired certificates
EXPIRED=$(curl -s http://localhost:3000/certificates | \
  jq -r '.[] | select(.status == "expired") | .domains[0]')

if [ -n "$EXPIRED" ]; then
  echo "🚨 EXPIRED: $EXPIRED"
  exit 1
fi

echo "✅ All certificates valid"
```

## Troubleshooting

### Certificate not being issued

```bash
# 1. Check domain resolves
curl http://localhost:3000/certificates/validate/yourdomain.com

# 2. Check logs
docker-compose logs app | grep -i certbot

# 3. Verify email is set
docker-compose exec app printenv ADMIN_EMAIL

# 4. Check nginx is listening on port 80
docker-compose exec app netstat -tlnp | grep :80
```

### NGINX won't reload

```bash
# 1. Test config syntax
docker-compose exec app nginx -t

# 2. Check certificate files exist
docker-compose exec app ls -la /etc/letsencrypt/live/

# 3. Check permissions
docker-compose exec app ls -la /etc/nginx/
```

### Certificate renewal failing

```bash
# 1. Check certificate status
curl http://localhost:3000/certificates | jq '.[] | {domains, status, daysUntilExpiry}'

# 2. Force renewal
curl -X POST http://localhost:3000/certificates/renew-all

# 3. Check certbot logs
docker-compose exec app cat /var/log/letsencrypt/letsencrypt.log
```

## Security Checklist

- [ ] Set ADMIN_EMAIL environment variable
- [ ] Enable SSL for proxy entries: `UPDATE "ProxyEntry" SET ssl = true`
- [ ] Generate DH parameters: `POST /tls/dhparam`
- [ ] Add API authentication (TODO)
- [ ] Add rate limiting (TODO)
- [ ] Configure firewall to allow ports 80, 443
- [ ] Set up certificate expiry monitoring
- [ ] Configure backup for certificates
- [ ] Review NGINX logs regularly

## Certificate Status

| Status          | Meaning                              | Action                     |
|-----------------|--------------------------------------|----------------------------|
| `valid`         | Certificate valid, expires > 30 days | None                       |
| `expiring_soon` | Expires within RENEW_BEFORE_DAYS     | Will auto-renew            |
| `expired`       | Certificate has expired              | Manual intervention needed |

## NGINX SSL Configuration

```nginx
# TLS Protocols
ssl_protocols TLSv1.2 TLSv1.3;

# Cipher Suites (strong only)
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...';

# OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;

# Session Cache
ssl_session_cache shared:SSL:50m;
ssl_session_timeout 1d;

# Security Headers
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

## Automated Tasks (Cron)

```cron
# Check certificate health daily at 9 AM
0 9 * * * /path/to/check-certs.sh

# Auto-renew certificates daily at 2 AM
0 2 * * * curl -X POST http://localhost:3000/certificates/renew-all

# Backup certificates weekly on Sunday at 3 AM
0 3 * * 0 /path/to/backup-certs.sh
```

## Quick Links

- 📖 [Complete Documentation](TLS_DOCUMENTATION.md)
- 🔌 [API Examples](API_EXAMPLES.md)
- 🐳 [Docker Setup](DOCKER_COMPOSE_EXAMPLES.md)
- 📝 [Implementation Summary](TLS_IMPLEMENTATION_SUMMARY.md)
- 🚀 [Quick Start](TLS_README.md)

## Support

Issues? Check the troubleshooting section in [TLS_DOCUMENTATION.md](TLS_DOCUMENTATION.md)

