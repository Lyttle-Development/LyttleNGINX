# Current architecture overview

Last updated: 2026-05-28

This document describes the architecture that is actually present in the repository today. It is intentionally grounded in shipped code and current operator workflows, not just in the longer-term target architecture.

> Status note: treat this as the current implementation baseline. Final rollout decisions should be made together with [`FINAL_PRODUCTION_CHECKLIST.md`](../../FINAL_PRODUCTION_CHECKLIST.md) and [`PRODUCTION_DEFERMENT_REGISTER.md`](../../PRODUCTION_DEFERMENT_REGISTER.md).

## 1. System shape

LyttleNGINX currently consists of a **NestJS control plane plus local NGINX runtime** backed by **PostgreSQL**.

At a high level:

- **NestJS application**
  - admin and internal control-plane APIs
  - auth, RBAC, and audit hooks
  - cluster lease and operation tracking
  - certificate lifecycle orchestration
  - backup and restore logic
  - health, metrics, and structured operational logging
- **NGINX runtime**
  - serves proxied traffic
  - serves ACME HTTP-01 challenges from shared state
  - consumes staged runtime releases under `/etc/nginx/runtime`
- **PostgreSQL**
  - source of truth for proxy entries, certificates, orders, ACME challenges, leases, operations, ACKs, and audit events
- **Filesystem runtime state**
  - staged NGINX release directories and metadata
  - local certificate material synchronized from the database
  - encrypted backup artifacts
  - ACME account private key file when configured

## 2. Request classes and trust boundaries

The API is **authenticated by default**.

### Public allowlist

These routes are intentionally public:

- `GET /health/live`
- `GET /health/startup`
- `GET /health/ready`
- `GET /health/dependencies`
- `GET /health/deep`
- `GET /health`
- `GET /ready`
- `GET /metrics`
- `GET /metrics/json`
- `GET /.well-known/acme-challenge/:token`

### Authenticated admin and internal traffic

All other routes require one of:

- `Authorization: Bearer <jwt>`
- `X-API-Key: <key>`
- `Authorization: ApiKey <key>`

Current actor types:

- `admin`
- `internal-node`

Current RBAC catalog:

- `viewer`
- `operator`
- `security-admin`
- `platform-admin`
- `internal-node`

## 3. Runtime topology today

The shipped deployment model is still a **combined runtime**:

- NestJS and NGINX run in the same container
- `docker-entrypoint.sh` supervises both processes
- if either process exits unexpectedly, the container exits non-zero so Docker or Swarm can restart it

This is materially safer than the earlier masked-failure model, but it is **not** yet the preferred split control-plane/dataplane architecture described in the broader readiness assessment.

## 4. Core control-plane workflows

### 4.1 Health and readiness

Health is split into dedicated routes:

- liveness → `GET /health/live`
- startup → `GET /health/startup`
- readiness → `GET /health/ready`
- dependency drilldown → `GET /health/dependencies`
- full deep view → `GET /health/deep`

The container-level Docker `HEALTHCHECK` uses the liveness route so the scheduler can distinguish “process is running” from deeper dependency failures. Readiness and dependency drilldowns remain the stricter operational surfaces.

Readiness returns non-200 when critical dependencies are unhealthy, including:

- PostgreSQL connectivity
- NGINX master process health
- recent config-apply success
- recent certificate-sync success

### 4.2 Cluster coordination

Cluster leadership is lease-based:

- `ClusterLease` stores leader ownership and generation/fencing state
- `ClusterNode` provides heartbeat and observability data
- cluster-wide mutations are represented as `ClusterOperation` records with per-node `ClusterOperationAck` rows

Operator inspection APIs include:

- `GET /cluster/status`
- `GET /cluster/lease`
- `GET /cluster/leader`
- `GET /cluster/leader/status`
- `GET /cluster/operations`
- `GET /cluster/operations/:operationId`
- `GET /cluster/nodes`
- `GET /cluster/nodes/:nodeId`
- `GET /cluster/nodes/:nodeId/config`
- `GET /cluster/nodes/:nodeId/certificates`

### 4.3 NGINX config rollout

NGINX config deployment is staged and rollback-aware:

- each reload builds a staged release under `/etc/nginx/runtime/releases/<release-id>`
- staged config is validated with `nginx -t` before activation
- activation swaps the `current` symlink atomically
- `last-known-good` is preserved
- failed reload activation triggers automatic rollback
- local release metadata is written to `lyttle-nginx-release.json`

