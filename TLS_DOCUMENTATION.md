# TLS/SSL Certificate Management

This document describes the TLS/SSL functionality added to LyttleNGINX.

## Overview

LyttleNGINX now includes comprehensive TLS/SSL certificate management with support for:

- **Let's Encrypt** automatic certificate issuance and renewal
- **Manual certificate upload** for custom or purchased certificates
- **Self-signed certificates** for development/testing
- **HTTP to HTTPS redirects** when SSL is enabled
- **Modern TLS configuration** with security best practices
- **Certificate monitoring** and status tracking

## Features

### 1. Automatic Let's Encrypt Certificates

The system automatically obtains and renews Let's Encrypt certificates for domains configured with SSL enabled.

**Environment Variables:**

```bash
ADMIN_EMAIL=your-email@example.com  # Required for Let's Encrypt
RENEW_BEFORE_DAYS=30                # Days before expiry to renew (default: 30)
NODE_ENV=production                 # Set to 'development' to skip Let's Encrypt
```

### 2. Certificate API Endpoints

#### List All Certificates

```bash
GET /certificates
```

Returns all certificates with their status (valid, expiring_soon, expired).

#### Get Certificate Details

```bash
GET /certificates/:id
```

#### Upload Custom Certificate

```bash
POST /certificates/upload
Content-Type: application/json

{
  "domains": ["example.com", "www.example.com"],
  "certPem": "-----BEGIN CERTIFICATE-----\n...",
  "keyPem": "-----BEGIN PRIVATE KEY-----\n...",
  "chainPem": "-----BEGIN CERTIFICATE-----\n..."  // Optional
}
```

#### Generate Self-Signed Certificate

```bash
POST /certificates/generate-self-signed
Content-Type: application/json

{
  "domains": ["example.local", "*.example.local"]
}
```

#### Renew Specific Certificate

```bash
POST /certificates/renew/:id
```

#### Renew All Certificates

```bash
POST /certificates/renew-all
```

#### Delete Certificate

```bash
DELETE /certificates/:id
```

#### Validate Domain

```bash
GET /certificates/validate/:domain
```

### 3. TLS Configuration API

#### Get Recommended TLS Config

```bash
GET /tls/config/:domain
```

#### Test TLS Connection

```bash
GET /tls/test/:domain
```

#### Generate DH Parameters (Optional, for enhanced security)

```bash
POST /tls/dhparam
Content-Type: application/json

{
  "bits": 2048  // or 4096 for stronger security (takes longer)
}
```

#### Check DH Parameters Status

```bash
GET /tls/dhparam/status
```

#### Get Certificate Info

```bash
POST /tls/certificate/info
Content-Type: application/json

{
  "certPem": "-----BEGIN CERTIFICATE-----\n..."
}
```

#### Validate Certificate Chain

```bash
POST /tls/certificate/validate-chain
Content-Type: application/json

{
  "certPem": "-----BEGIN CERTIFICATE-----\n...",
  "chainPem": "-----BEGIN CERTIFICATE-----\n..."
}
```

## NGINX Configuration

### SSL/TLS Settings

The system uses modern TLS configuration with:

- **Protocols**: TLSv1.2, TLSv1.3
- **Strong cipher suites** (ECDHE, AES-GCM, ChaCha20-Poly1305)
- **OCSP Stapling** enabled for better performance
- **Session caching** for improved SSL handshake performance
- **Security headers** (HSTS, X-Frame-Options, etc.)

### HTTP to HTTPS Redirect

When SSL is enabled for a proxy entry, the system automatically:

1. Creates a separate HTTP server block that redirects to HTTPS
2. Allows `.well-known/acme-challenge/` for Let's Encrypt validation
3. Creates an HTTPS server block with the proxy configuration

Example generated config:

```nginx
# HTTP to HTTPS redirect
server {
  listen 80;
  listen [::]:80;
  server_name example.com www.example.com;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

# HTTPS server
server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name example.com www.example.com;

  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  # ... other security headers ...

  location / {
    proxy_pass http://backend:3000;
    # ... proxy settings ...
  }
}
```

## Database Schema

The `Certificate` model in Prisma stores:

