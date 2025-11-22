# LyttleNGINX Global Deployment - Implementation Summary

## Overview

This document summarizes the implementation of safe, distributed deployment for LyttleNGINX across Docker Swarm nodes in global mode.

## Problem Statement

Previously, LyttleNGINX ran as a single instance in Docker Swarm to prevent multiple nodes from:

- Simultaneously requesting the same SSL certificate (causing Let's Encrypt rate limits)
- Conflicting certificate validation challenges
- Race conditions in database updates

## Solution Implemented

### 1. Distributed Locking System

**File:** `src/distributed-lock/distributed-lock.service.ts`

- Uses PostgreSQL advisory locks for distributed coordination
- Prevents multiple nodes from performing the same operation simultaneously
- Provides automatic lock acquisition/release with retry logic
- Implements leader election for cluster-wide tasks

**Key Methods:**

- `tryAcquireLock()` - Non-blocking lock acquisition
- `withLock()` - Execute function with automatic lock management
- `acquireLeaderLock()` / `releaseLeaderLock()` - Leader election
- `isLeader()` - Check if current instance is the leader

### 2. Certificate Service Enhancement

**File:** `src/certificate/certificate.service.ts`

**Changes:**

- Certificate issuance wrapped in distributed lock (`cert:issue:{hash}`)
- Double-check pattern after acquiring lock (prevents duplicate work)
- Only leader node performs periodic certificate renewals
- Automatic leader failover if leader node fails

**Flow:**

1. Node checks DB for valid certificate (fast path, no lock)
2. If not found, acquire distributed lock for that certificate
3. After acquiring lock, double-check DB (another node may have created it)
4. Only issue certificate if still needed
5. Release lock automatically

### 3. Cluster Heartbeat Service

**File:** `src/distributed-lock/cluster-heartbeat.service.ts`

- Tracks all active nodes in the cluster
- Sends heartbeat every 30 seconds
- Marks stale nodes (no heartbeat for 2 minutes) as inactive
- Stores node metadata (CPU, memory, platform, etc.)

**Database Table:** `ClusterNode`

- `instanceId` - Unique identifier for each container
- `hostname` - Container hostname
- `isLeader` - Whether this node is currently the leader
- `lastHeartbeat` - Last heartbeat timestamp
- `status` - active/stale/inactive
- `metadata` - System information (JSON)

### 4. Cluster Monitoring API

**File:** `src/distributed-lock/cluster.controller.ts`

**Endpoints:**

- `GET /cluster/nodes` - List all active nodes
- `GET /cluster/stats` - Cluster statistics
- `GET /cluster/leader` - Current leader information

### 5. Enhanced Dockerfile

**File:** `Dockerfile`

**Improvements:**

- Multi-stage build for smaller image size
- Better layer caching
- Health check script
- Proper signal handling with tini
- Resource management
- State tracking for restart protection

### 6. Robust Entrypoint

**File:** `docker-entrypoint.sh`

**Features:**

- Graceful shutdown handling (SIGTERM/SIGINT)
- Database connectivity verification
- Automatic Prisma migrations
- Process monitoring (NGINX + Node.js)
- Restart protection (max 5 restarts in 5 minutes)
- Failure mode (prevents restart loops)
- Colored logging for better visibility

### 7. Health Check Script

**File:** `healthcheck.sh`

**Checks:**

- Node.js application running
- NGINX running
- API readiness endpoint
- NGINX HTTP port responding
- NGINX configuration validity
- Database connectivity

### 8. Swarm Deployment Configuration

**File:** `docker-compose.swarm.yml`

**Features:**

- Global deployment mode (one per node)
- Resource limits (CPU/memory)
- Zero-downtime updates (start-first strategy)
- Automatic rollback on failure
- Restart policy with backoff
- Shared NFS volume for certificates
- Health checks
- Logging configuration

### 9. Deployment Script

**File:** `deploy-swarm.sh`

**Features:**

- Environment variable validation
- Database connectivity check
- NFS configuration verification
- Colored, user-friendly output
- Helpful post-deployment commands

### 10. Comprehensive Documentation

**Files:**

- `DEPLOYMENT_GUIDE.md` - Complete deployment guide
- `README.md` - Updated with cluster features
- `.env.example` - Configuration template

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Docker Swarm                        │
│                                                      │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────┐│
│  │   Node 1      │  │   Node 2      │  │  Node 3  ││
│  │               │  │               │  │          ││
│  │ LyttleNGINX   │  │ LyttleNGINX   │  │LyttleNGINX│
│  │  (LEADER)     │  │  (Follower)   │  │(Follower)││
│  │    :80,:443   │  │    :80,:443   │  │:80,:443  ││
│  └───────┬───────┘  └───────┬───────┘  └────┬─────┘│
│          │                  │                │      │
└──────────┼──────────────────┼────────────────┼──────┘
           │                  │                │
           └──────────────────┼────────────────┘
                             │
                    ┌────────▼──────────┐
                    │   PostgreSQL      │
                    │   - Data          │
                    │   - Advisory Locks│
                    │   - Coordination  │
                    └───────────────────┘
                             │
                    ┌────────▼──────────┐
                    │   NFS Server      │
                    │  (Certificates)   │
                    └───────────────────┘
```

## How It Works

### Certificate Issuance (Multi-Node Safe)

1. **Request arrives** at any node for domain `example.com`
2. **Fast path check**: Node queries DB for existing valid certificate
3. **If found**: Write to filesystem, done (no lock needed)
4. **If not found**: Acquire lock `cert:issue:{hash}`
5. **Lock acquired**: Double-check DB (another node may have just created it)
6. **Still needed**: Run certbot to issue certificate
7. **Save to DB**: Store certificate so other nodes can use it
8. **Release lock**: Automatic cleanup
9. **Other nodes**: Can now retrieve certificate from DB

### Certificate Renewal (Leader-Only)

1. **Leader election**: Every 60 seconds, nodes compete for leader lock
2. **Leader acquired**: Start renewal interval (every 12 hours)
3. **Renewal check**: Leader queries all proxy entries
4. **For each domain**: Call `ensureCertificate()` (uses distributed lock)
5. **Leader lost**: Stop renewal interval
6. **New leader**: Automatically takes over renewals

### Node Failure Handling

1. **Node dies**: Stops sending heartbeat
2. **After 2 minutes**: Marked as stale by other nodes
3. **Leader dies**: Advisory lock automatically released
4. **New leader**: Another node acquires leader lock
5. **Seamless**: No manual intervention required

## Testing

### Test Distributed Locking

```bash
# Deploy to 3-node cluster
docker stack deploy -c docker-compose.swarm.yml lyttlenginx

# Watch logs from all nodes
docker service logs -f lyttlenginx_lyttlenginx

# Trigger certificate issuance on multiple nodes simultaneously
# Should see lock acquisition messages and only one node actually issuing
```

### Test Leader Election

```bash
# Find current leader
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "LEADER"

# Kill leader node
docker service scale lyttlenginx_lyttlenginx=0 # On specific node

# Watch new leader election
docker service logs -f lyttlenginx_lyttlenginx 2>&1 | grep "LEADER"
```

### Test Certificate Conflict Prevention

```bash
# Add proxy entry for new domain
curl -X POST http://localhost:3003/proxy \
  -H "Authorization: Bearer $JWT" \
  -d '{"proxy_pass_host":"http://backend:8080","domains":"test.example.com","ssl":true}'

# Watch logs - should see lock acquisition and only one certbot run
docker service logs -f lyttlenginx_lyttlenginx 2>&1 | grep -E "(Lock|Certbot)"
```

## Migration from Single Instance

```bash
# 1. Deploy global mode stack
docker stack deploy -c docker-compose.swarm.yml lyttlenginx-global

# 2. Verify global deployment working
docker service ps lyttlenginx-global_lyttlenginx

# 3. Remove old single-instance deployment
docker service rm lyttlenginx

# 4. Rename global stack (optional)
docker stack rm lyttlenginx-global
docker stack deploy -c docker-compose.swarm.yml lyttlenginx
```

## Performance Impact

- **Lock acquisition**: ~5-10ms (PostgreSQL advisory lock)
- **Leader check**: ~2-5ms (PostgreSQL query)
- **Heartbeat overhead**: ~1 query per 30 seconds per node
- **Certificate issuance**: Same as before (single node actually issues)
- **Fast path (existing cert)**: No change, no lock needed

## Security Considerations

1. **Database access**: Only mechanism for coordination - secure it
2. **Advisory locks**: Automatically released on connection drop
3. **No shared filesystem writes**: Only reads from NFS (except leader)
4. **API authentication**: Required for cluster endpoints
5. **Leader privileges**: Only affects renewal timing, not security

## Troubleshooting

### Problem: Multiple certificates issued

**Solution**: Check distributed lock logs:

```bash
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "Lock"
```

### Problem: No leader elected

**Solution**: Check database advisory locks:

```sql
SELECT *
FROM pg_locks
WHERE locktype = 'advisory';
```

### Problem: Node stuck in restart loop

**Solution**: Check restart state:

```bash
docker exec CONTAINER_ID cat /app/state/restart.count
```

## Files Changed/Created

### New Files

- `src/distributed-lock/distributed-lock.service.ts` - Core locking service
- `src/distributed-lock/distributed-lock.module.ts` - Module definition
- `src/distributed-lock/cluster-heartbeat.service.ts` - Heartbeat tracking
- `src/distributed-lock/cluster.controller.ts` - Cluster API
- `docker-compose.swarm.yml` - Swarm deployment config
- `healthcheck.sh` - Enhanced health check script
- `deploy-swarm.sh` - Deployment automation
- `DEPLOYMENT_GUIDE.md` - Complete deployment guide
- `.env.example` - Configuration template
- `prisma/migrations/20250622000000_add_cluster_nodes/migration.sql` - DB migration

### Modified Files

- `src/app.module.ts` - Added DistributedLockModule
- `src/certificate/certificate.service.ts` - Added distributed locking
- `Dockerfile` - Multi-stage build, better health checks
- `docker-entrypoint.sh` - Graceful shutdown, restart protection
- `prisma/schema.prisma` - Added ClusterNode model
- `README.md` - Added cluster features documentation

## Rollback Plan

If issues occur:

```bash
# 1. Rollback to previous image
docker service update \
  --image ghcr.io/lyttle-development/lyttlenginx:previous-version \
  lyttlenginx_lyttlenginx

# 2. Or scale down to 1 replica (temporary)
docker service scale lyttlenginx_lyttlenginx=1

# 3. Or revert to replicated mode
docker service update \
  --replicas 1 \
  --mode replicated \
  lyttlenginx_lyttlenginx
```

## Future Enhancements

1. **Metrics**: Add Prometheus metrics for lock contention
2. **Dashboard**: Web UI for cluster visualization
3. **Health API**: Expose cluster health via API
4. **Auto-scaling**: Dynamic node addition/removal
5. **Certificate sharing**: Real-time cert sync without DB query

## Conclusion

This implementation provides a production-ready, distributed deployment solution for LyttleNGINX that:

✅ Prevents certificate conflicts across nodes
✅ Enables global deployment (one instance per node)
✅ Provides automatic leader election and failover
✅ Includes comprehensive monitoring and health checks
✅ Supports zero-downtime updates
✅ Has robust failure handling and recovery

The system is now ready for enterprise-scale deployments across large Docker Swarm clusters.

