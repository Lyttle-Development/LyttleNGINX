# LyttleNGINX - Global Deployment Guide for Docker Swarm

## Overview

This guide explains how to deploy LyttleNGINX in **global mode** across your Docker Swarm cluster. Each node will run one instance of the application, with built-in distributed coordination to prevent certificate conflicts.

## Key Features

### 🔒 Distributed Locking

- Uses PostgreSQL advisory locks for coordination
- Prevents multiple nodes from requesting the same certificate simultaneously
- Leader election ensures only one node handles periodic renewal tasks

### 🏥 Enhanced Health Checks

- Multi-level health monitoring (NGINX, Node.js, Database, Configuration)
- Automatic failure detection and recovery
- Graceful shutdown handling

### 🔄 Zero-Downtime Updates

- Start-first update strategy
- Automatic rollback on failure
- Configurable monitoring periods

### 📊 Robust Failure Handling

- Automatic restart with exponential backoff
- Failure mode protection (prevents restart loops)
- State tracking for debugging

## Prerequisites

### 1. Docker Swarm Cluster

Ensure your Docker Swarm is initialized:

```bash
docker swarm init
# Or join existing swarm
docker swarm join --token <token> <manager-ip>:2377
```

### 2. PostgreSQL Database

You need a PostgreSQL database accessible from all nodes:

```bash
# Example: Deploy PostgreSQL in the swarm
docker service create \
  --name postgres \
  --network lyttlenginx-net \
  --publish 5432:5432 \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=lyttlenginx \
  --mount type=volume,src=postgres-data,dst=/var/lib/postgresql/data \
  postgres:16
```

### 3. Shared Storage for Certificates

For production deployments, you need shared storage for Let's Encrypt certificates:

#### Option A: NFS (Recommended)

```bash
# On NFS server
sudo apt-get install nfs-kernel-server
sudo mkdir -p /mnt/lyttlenginx/letsencrypt
sudo chown nobody:nogroup /mnt/lyttlenginx/letsencrypt
sudo chmod 755 /mnt/lyttlenginx/letsencrypt

# Add to /etc/exports
echo "/mnt/lyttlenginx/letsencrypt *(rw,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports
sudo exportfs -ra
sudo systemctl restart nfs-kernel-server

# On each Docker node
sudo apt-get install nfs-common
```

#### Option B: GlusterFS

```bash
# Install GlusterFS on all nodes
sudo apt-get install glusterfs-server
sudo systemctl start glusterd
sudo systemctl enable glusterd

# Create volume (on one node)
sudo gluster volume create letsencrypt-vol replica 3 \
  node1:/data/gluster/letsencrypt \
  node2:/data/gluster/letsencrypt \
  node3:/data/gluster/letsencrypt
sudo gluster volume start letsencrypt-vol
```

#### Option C: Docker Volume Plugin

```bash
# Install a distributed volume plugin
docker plugin install --grant-all-permissions \
  trajano/nfs-volume-plugin
```

## Deployment Steps

### 1. Set Environment Variables

Create a `.env` file or set environment variables:

```bash
# Database
export DATABASE_URL="postgresql://user:password@postgres-host:5432/lyttlenginx"

# Admin configuration
export ADMIN_EMAIL="admin@yourdomain.com"
export API_KEY="your-secure-api-key-here"
export JWT_SECRET="your-jwt-secret-here"

# NFS configuration (if using NFS)
export NFS_SERVER="10.0.0.1"
export NFS_PATH="/mnt/lyttlenginx/letsencrypt"

# Optional: Email notifications
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USER="your-email@gmail.com"
export SMTP_PASS="your-app-password"
export SMTP_FROM="noreply@yourdomain.com"
```

### 2. Build and Push Image

```bash
# Build the image
docker build -t ghcr.io/lyttle-development/lyttlenginx:main .

# Push to registry
docker push ghcr.io/lyttle-development/lyttlenginx:main
```

### 3. Deploy to Swarm

```bash
# Deploy using the stack file
docker stack deploy -c docker-compose.swarm.yml lyttlenginx

# Or with environment file
docker stack deploy -c docker-compose.swarm.yml --env-file .env lyttlenginx
```

### 4. Verify Deployment

```bash
# Check service status
docker service ls

# Check running tasks (one per node in global mode)
docker service ps lyttlenginx_lyttlenginx

# Check logs from all instances
docker service logs -f lyttlenginx_lyttlenginx

# Check which node is the leader
docker service logs lyttlenginx_lyttlenginx | grep "LEADER"
```

## Monitoring

### Health Checks

Each instance performs continuous health checks:

```bash
# Check health status
docker ps --filter "name=lyttlenginx" --format "{{.Names}}: {{.Status}}"
```

### Leader Status

Only one instance (the leader) performs certificate renewals:

```bash
# Find the leader
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "This instance is now the LEADER"
```

