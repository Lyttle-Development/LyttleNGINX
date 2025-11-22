# 🚀 Quick Start Guide - Enhanced Features

## Installation Complete ✅

All 10 enhancements have been successfully implemented and are ready to use!

---

## 🎯 Quick Feature Overview

| Feature            | Status       | Complexity | Impact |
|--------------------|--------------|------------|--------|
| Input Validation   | ✅ Active     | Auto       | High   |
| Rate Limiting      | ✅ Active     | Auto       | Medium |
| Error Handling     | ✅ Active     | Auto       | High   |
| Certificate Backup | ✅ Ready      | Manual     | High   |
| Monitoring Service | ✅ Active     | Auto       | High   |
| Prometheus Metrics | ✅ Active     | Auto       | Medium |
| Email Alerts       | ⚙️ Configure | Config     | High   |
| Slack Alerts       | ⚙️ Configure | Config     | Medium |
| Discord Alerts     | ⚙️ Configure | Config     | Medium |

---

## ⚡ 5-Minute Setup

### Step 1: Configure Environment (2 minutes)

```bash
# Copy example file
cp .env.example .env

# Edit with your settings
nano .env
```

**Minimum Configuration:**

```bash
DATABASE_URL=postgresql://user:pass@host/db
ADMIN_EMAIL=admin@example.com
NODE_ENV=production
```

### Step 2: Build and Start (2 minutes)

```bash
# Build
npm run build

# Start
npm run start:prod
```

### Step 3: Verify (1 minute)

```bash
# Check health
curl http://localhost:3000/ready

# Check metrics
curl http://localhost:3000/metrics/json | jq

# Create test backup
curl -X POST http://localhost:3000/certificates/backup
```

**Done! ✅ All features are now active.**

---

## 📱 Test Each Feature

### 1. Input Validation ✅ Auto-Active

```bash
# Try invalid input (should fail with 400)
curl -X POST http://localhost:3000/certificates/generate-self-signed \
  -H "Content-Type: application/json" \
  -d '{"domains": []}'

# Expected: Validation error with detailed message
```

### 2. Rate Limiting ✅ Auto-Active

```bash
# Rapid-fire requests (should get 429)
for i in {1..30}; do 
  curl -s http://localhost:3000/certificates | head -1
done

# Expected: "429 Too Many Requests" after ~10 requests/sec
```

### 3. Prometheus Metrics ✅ Auto-Active

```bash
# View metrics
curl http://localhost:3000/metrics

# Or JSON format
curl http://localhost:3000/metrics/json | jq
```

### 4. Certificate Backup ✅ Ready to Use

```bash
# Create backup
curl -X POST http://localhost:3000/certificates/backup

# List backups
curl http://localhost:3000/certificates/backup | jq

# Download backup
curl http://localhost:3000/certificates/backup/FILENAME -o backup.zip
```

### 5. Email Alerts ⚙️ Requires Configuration

```bash
# Add to .env
ALERT_EMAIL=alerts@example.com
ALERT_FROM_EMAIL=noreply@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Restart service
docker-compose restart app

# Check logs
docker-compose logs app | grep -i "email alerts enabled"
```

### 6. Slack Alerts ⚙️ Requires Configuration

```bash
# Add to .env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Restart service
docker-compose restart app

# Check logs
docker-compose logs app | grep -i "webhook alerts enabled"
```

### 7. Monitoring Service ✅ Auto-Active

```bash
# View current health summary
curl http://localhost:3000/metrics/json | jq '.certificates'

# Expected output:
{
  "total": 10,
  "valid": 8,
  "expiringSoon": 1,
  "expired": 1,
  ...
}

# Monitoring runs daily at 9 AM automatically
# Check logs: docker-compose logs app | grep Monitor
```

---

## 🎨 Integration Examples

### Grafana Dashboard (5 minutes)

1. **Add Prometheus data source:**
   ```yaml
   # prometheus.yml
   scrape_configs:
     - job_name: 'lyttlenginx'
       static_configs:
         - targets: ['app:3000']
       metrics_path: '/metrics'
   ```

2. **Import dashboard:**
    - Use metrics from `/metrics` endpoint
    - Create panels for:
        - `lyttle_certificates_total`
        - `lyttle_certificates_expiring_soon`
        - `lyttle_certificates_expired`

### Automated Backup Script (2 minutes)

```bash
#!/bin/bash
# /scripts/backup-daily.sh

API_URL="http://localhost:3000"

# Create backup
RESPONSE=$(curl -s -X POST $API_URL/certificates/backup)
FILENAME=$(echo $RESPONSE | jq -r '.filename')

# Download
curl -s $API_URL/certificates/backup/$FILENAME \
  --output /backups/$FILENAME

echo "Backup created: $FILENAME"
```

**Add to crontab:**

```bash
0 2 * * * /scripts/backup-daily.sh >> /var/log/backup.log 2>&1
```

### Health Check Script (1 minute)

```bash
#!/bin/bash
# /scripts/health-check.sh

METRICS=$(curl -s http://localhost:3000/metrics/json)
EXPIRED=$(echo $METRICS | jq '.certificates.expired')

if [ "$EXPIRED" -gt 0 ]; then
  echo "⚠️ WARNING: $EXPIRED expired certificate(s)"
  # Send notification
  exit 1
fi

echo "✅ All certificates healthy"
```

---

## 🔧 Common Tasks

### View All Metrics

```bash
# Prometheus format
curl http://localhost:3000/metrics

# JSON format
curl http://localhost:3000/metrics/json | jq
```

### Create Backup

```bash
curl -X POST http://localhost:3000/certificates/backup
```

### Download Backup

