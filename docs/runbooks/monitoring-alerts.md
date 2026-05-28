# Monitoring and alert recommendations

Last updated: 2026-05-28

This runbook captures the recommended Prometheus/Grafana alert surface for the current implementation.
It is intentionally focused on the metrics that now exist in `GET /metrics` and the richer dependency drilldowns in `GET /health/dependencies` and `GET /health/deep`.

## Primary scrape targets

- `GET /metrics`
  - Prometheus text exposition
  - cluster, certificate, backup, and dependency gauges
- `GET /metrics/json`
  - dashboard/debug-friendly JSON view of the same data
- `GET /health/ready`
  - orchestration readiness gate
- `GET /health/dependencies`
  - dependency drilldown for DB, NGINX, config apply, and certificate sync freshness
- `GET /health/deep`
  - combined liveness/startup/readiness/dependency report for incident triage

## Recommended alert rules

### 1. Control-plane dependency health

Alert when any of these stay unhealthy for more than a short debounce window:

- `lyttle_db_connectivity_status == 0`
- `lyttle_nginx_master_process_status == 0`
- `lyttle_config_apply_status == 0`
- `lyttle_certificate_sync_status == 0`
- `lyttle_health_dependency_status{name!="database"} == 0`

Suggested severity:

- critical: database, NGINX master, config apply
- warning: certificate sync freshness

Suggested action:

1. inspect `GET /health/dependencies`
2. inspect recent structured logs via platform log shipping or `GET /logs`
3. confirm whether the node should be drained or restarted

### 2. Leader / lease health

Alert when:

- `lyttle_cluster_leader_present == 0`
- `lyttle_cluster_leader_lease_expired == 1`
- `lyttle_cluster_leader_lease_seconds_remaining < 10`
- `lyttle_cluster_leases_expired > 0` for a sustained period

Suggested severity:

- critical: no leader, expired leader lease
- warning: leader lease close to expiry repeatedly

Suggested action:

1. inspect `GET /cluster/lease`
2. inspect `GET /cluster/status`
3. verify PostgreSQL availability and cluster heartbeat freshness

### 3. Cluster operation convergence

Alert when:

- `lyttle_cluster_operations_stale_total > 0`
- `lyttle_cluster_operations_recent_failures_total > 0`
- `lyttle_cluster_operation_acks_total{status="failed"} > 0`

Suggested action:

1. inspect `GET /cluster/operations`
2. drill into the failed `operationId`
3. inspect per-node status via `GET /cluster/nodes/:nodeId`

### 4. Certificate lifecycle drift

Alert when:

- `lyttle_certificate_orders_stale_total > 0`
- `lyttle_certificate_orders_retry_due_total > 0` for too long
- `lyttle_certificates_expired > 0`
- `lyttle_certificates_expiring_soon > 0` with low operator coverage

Suggested action:

1. inspect `GET /certificates/orders`
2. inspect `GET /certificates/challenges` for active HTTP-01 issues
3. review recent certificate activation operations in `GET /cluster/operations`

### 5. Backup freshness

Alert when:

- `lyttle_backup_freshness_status == 0`
- `lyttle_backups_total == 0`

Suggested action:

1. create a fresh encrypted backup
2. verify the new artifact with `POST /certificates/backup/:filename/verify`
3. investigate backup storage volume availability and permissions

### 6. Metrics self-observability

Alert when:

- `lyttle_metrics_collection_errors_total > 0`
- `lyttle_metrics_collection_status{section="health"} == 0`
- `up{job="lyttlenginx"} == 0`

Suggested action:

1. determine whether the problem is scrape transport, app health, or a single failing metrics section
2. inspect the `collection.errors` payload from `GET /metrics/json`
3. use `GET /health/deep` to confirm whether the process is still serving requests safely

## Example Prometheus rule snippets

```yaml
groups:
  - name: lyttle-nginx-control-plane
    rules:
      - alert: LyttleNginxDatabaseUnavailable
        expr: lyttle_db_connectivity_status == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: LyttleNGINX database connectivity failed
          description: Inspect /health/dependencies and recent control-plane logs.

      - alert: LyttleNginxNoLeader
        expr: lyttle_cluster_leader_present == 0 or lyttle_cluster_leader_lease_expired == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: LyttleNGINX cluster has no healthy leader lease
          description: Inspect /cluster/lease and /cluster/status.

      - alert: LyttleNginxStaleClusterOperation
        expr: lyttle_cluster_operations_stale_total > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Cluster operation is stuck past the stale threshold
          description: Inspect /cluster/operations for failed or long-running work.

      - alert: LyttleNginxCertificateOrdersStale
        expr: lyttle_certificate_orders_stale_total > 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: Certificate order workflow is stale
          description: Inspect /certificates/orders and /certificates/challenges.

      - alert: LyttleNginxBackupStale
        expr: lyttle_backup_freshness_status == 0
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: No fresh encrypted backup is available
          description: Create and verify a fresh backup artifact.
```

## Dashboard recommendations

Minimum dashboard panels:

- DB connectivity status and latency
- NGINX master status
- config apply age vs max age
- certificate sync age vs max age
- leader lease seconds remaining and generation
- cluster operations by status and recent failure count
- certificate orders by status and stale count
- certificate expiry distribution
- backup freshness and total retained artifacts

## Operational notes

- Treat `/health/ready` as the deployment/orchestration gate.
- Treat `/health/dependencies` and `/health/deep` as diagnosis surfaces, not just binary probes.
- Prefer alerting on gauges that represent *current bad state* or *recent failure windows* instead of all-time counts.
- When a Prometheus alert fires, capture the matching `operationId`, `correlationId`, or `nodeId` from logs and cluster-operation APIs for faster triage.