```prisma
model Certificate {
  id          String   @id @default(uuid())
  domains     String   // Semicolon-separated list
  domainsHash String   // SHA256 hash for quick lookup
  certPem     String   // Certificate PEM
  keyPem      String   // Private Key PEM
  expiresAt   DateTime
  issuedAt    DateTime
  lastUsedAt  DateTime
  isOrphaned  Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Certificate Lifecycle

### Automatic Renewal

- Runs every 12 hours (configurable in `certificate.service.ts`)
- Checks all proxy entries and renews certificates expiring within `RENEW_BEFORE_DAYS`
- Automatically reloads NGINX after renewal

### Cleanup

- Orphaned certificates (not used by any proxy entry) are marked
- Can be cleaned up manually via API or scheduled task

## Security Best Practices

### Production Deployment

1. **Use Let's Encrypt for public domains**:
   ```bash
   # Set in environment
   ADMIN_EMAIL=admin@yourdomain.com
   NODE_ENV=production
   ```

2. **Generate DH Parameters** (optional but recommended):
   ```bash
   POST /tls/dhparam
   # Or manually:
   openssl dhparam -out /etc/nginx/ssl/dhparam.pem 2048
   ```

3. **Enable HSTS** (already configured):
    - Automatically adds `Strict-Transport-Security` header
    - Includes subdomains
    - 1 year max-age

4. **Monitor certificate expiry**:
   ```bash
   GET /certificates
   # Check for status: "expiring_soon" or "expired"
   ```

### Development/Testing

1. **Use self-signed certificates**:
   ```bash
   POST /certificates/generate-self-signed
   {
     "domains": ["localhost", "*.localhost"]
   }
   ```

2. **Skip Let's Encrypt**:
   ```bash
   NODE_ENV=development
   ```

## Docker Configuration

The Dockerfile includes all necessary SSL tools:

- `openssl` - Certificate generation and management
- `certbot` - Let's Encrypt client
- `python3-certbot-nginx` - NGINX plugin for certbot

Required directories are automatically created:

- `/etc/nginx/ssl` - For DH parameters and custom SSL files
- `/var/www/certbot` - For Let's Encrypt ACME challenges
- `/etc/letsencrypt/live` - For Let's Encrypt certificates

## Troubleshooting

### Certificate Not Being Issued

1. Check DNS resolution:
   ```bash
   GET /certificates/validate/yourdomain.com
   ```

2. Check logs:
   ```bash
   docker logs <container-id> | grep -i cert
   ```

3. Verify email is set:
   ```bash
   echo $ADMIN_EMAIL
   ```

4. Ensure ports 80 and 443 are accessible from the internet

### NGINX Fails to Start

1. Validate NGINX config:
   ```bash
   docker exec <container-id> nginx -t
   ```

2. Check certificate file permissions:
   ```bash
   docker exec <container-id> ls -la /etc/letsencrypt/live/
   ```

### Certificate Renewal Fails

1. Check renewal logs
2. Verify domain still resolves correctly
3. Manually trigger renewal:
   ```bash
   POST /certificates/renew-all
   ```

## Examples

### Example 1: Add SSL to Existing Proxy

1. Update proxy entry in database:
   ```sql
   UPDATE "ProxyEntry" SET ssl = true WHERE id = 1;
   ```

2. Wait for automatic reload (5 minutes) or trigger manually:
   ```bash
   POST /health/reload
   ```

3. System will automatically:
    - Generate nginx config with HTTP→HTTPS redirect
    - Obtain Let's Encrypt certificate
    - Update nginx config with SSL
    - Reload nginx

### Example 2: Upload Custom Certificate

```bash
curl -X POST http://localhost:3000/certificates/upload \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["api.example.com"],
    "certPem": "'"$(cat /path/to/cert.pem)"'",
    "keyPem": "'"$(cat /path/to/key.pem)"'",
    "chainPem": "'"$(cat /path/to/chain.pem)"'"
  }'
```

### Example 3: Monitor Certificate Health

```bash
# List all certificates with status
curl http://localhost:3000/certificates | jq '.[] | {domains, status, daysUntilExpiry}'
```

## Future Enhancements

Potential improvements for future versions:

- [ ] Wildcard certificate support
- [ ] Multiple certificate providers (ZeroSSL, BuyPass)
- [ ] Email/webhook alerts for expiring certificates
- [ ] Certificate backup/restore
- [ ] Multi-domain certificate optimization
- [ ] CAA record validation
- [ ] Certificate transparency log monitoring

## Related Files

- `src/certificate/certificate.service.ts` - Core certificate management
- `src/certificate/certificate.controller.ts` - Certificate API endpoints
- `src/certificate/tls-config.service.ts` - TLS configuration utilities
- `src/certificate/tls.controller.ts` - TLS API endpoints
- `src/nginx/nginx.service.ts` - NGINX config generation with SSL
- `nginx/nginx.conf` - NGINX base configuration with SSL settings

