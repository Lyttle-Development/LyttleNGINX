# LyttleNGINX Quick Reference Card

## 🚀 Deployment

### Initial Deploy

```bash
# Set environment variables
export DATABASE_URL="postgresql://..."
export ADMIN_EMAIL="admin@example.com"
export API_KEY="your-api-key"
export JWT_SECRET="your-jwt-secret"
export NFS_SERVER="10.0.0.1"
export NFS_PATH="/mnt/lyttlenginx/letsencrypt"

# Deploy
./deploy-swarm.sh
```

### Check Status

```bash
# Service status
docker service ls
docker service ps lyttlenginx_lyttlenginx

# View logs
docker service logs -f lyttlenginx_lyttlenginx

# Find leader
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "This instance is now the LEADER"
```

## 🔍 Monitoring

### Cluster Status

```bash
# Via API (requires JWT)
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/stats
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/nodes
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/leader
```

### Health Checks

```bash
# Overall health
curl http://localhost:3003/health

# Readiness (more detailed)
curl http://localhost:3003/ready

# Manual health check on container
docker exec CONTAINER_ID /healthcheck.sh
```

### Database Locks

```sql
-- Check advisory locks
SELECT locktype, objid, mode, granted, pid
FROM pg_locks
WHERE locktype = 'advisory';

-- Check cluster nodes
SELECT hostname, instanceId, isLeader, status, lastHeartbeat
FROM "ClusterNode"
ORDER BY lastHeartbeat DESC;
```

## 🔄 Updates

### Rolling Update

```bash
# Update to new version
docker service update \
  --image ghcr.io/lyttle-development/lyttlenginx:v2.0.0 \
  lyttlenginx_lyttlenginx

# Watch progress
watch docker service ps lyttlenginx_lyttlenginx
```

### Rollback

```bash
# Automatic rollback (if configured)
docker service rollback lyttlenginx_lyttlenginx

# Manual rollback to specific version
docker service update \
  --image ghcr.io/lyttle-development/lyttlenginx:v1.0.0 \
  lyttlenginx_lyttlenginx
```

## 🛠️ Troubleshooting

### Container Won't Start

```bash
# Check logs
docker service logs lyttlenginx_lyttlenginx --tail 100

# Check container state
docker ps -a --filter "name=lyttlenginx"

# Check restart count
docker exec CONTAINER_ID cat /app/state/restart.count

# Reset restart state
docker exec CONTAINER_ID rm -f /app/state/*
```

### Certificate Issues

```bash
# Check certificate in DB
docker exec CONTAINER_ID node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.certificate.findMany().then(console.log);
"

# Check filesystem
docker exec CONTAINER_ID ls -la /etc/letsencrypt/live/

# Force renewal (via API with JWT)
curl -X POST http://localhost:3003/certificates/renew \
  -H "Authorization: Bearer $JWT"
```

### No Leader Elected

```bash
# Check database connectivity from each node
docker service ps lyttlenginx_lyttlenginx --format "{{.Node}}" | while read node; do
  echo "Checking $node..."
  docker node ps $node --filter "name=lyttlenginx"
done

# Manually check database from container
docker exec CONTAINER_ID npx prisma db execute --stdin <<< "SELECT 1"
```

### NFS Mount Issues

```bash
# Check volume on each node
docker node ls --format "{{.Hostname}}" | while read node; do
  ssh $node "mount | grep letsencrypt"
done

# Verify NFS server
showmount -e $NFS_SERVER

# Check volume details
docker volume inspect lyttlenginx_letsencrypt-data
```

## 📊 Common Operations

### Add Proxy Entry

```bash
curl -X POST http://localhost:3003/proxy \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "proxy_pass_host": "http://backend:8080",
    "domains": "example.com;www.example.com",
    "ssl": true
  }'
```

### List Proxies

```bash
curl http://localhost:3003/proxy \
  -H "Authorization: Bearer $JWT"
```

### View Certificates

```bash
curl http://localhost:3003/certificates \
  -H "Authorization: Bearer $JWT"
```

### Backup Certificates

```bash
curl -X POST http://localhost:3003/certificates/backup \
  -H "Authorization: Bearer $JWT"

# Download backup
curl http://localhost:3003/certificates/backup/FILENAME \
  -H "Authorization: Bearer $JWT" \
  -o backup.zip
```

## 🔐 Security

### Rotate JWT Secret