```bash
# List backups
BACKUPS=$(curl -s http://localhost:3000/certificates/backup)

# Get filename
FILENAME=$(echo $BACKUPS | jq -r '.[0].filename')

# Download
curl http://localhost:3000/certificates/backup/$FILENAME -o backup.zip
```

### Check Certificate Health

```bash
curl http://localhost:3000/certificates | jq '.[] | 
  {domain: .domains[0], status, days: .daysUntilExpiry}'
```

### Test Rate Limiting

```bash
# Should get 429 after limit exceeded
for i in {1..50}; do
  echo "Request $i:"
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/certificates
  sleep 0.1
done
```

---

## 📊 Monitoring Dashboard

### Command-Line Dashboard

```bash
#!/bin/bash
# dashboard.sh

while true; do
  clear
  echo "╔════════════════════════════════════════╗"
  echo "║  LyttleNGINX Certificate Dashboard    ║"
  echo "╚════════════════════════════════════════╝"
  
  METRICS=$(curl -s http://localhost:3000/metrics/json)
  
  echo "Certificates:"
  echo "  Total:    $(echo $METRICS | jq '.certificates.total')"
  echo "  Valid:    $(echo $METRICS | jq '.certificates.valid') ✅"
  echo "  Expiring: $(echo $METRICS | jq '.certificates.expiringSoon') ⚠️"
  echo "  Expired:  $(echo $METRICS | jq '.certificates.expired') ❌"
  echo ""
  echo "Press Ctrl+C to exit"
  
  sleep 5
done
```

---

## 🚨 Alert Testing

### Test Email Alerts

```bash
# 1. Configure SMTP in .env
# 2. Restart: docker-compose restart app
# 3. Check logs
docker-compose logs app | grep -i "email"

# Should see: "[Alert] Email alerts enabled"
```

### Test Slack Alerts

```bash
# 1. Get webhook URL from Slack
# 2. Add to .env: SLACK_WEBHOOK_URL=https://...
# 3. Restart: docker-compose restart app
# 4. Check logs
docker-compose logs app | grep -i "webhook"

# Should see: "[Alert] Webhook alerts enabled (slack)"
```

### Manual Alert Trigger

The monitoring service runs daily at 9 AM. To test immediately:

```bash
# Check if any certificates are expiring or expired
curl http://localhost:3000/certificates | jq '.[] | 
  select(.status != "valid") | 
  {domain: .domains[0], status, days: .daysUntilExpiry}'

# If any exist, alerts will be sent during next scheduled check
# Monitor logs: docker-compose logs -f app | grep Alert
```

---

## 🐛 Troubleshooting

### Build Fails

```bash
# Clean build
rm -rf node_modules dist
npm install
npm run build
```

### Metrics Not Showing

```bash
# Test endpoint
curl http://localhost:3000/metrics

# Check if app is running
docker-compose ps

# Check logs
docker-compose logs app | tail -50
```

### Alerts Not Sending

```bash
# Check configuration
docker-compose exec app printenv | grep -E "(ALERT|SMTP|SLACK|DISCORD)"

# Check if alert service initialized
docker-compose logs app | grep -i "alert"

# Test SMTP connection
# Use: telnet smtp.gmail.com 587
```

### Backup Fails

```bash
# Check backup directory
docker-compose exec app ls -la /var/backups/certificates

# Check disk space
docker-compose exec app df -h

# Check permissions
docker-compose exec app mkdir -p /var/backups/certificates
```

### Rate Limiting Too Strict

Edit `src/rate-limit/rate-limit.module.ts`:

```typescript
{
    name: 'short',
        ttl
:
    1000,
        limit
:
    20,  // Increase from 10
}
```

Then rebuild: `npm run build && docker-compose restart app`

---

## 📈 Performance Tips

### Optimize Metrics Collection

```typescript
// Cache metrics for 30 seconds
private
metricsCache: {
    data: any;
    timestamp: number
}
|
null = null;

async
getCachedMetrics()
{
    const now = Date.now();
    if (this.metricsCache && now - this.metricsCache.timestamp < 30000) {
        return this.metricsCache.data;
    }

    const data = await this.getMetrics();
    this.metricsCache = {data, timestamp: now};
    return data;
}
```

### Backup Rotation

```bash
# Keep only last 30 days of backups
find /var/backups/certificates -name "*.zip" -mtime +30 -delete
```

### Alert Throttling

Alerts are already throttled by running daily at 9 AM. To change:

Edit `src/certificate/certificate-monitor.service.ts`:

```typescript
@Cron(CronExpression.EVERY_12_HOURS)  // Change from EVERY_DAY_AT_9AM
async
checkCertificateHealth()
{ ...
}
```

---

## ✅ Feature Checklist

- [x] Input validation working
- [x] Rate limiting active
- [x] Metrics endpoint responding
- [x] Backup creation working
- [ ] Email alerts configured
- [ ] Slack alerts configured
- [ ] Prometheus scraping configured
- [ ] Grafana dashboard created
- [ ] Automated backups scheduled
- [ ] Alert testing completed

---

## 🎯 Next Steps

### Today

1. ✅ Configure `.env` file
2. ✅ Test basic features
3. ✅ Create first backup

### This Week

4. Configure alert channels (email/Slack)
5. Set up Prometheus scraping
6. Create Grafana dashboard
7. Schedule automated backups

### This Month

8. Monitor metrics regularly
9. Review backup retention policy
10. Document operational procedures
11. Train team on new features

---

## 📞 Quick Links

- **Documentation:** `ENHANCED_FEATURES.md`
- **API Reference:** `API_REFERENCE_ENHANCED.md`
- **Troubleshooting:** `TLS_DOCUMENTATION.md`
- **Configuration:** `.env.example`

---

**You're all set! 🚀 Your enhanced LyttleNGINX is ready for production!**