Current limitation:

- there is **not yet** a dedicated first-class API to manually roll back to an arbitrary prior config release
- operator rollback today means either relying on built-in rollback when reload fails or reverting desired state and triggering a fresh reload

### 4.4 Certificate lifecycle

Current workflow primitives include:

- strict normalized domain validation
- durable `CertificateOrder` state
- versioned `CertificateArtifactVersion` history
- ACK-backed artifact activation across the cluster
- rollback to the prior artifact version
- shared PostgreSQL-backed ACME HTTP-01 challenge state
- envelope encryption for stored private keys
- encrypted backup artifacts with signed manifests

Relevant APIs include:

- `GET /certificates`
- `GET /certificates/orders`
- `GET /certificates/orders/:id`
- `POST /certificates/orders/:id/retry`
- `GET /certificates/challenges`
- `POST /certificates/upload`
- `POST /certificates/generate-self-signed`
- `POST /certificates/renew/:id`
- `POST /certificates/renew-all`
- `POST /certificates/artifacts/:artifactId/activate`
- `POST /certificates/:id/rollback`
- `POST /certificates/sync`

### 4.5 Backups and restore

The backup model is:

- encrypted `.lyttlebackup` artifacts
- signed manifest and checksums
- server-side verify endpoint
- server-side restore endpoint
- direct raw PEM export treated as break-glass only

Relevant APIs include:

- `POST /certificates/backup`
- `GET /certificates/backup`
- `GET /certificates/backup/:filename`
- `POST /certificates/backup/:filename/verify`
- `POST /certificates/backup/:filename/restore`
- `POST /certificates/backup/import`
- `GET /certificates/backup/export/:id`

## 5. Observability model

The observability surface has three layers:

### Operational logs

- structured JSON emitted to stdout/stderr
- request correlation IDs
- actor identity context when available
- node and operation context when available
- secret redaction for common sensitive fields

### Audit events

- persisted in PostgreSQL
- exposed separately via `GET /audit`
- capture privileged and mutating actions, denied attempts, and controller/service failures on protected routes

### Health and metrics

- public health and drilldown endpoints
- Prometheus metrics at `GET /metrics`
- JSON metrics at `GET /metrics/json`
- state-based gauges for dependencies, leases, operations, orders, backups, and certificate inventory

## 6. Deployment expectations

| Mode | Current expectation |
| --- | --- |
| Local development | best-supported path for coding and verification |
| Single-node Compose | evaluation and non-HA use; not final hardened production guidance |
| Docker Swarm global mode | target clustered operating model for controlled rollout once the checklist is completed and deferments are accepted |

## 7. Important current limitations

The documentation should stay explicit about the boundaries that still exist today:

1. **Internal node traffic is still authenticated HTTP, not mTLS**
   - node identity and RBAC exist
   - transport-level mutual TLS is still future work
2. **NestJS and NGINX still share a single container**
   - supervision is fail-fast now
   - the split control-plane/dataplane target architecture is not implemented yet
3. **Secret ingestion is still environment-variable driven**
   - docs recommend Swarm secrets or an external secret store
   - first-class `*_FILE` or external secret-provider integration is still future work
4. **Manual config rollback is not yet a dedicated API**
   - automatic rollback exists for reload failures
   - logical rollback still requires desired-state reversion plus a new reload

## 8. Incident-navigation map

When something looks wrong, start here:

1. `GET /health/deep`
2. `GET /cluster/status`
3. `GET /cluster/lease`
4. `GET /cluster/operations`
5. `GET /logs`
6. `GET /audit`

Then move into the dedicated runbook:

- leader failure → `docs/runbooks/leader-failure.md`
- config rollback → `docs/runbooks/nginx-config-rollback.md`
- encrypted restore → `docs/runbooks/restore-from-encrypted-backup.md`
- certificate issuance failure → `docs/runbooks/certificate-issuance-failure.md`
- credential rotation → `docs/runbooks/credential-rotation.md`
- break-glass secret handling → `docs/runbooks/security-break-glass.md`
- monitoring and alert response → `docs/runbooks/monitoring-alerts.md`

## 9. Related references

- `README.md`
- `PRODUCTION_READINESS_ASSESSMENT.md`
- `FINAL_PRODUCTION_CHECKLIST.md`
- `PRODUCTION_DEFERMENT_REGISTER.md`
- `ARCHITECTURE_DECISIONS.md`