```bash
# Update secret
docker service update \
  --env-add JWT_SECRET="new-secret-here" \
  lyttlenginx_lyttlenginx

# All users will need to re-authenticate
```

### View API Keys

```bash
# API keys are in environment variables
docker service inspect lyttlenginx_lyttlenginx \
  --format '{{json .Spec.TaskTemplate.ContainerSpec.Env}}' | jq
```

## 📦 Backup & Recovery

### Full Backup

```bash
# Database
docker exec postgres pg_dump -U user lyttlenginx > db-backup.sql

# Certificates (from NFS)
ssh $NFS_SERVER "tar -czf /tmp/certs.tar.gz /mnt/lyttlenginx/letsencrypt"
scp $NFS_SERVER:/tmp/certs.tar.gz ./certs-backup-$(date +%Y%m%d).tar.gz
```

### Restore

```bash
# Database
docker exec -i postgres psql -U user lyttlenginx < db-backup.sql

# Certificates
scp certs-backup-YYYYMMDD.tar.gz $NFS_SERVER:/tmp/
ssh $NFS_SERVER "tar -xzf /tmp/certs-backup-YYYYMMDD.tar.gz -C /"
```

## 🔧 Maintenance

### Scale Cluster

```bash
# Add new node to swarm
docker swarm join-token worker  # On manager
# Run join command on new node

# LyttleNGINX will automatically deploy to new node
docker service ps lyttlenginx_lyttlenginx
```

### Remove Node

```bash
# Drain node
docker node update --availability drain NODE_ID

# Wait for tasks to move
docker service ps lyttlenginx_lyttlenginx

# Remove node
docker node rm NODE_ID
```

### Clean Up Stale Nodes

```sql
-- Mark stale nodes as inactive
UPDATE "ClusterNode"
SET status = 'inactive'
WHERE lastHeartbeat < NOW() - INTERVAL '10 minutes';

-- Delete old inactive nodes
DELETE
FROM "ClusterNode"
WHERE status = 'inactive'
  AND lastHeartbeat < NOW() - INTERVAL '7 days';
```

## 📈 Performance Tuning

### Adjust Resources

```yaml
# Edit docker-compose.swarm.yml
resources:
  limits:
    cpus: '4'
    memory: 4G
  reservations:
    cpus: '1'
    memory: 1G

# Redeploy
  docker stack deploy -c docker-compose.swarm.yml lyttlenginx
```

### Adjust Renewal Interval

```bash
# Modify certificate renewal check interval (default 12 hours)
# Edit src/certificate/certificate.service.ts
# renewIntervalMs = 1000 * 60 * 60 * 6; // 6 hours
```

## 🆘 Emergency Procedures

### Service Completely Down

```bash
# 1. Check all nodes
docker node ls

# 2. Force update to trigger restart
docker service update --force lyttlenginx_lyttlenginx

# 3. If still failing, check logs
docker service logs lyttlenginx_lyttlenginx --tail 200

# 4. Last resort: remove and redeploy
docker stack rm lyttlenginx
sleep 10
docker stack deploy -c docker-compose.swarm.yml lyttlenginx
```

### Database Connection Lost

```bash
# Check database service
docker service ps postgres  # If DB in swarm

# Test connection from container
docker exec CONTAINER_ID \
  node -e "require('@prisma/client').PrismaClient().raw'SELECT 1'"

# Update DATABASE_URL if changed
docker service update \
  --env-add DATABASE_URL="new-connection-string" \
  lyttlenginx_lyttlenginx
```

### Certificate Rate Limit Hit

```bash
# Check Let's Encrypt rate limits
# https://letsencrypt.org/docs/rate-limits/

# Wait for rate limit to reset (usually weekly)
# Or use staging environment for testing:
# Edit certificate.service.ts, add --staging flag to certbot

# Switch to manual certificates temporarily
curl -X POST http://localhost:3003/certificates/upload \
  -H "Authorization: Bearer $JWT" \
  -F "domains[]=example.com" \
  -F "certPem=@cert.pem" \
  -F "keyPem=@key.pem"
```

## 📞 Support

- Logs: `docker service logs -f lyttlenginx_lyttlenginx`
- Docs: `DEPLOYMENT_GUIDE.md`, `IMPLEMENTATION_SUMMARY.md`
- Health: `curl http://localhost:3003/ready`
- Cluster: `curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/stats`

