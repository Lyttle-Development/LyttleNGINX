# Complete API Reference - Enhanced Features

## Table of Contents

1. [Certificate Backup API](#certificate-backup-api)
2. [Metrics API](#metrics-api)
3. [Error Responses](#error-responses)
4. [Rate Limiting](#rate-limiting)
5. [Examples](#examples)

---

## Certificate Backup API

### Create Backup

Creates a ZIP archive containing all certificates and metadata.

```
POST /certificates/backup
```

**Response:**

```json
{
  "message": "Backup created successfully",
  "filename": "certificates-backup-2025-11-22T12-00-00-000Z.zip"
}
```

**Backup Contents:**

- `certificates.json` - Database export
- `certs/{domain}/fullchain.pem` - Certificate
- `certs/{domain}/privkey.pem` - Private key
- `metadata.json` - Backup metadata

---

### List Backups

Lists all available backup files.

```
GET /certificates/backup
```

**Response:**

```json
[
  {
    "filename": "certificates-backup-2025-11-22T12-00-00-000Z.zip",
    "size": 15234,
    "created": "2025-11-22T12:00:00.000Z"
  },
  {
    "filename": "certificates-backup-2025-11-21T09-00-00-000Z.zip",
    "size": 14890,
    "created": "2025-11-21T09:00:00.000Z"
  }
]
```

---

### Download Backup

Downloads a specific backup file.

```
GET /certificates/backup/:filename
```

**Parameters:**

- `filename` - Backup filename from list

**Response:** Binary ZIP file

**Example:**

```bash
curl http://localhost:3000/certificates/backup/certificates-backup-2025-11-22.zip \
  --output backup.zip
```

---

### Delete Backup

Deletes a specific backup file.

```
DELETE /certificates/backup/:filename
```

**Parameters:**

- `filename` - Backup filename

**Response:** `204 No Content`

---

### Export Single Certificate

Exports a single certificate with its private key.

```
GET /certificates/backup/export/:id
```

**Parameters:**

- `id` - Certificate ID (UUID)

**Response:**

```json
{
  "certPem": "-----BEGIN CERTIFICATE-----\n...",
  "keyPem": "-----BEGIN PRIVATE KEY-----\n...",
  "domains": [
    "example.com",
    "www.example.com"
  ]
}
```

---

### Import Certificates

Imports certificates from a backup or manual data.

```
POST /certificates/backup/import
Content-Type: application/json
```

**Request Body:**

```json
{
  "certificates": [
    {
      "domains": [
        "example.com"
      ],
      "certPem": "-----BEGIN CERTIFICATE-----\n...",
      "keyPem": "-----BEGIN PRIVATE KEY-----\n...",
      "expiresAt": "2026-02-20T00:00:00.000Z",
      "issuedAt": "2025-11-22T00:00:00.000Z"
    }
  ]
}
```

**Response:**

```json
{
  "imported": 5,
  "skipped": 2,
  "errors": 0
}
```

---

## Metrics API

### Prometheus Metrics

Returns metrics in Prometheus exposition format.

```
GET /metrics
```

**Response:** (Content-Type: text/plain)

```
# HELP lyttle_certificates_total Total number of certificates
# TYPE lyttle_certificates_total gauge
lyttle_certificates_total 42

# HELP lyttle_certificates_valid Number of valid certificates
# TYPE lyttle_certificates_valid gauge
lyttle_certificates_valid 38

# HELP lyttle_certificates_expiring_soon Number of certificates expiring soon
# TYPE lyttle_certificates_expiring_soon gauge
lyttle_certificates_expiring_soon 3

# HELP lyttle_certificates_expired Number of expired certificates
# TYPE lyttle_certificates_expired gauge
lyttle_certificates_expired 1

# HELP lyttle_certificates_avg_days_until_expiry Average days until certificate expiry
# TYPE lyttle_certificates_avg_days_until_expiry gauge
lyttle_certificates_avg_days_until_expiry 62

# HELP lyttle_proxy_entries_total Total number of proxy entries
# TYPE lyttle_proxy_entries_total gauge
lyttle_proxy_entries_total 15

# HELP lyttle_proxy_entries_ssl Number of proxy entries with SSL
# TYPE lyttle_proxy_entries_ssl gauge
lyttle_proxy_entries_ssl 12
```

---

### JSON Metrics

Returns metrics in JSON format for easier consumption.

```
GET /metrics/json
```

**Response:**

```json
{
  "timestamp": "2025-11-22T12:00:00.000Z",
  "certificates": {
    "total": 42,
    "valid": 38,
    "expiringSoon": 3,
    "expired": 1,
    "avgDaysUntilExpiry": 62,
    "oldestExpiry": "2025-12-01T00:00:00.000Z",
    "newestExpiry": "2026-02-20T00:00:00.000Z"
  },
  "proxies": {
    "total": 15,
    "withSsl": 12,
    "withoutSsl": 3,
    "proxies": 12,
    "redirects": 3
  }
}
```

---

## Error Responses

All errors follow a consistent format with detailed information.

### Error Response Structure

```json
{
  "statusCode": 400,
  "timestamp": "2025-11-22T12:00:00.000Z",
  "path": "/certificates/upload",
  "method": "POST",
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "certPem",
    "reason": "Invalid PEM format"
  }
}
```

### Error Codes

| Code                           | HTTP Status | Description                   |
|--------------------------------|-------------|-------------------------------|
| `CERTIFICATE_NOT_FOUND`        | 404         | Certificate ID not found      |
| `CERTIFICATE_VALIDATION_ERROR` | 400         | Certificate validation failed |
| `CERTIFICATE_RENEWAL_ERROR`    | 500         | Certificate renewal failed    |
| `CERTIFICATE_EXPIRED`          | 410         | Certificate has expired       |
| `DOMAIN_VALIDATION_ERROR`      | 400         | Domain validation failed      |
| `VALIDATION_ERROR`             | 400         | Input validation failed       |
| `INTERNAL_SERVER_ERROR`        | 500         | Server error occurred         |

### Example Error Responses

**Certificate Not Found:**

```json
{
  "statusCode": 404,
  "timestamp": "2025-11-22T12:00:00.000Z",
  "path": "/certificates/abc123",
  "method": "GET",
  "message": "Certificate not found: abc123",
  "code": "CERTIFICATE_NOT_FOUND",
  "details": {
    "id": "abc123"
  }
}
```

**Validation Error:**

```json
{
  "statusCode": 400,
  "timestamp": "2025-11-22T12:00:00.000Z",
  "path": "/certificates/upload",
  "method": "POST",
  "message": "Certificate and private key do not match",
  "code": "CERTIFICATE_VALIDATION_ERROR",
  "details": {
    "reason": "Modulus mismatch"
  }
}
```

**Input Validation Error:**

```json
{
  "statusCode": 400,
  "timestamp": "2025-11-22T12:00:00.000Z",
  "path": "/certificates/generate-self-signed",
  "method": "POST",
  "message": [
    "domains must contain at least 1 elements",
    "each value in domains must be a string"
  ],
  "error": "Bad Request"
}
```

---

## Rate Limiting

All API endpoints are protected with multi-tier rate limiting.

### Rate Limit Configuration

| Tier   | Duration   | Limit        | Description          |
|--------|------------|--------------|----------------------|
| Short  | 1 second   | 10 requests  | Burst protection     |
| Medium | 1 minute   | 60 requests  | Per-minute limit     |
| Long   | 15 minutes | 100 requests | Extended usage limit |

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

**Headers:**

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1637582400
```

---

## Examples

### Complete Backup Workflow

```bash
#!/bin/bash

# 1. Create backup
echo "Creating backup..."
RESPONSE=$(curl -s -X POST http://localhost:3000/certificates/backup)
FILENAME=$(echo $RESPONSE | jq -r '.filename')
echo "Created: $FILENAME"

# 2. Download backup
echo "Downloading backup..."
curl -s http://localhost:3000/certificates/backup/$FILENAME \
  --output backup.zip
echo "Downloaded: backup.zip"

# 3. List all backups
echo "All backups:"
curl -s http://localhost:3000/certificates/backup | jq

# 4. Extract and inspect
unzip -l backup.zip
```

---

### Certificate Export and Import

```bash
# Export specific certificate
CERT_ID="uuid-here"
curl http://localhost:3000/certificates/backup/export/$CERT_ID \
  > exported-cert.json

# View exported data
cat exported-cert.json | jq

# Import to another instance
curl -X POST http://other-instance:3000/certificates/backup/import \
  -H "Content-Type: application/json" \
  -d @imported-certs.json
```

---

### Monitoring with Prometheus

**prometheus.yml:**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'lyttlenginx'
    static_configs:
      - targets: [ 'localhost:3000' ]
    metrics_path: '/metrics'
```

**Test scraping:**

```bash
# Get metrics
curl http://localhost:3000/metrics

# Get JSON metrics
curl http://localhost:3000/metrics/json | jq
```

---

### Alert Testing

**Test email alert configuration:**

```bash
# Check if email alerts are configured
docker-compose logs app | grep -i "email alerts enabled"

# Trigger manual health check (if service is running)
# The service automatically runs daily at 9 AM
```

**Monitor alert logs:**

```bash
# Watch for alerts
docker-compose logs -f app | grep -E "(Alert|Monitor)"
```

---

### Backup Automation Script

```bash
#!/bin/bash
# backup-daily.sh

API_URL="http://localhost:3000"
BACKUP_RETENTION_DAYS=30

# Create new backup
echo "[$(date)] Creating backup..."
RESPONSE=$(curl -s -X POST $API_URL/certificates/backup)
FILENAME=$(echo $RESPONSE | jq -r '.filename')

if [ -n "$FILENAME" ]; then
  echo "[$(date)] Created: $FILENAME"
  
  # Download to local storage
  curl -s $API_URL/certificates/backup/$FILENAME \
    --output /backups/$FILENAME
  
  # Clean old backups (older than retention period)
  find /backups -name "*.zip" -mtime +$BACKUP_RETENTION_DAYS -delete
  
  echo "[$(date)] Backup complete"
else
  echo "[$(date)] Backup failed"
  exit 1
fi
```

**Add to crontab:**

```cron
0 2 * * * /scripts/backup-daily.sh >> /var/log/cert-backup.log 2>&1
```

---

### Health Monitoring Script

```bash
#!/bin/bash
# check-health.sh

API_URL="http://localhost:3000"

# Get metrics
METRICS=$(curl -s $API_URL/metrics/json)

# Extract values
TOTAL=$(echo $METRICS | jq '.certificates.total')
EXPIRED=$(echo $METRICS | jq '.certificates.expired')
EXPIRING=$(echo $METRICS | jq '.certificates.expiringSoon')

echo "Certificate Health Report"
echo "========================"
echo "Total: $TOTAL"
echo "Expired: $EXPIRED"
echo "Expiring Soon: $EXPIRING"

# Alert if issues found
if [ "$EXPIRED" -gt 0 ]; then
  echo "⚠️ WARNING: $EXPIRED expired certificate(s)"
  exit 1
fi

if [ "$EXPIRING" -gt 0 ]; then
  echo "ℹ️ INFO: $EXPIRING certificate(s) expiring soon"
fi

echo "✅ All certificates healthy"
```

---

### Complete Monitoring Dashboard (Bash)

```bash
#!/bin/bash
# dashboard.sh

API_URL="http://localhost:3000"

# Fetch data
CERTS=$(curl -s $API_URL/certificates)
METRICS=$(curl -s $API_URL/metrics/json)
BACKUPS=$(curl -s $API_URL/certificates/backup)

clear
echo "╔═══════════════════════════════════════════════════════╗"
echo "║     LyttleNGINX Certificate Dashboard                ║"
echo "╠═══════════════════════════════════════════════════════╣"

# Certificate stats
TOTAL=$(echo $METRICS | jq '.certificates.total')
VALID=$(echo $METRICS | jq '.certificates.valid')
EXPIRING=$(echo $METRICS | jq '.certificates.expiringSoon')
EXPIRED=$(echo $METRICS | jq '.certificates.expired')

echo "║ Certificates:"
echo "║   Total:         $TOTAL"
echo "║   Valid:         $VALID ✅"
echo "║   Expiring Soon: $EXPIRING ⚠️"
echo "║   Expired:       $EXPIRED ❌"
echo "╠═══════════════════════════════════════════════════════╣"

# Proxy stats
PROXY_TOTAL=$(echo $METRICS | jq '.proxies.total')
PROXY_SSL=$(echo $METRICS | jq '.proxies.withSsl')

echo "║ Proxy Entries:"
echo "║   Total:    $PROXY_TOTAL"
echo "║   With SSL: $PROXY_SSL"
echo "╠═══════════════════════════════════════════════════════╣"

# Backup stats
BACKUP_COUNT=$(echo $BACKUPS | jq 'length')
LATEST_BACKUP=$(echo $BACKUPS | jq -r '.[0].filename // "None"')

echo "║ Backups:"
echo "║   Count:  $BACKUP_COUNT"
echo "║   Latest: $LATEST_BACKUP"
echo "╚═══════════════════════════════════════════════════════╝"

# List expiring certificates
if [ "$EXPIRING" -gt 0 ]; then
  echo ""
  echo "Certificates Expiring Soon:"
  echo $CERTS | jq -r '.[] | select(.status == "expiring_soon") | 
    "  - \(.domains[0]): expires in \(.daysUntilExpiry) days"'
fi

# List expired certificates
if [ "$EXPIRED" -gt 0 ]; then
  echo ""
  echo "⚠️ EXPIRED Certificates:"
  echo $CERTS | jq -r '.[] | select(.status == "expired") | 
    "  - \(.domains[0]): EXPIRED"'
fi
```

---

## Integration Examples

### Grafana Dashboard

**Panel 1: Certificate Status**

```promql
# Valid certificates
lyttle_certificates_valid

# Expiring soon
lyttle_certificates_expiring_soon

# Expired
lyttle_certificates_expired
```

**Panel 2: Average Days Until Expiry**

```promql
lyttle_certificates_avg_days_until_expiry
```

**Panel 3: SSL Adoption Rate**

```promql
# Percentage of proxies with SSL
(lyttle_proxy_entries_ssl / lyttle_proxy_entries_total) * 100
```

---

### Alertmanager Integration

**alertmanager.yml:**

```yaml
route:
  group_by: [ 'alertname' ]
  receiver: 'email-notifications'

receivers:
  - name: 'email-notifications'
    email_configs:
      - to: 'alerts@example.com'
        from: 'prometheus@example.com'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'your-email@gmail.com'
        auth_password: 'your-password'
```

**Alert Rules:**

```yaml
groups:
  - name: certificates
    rules:
      - alert: CertificateExpiringSoon
        expr: lyttle_certificates_expiring_soon > 0
        for: 1h
        annotations:
          summary: "Certificates expiring soon"
          description: "{{ $value }} certificate(s) expiring within 14 days"

      - alert: CertificateExpired
        expr: lyttle_certificates_expired > 0
        for: 5m
        annotations:
          summary: "Certificates have expired"
          description: "{{ $value }} certificate(s) have expired"
```

---

## Troubleshooting

### Backup Issues

**Problem:** Backup creation fails

**Solution:**

```bash
# Check backup directory exists and is writable
docker-compose exec app ls -la /var/backups/certificates

# Check disk space
docker-compose exec app df -h

# Check logs
docker-compose logs app | grep -i backup
```

---

### Rate Limiting Too Strict

**Problem:** Getting 429 Too Many Requests

**Solution:** Adjust limits in `src/rate-limit/rate-limit.module.ts`:

```typescript
{
    name: 'short',
        ttl
:
    1000,
        limit
:
    20,  // Increased from 10
}
```

---

### Metrics Not Showing

**Problem:** Prometheus not scraping metrics

**Solution:**

```bash
# Test metrics endpoint
curl http://localhost:3000/metrics

# Check Prometheus targets
http://prometheus-server:9090/targets

# Verify network connectivity
docker-compose exec prometheus wget -O- http://app:3000/metrics
```

---

**Documentation Complete! All new endpoints are now fully documented. 📚**