### Database Advisory Locks

Check active locks in PostgreSQL:

```sql
SELECT locktype,
       objid,
       mode,
       granted,
       pid
FROM pg_locks
WHERE locktype = 'advisory';
```

## Updating the Application

### Rolling Update

```bash
# Update to new version
docker service update \
  --image ghcr.io/lyttle-development/lyttlenginx:v2.0.0 \
  lyttlenginx_lyttlenginx

# Monitor update progress
docker service ps lyttlenginx_lyttlenginx
```

### Rollback

```bash
# Rollback to previous version
docker service rollback lyttlenginx_lyttlenginx
```

## Troubleshooting

### Problem: Certificate conflicts between nodes

**Solution**: This should not happen with the distributed locking system. Check logs:

```bash
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "Lock"
```

### Problem: No leader elected

**Solution**: Check database connectivity:

```bash
# Enter a container
docker exec -it $(docker ps -q -f name=lyttlenginx) bash

# Test database connection
node -e "console.log(process.env.DATABASE_URL)"
npx prisma db execute --stdin <<< "SELECT 1"
```

### Problem: Health checks failing

**Solution**: Run manual health check:

```bash
docker exec -it $(docker ps -q -f name=lyttlenginx) /healthcheck.sh
```

### Problem: Containers in restart loop

**Solution**: The entrypoint has built-in restart protection. Check state files:

```bash
docker exec -it $(docker ps -q -f name=lyttlenginx) cat /app/state/restart.count
docker exec -it $(docker ps -q -f name=lyttlenginx) cat /app/state/restart.state
```

To reset:

```bash
docker exec -it $(docker ps -q -f name=lyttlenginx) rm -f /app/state/*
```

### Problem: Shared storage not working

**Solution**: Verify NFS mount on all nodes:

```bash
# On each node
docker volume inspect lyttlenginx_letsencrypt-data
sudo mount | grep letsencrypt
```

## Scaling

### Add Nodes to Cluster

When you add a new node to the swarm, LyttleNGINX will automatically deploy to it:

```bash
# On new node, join swarm
docker swarm join --token <token> <manager-ip>:2377

# Service will automatically deploy to new node
docker service ps lyttlenginx_lyttlenginx
```

### Remove Nodes

```bash
# Drain node before removal
docker node update --availability drain <node-id>

# Remove node
docker swarm leave --force  # On the node itself
```

## Performance Tuning

### Resource Limits

Adjust in `docker-compose.swarm.yml`:

```yaml
resources:
  limits:
    cpus: '4'      # Increase for high-traffic nodes
    memory: 4G
  reservations:
    cpus: '1'
    memory: 1G
```

### Certificate Renewal Interval

Set environment variable:

```bash
export CERT_RENEWAL_INTERVAL_HOURS=12  # Default is 12 hours
```

### Rate Limiting

Configure via environment:

```bash
export RATE_LIMIT_TTL=60
export RATE_LIMIT_MAX=100
```

## Security Considerations

1. **Use secrets for sensitive data**:

```bash
echo "my-database-password" | docker secret create db_password -
echo "my-jwt-secret" | docker secret create jwt_secret -

# Update docker-compose.swarm.yml to use secrets
```

2. **Network isolation**: Consider using overlay networks instead of host mode if you don't need direct port binding

3. **Database access**: Use SSL/TLS for database connections:

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
```

4. **Regular updates**: Keep the base image and dependencies updated

## Backup and Recovery

### Backup Database

```bash
# Backup PostgreSQL
docker exec postgres pg_dump -U user lyttlenginx > backup.sql
```

### Backup Certificates

```bash
# Backup Let's Encrypt certificates (from NFS server)
sudo tar -czf letsencrypt-backup-$(date +%Y%m%d).tar.gz /mnt/lyttlenginx/letsencrypt
```

### Restore

```bash
# Restore database
docker exec -i postgres psql -U user lyttlenginx < backup.sql

# Restore certificates
sudo tar -xzf letsencrypt-backup-YYYYMMDD.tar.gz -C /
```

## Migration from Single Instance

If you're currently running in replicated mode with 1 replica:

1. **Deploy global mode alongside**:

```bash
# Rename old service
docker service update --name lyttlenginx-old lyttlenginx

# Deploy new global service
docker stack deploy -c docker-compose.swarm.yml lyttlenginx
```

2. **Verify new deployment**:

```bash
docker service ps lyttlenginx_lyttlenginx
```

3. **Remove old service**:

```bash
docker service rm lyttlenginx-old
```

## Support

For issues or questions:

- Check logs: `docker service logs -f lyttlenginx_lyttlenginx`
- Review health checks: `docker ps -a`
- Database locks: Check pg_locks table
- GitHub Issues: https://github.com/lyttle-development/lyttlenginx

## License

UNLICENSED - Private use only

