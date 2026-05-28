# 🔒 LyttleNGINX

![Session 30 complete](https://img.shields.io/badge/status-session%2030%20complete-blue)
![Phase 10 complete](https://img.shields.io/badge/roadmap-phase%2010%20complete-brightgreen)
![Controlled rollout ready](https://img.shields.io/badge/readiness-controlled%20rollout%20ready-yellowgreen)
![License: UNLICENSED](https://img.shields.io/badge/license-UNLICENSED-red)

**NestJS-based NGINX control plane for proxy configuration, certificate lifecycle automation, cluster coordination, and operator observability.**

> **Current status:** Sessions 1-30 of the implementation plan are complete. Final readiness artifacts now live in [`FINAL_PRODUCTION_CHECKLIST.md`](FINAL_PRODUCTION_CHECKLIST.md) and [`PRODUCTION_DEFERMENT_REGISTER.md`](PRODUCTION_DEFERMENT_REGISTER.md). Treat the repository as ready for a controlled production rollout of the documented current architecture only after the checklist items are completed and the listed deferments are explicitly accepted.

## Current state at a glance

- authenticated-by-default admin API with explicit public probe/metrics/ACME allowlist
- JWT-compatible auth foundation with RBAC roles and durable audit logging
- lease-based cluster leadership plus operation journal and per-node ACK tracking
- staged NGINX release activation with automatic rollback on reload failure
- durable certificate orders, artifact activation/rollback, and shared HTTP-01 challenge handling
- application-layer private-key encryption at rest plus encrypted/signed backup artifacts
- structured JSON operational logs, public health drilldowns, and expanded Prometheus metrics
- classified unit/integration/e2e/chaos test harness plus CI release gates

## Important current boundaries

These constraints are still real and are intentionally documented here:

- **Production rollout still carries accepted deferments.** Review [`PRODUCTION_DEFERMENT_REGISTER.md`](PRODUCTION_DEFERMENT_REGISTER.md) before go-live and make sure the unresolved items are consciously accepted.
- **Internal node traffic is still authenticated HTTP, not mTLS.** Identity and RBAC exist, but transport hardening remains future work.
- **NestJS and NGINX still share a single container.** The runtime is fail-fast and restart-friendly, but the preferred split control-plane/dataplane architecture is not implemented yet.
- **Manual config rollback is not a dedicated API today.** Automatic rollback covers reload failures; logical rollback still requires reverting desired state and reloading.
- **Runtime secret ingestion is still env-driven.** Operators should use Swarm secrets or an external secret store to inject values.

## Deployment expectations

| Mode | Use it for | Current expectation |
| --- | --- | --- |
| Local development | coding, debugging, manual verification | best-supported workflow today |
| Single-node Compose | demos, evaluation, non-HA deployments | usable for evaluation; not final hardened production guidance |
| Docker Swarm global mode | target clustered operating model | ready for controlled rollout when the final checklist is completed and deferments are accepted |

## Quick start

### Prerequisites

- Node.js `24.16.0`
- npm `11.15.0`
- PostgreSQL `12+`
- Docker / Docker Compose or Docker Swarm if you are evaluating container deployment

### Local setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run start:prod
```

### Smoke checks

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/metrics/json
```

### Example authenticated checks

```bash
curl http://localhost:3000/auth/status \
  -H "X-API-Key: $API_KEY"

curl http://localhost:3000/certificates \
  -H "Authorization: Bearer $JWT"
```

## Repository verification

The current repository verification contract is:

```bash
npm run lint
npm run lint:ci
npm run typecheck
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:chaos
npm run test:coverage
npm run test:coverage:ci
npm run build
npm run audit:prod
npm run verify
npm run verify:ci
```

`npm run test` executes the full classified harness, including the deterministic chaos suite introduced in Session 27.

## Public vs protected API surface

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

### Authenticated admin or internal routes

Everything else should be treated as protected control-plane traffic and requires one of:

- `Authorization: Bearer <jwt>`
- `X-API-Key: <key>`
- `Authorization: ApiKey <key>`

### Current RBAC catalog

- `viewer`
- `operator`
- `security-admin`
- `platform-admin`
- `internal-node`

## What is implemented today

### Cluster operations

Key operator-facing endpoints:

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
- `POST /cluster/reload`

### Certificates and backup/restore

- `GET /certificates`
- `GET /certificates/orders`
- `GET /certificates/orders/:id`
- `POST /certificates/orders/:id/retry`
- `GET /certificates/challenges`
- `POST /certificates/upload`
- `POST /certificates/generate-self-signed`
- `POST /certificates/renew/:id`
- `POST /certificates/renew-all`
- `POST /certificates/:id/rollback`
- `POST /certificates/sync`
- `POST /certificates/backup`
- `GET /certificates/backup`
- `POST /certificates/backup/:filename/verify`
- `POST /certificates/backup/:filename/restore`
- `POST /certificates/backup/import`
- `GET /certificates/backup/export/:id` *(break-glass only)*

### Security and observability

- `GET /auth/status`
- `GET /auth/info`
- `GET /auth/me`
- `POST /auth/token`
- `GET /audit`
- `GET /logs`
- `GET /security/status`
- `GET /security/policy`
- `GET /security/secrets/health`
- `GET /security/access-review`
- `POST /security/rotate/api-key`
- `POST /security/rotate/private-key-encryption`
- `POST /security/rotate/internal-certs` *(forward-looking contract; mTLS rotation not implemented yet)*

## Certificate strategy notes

The shipped Session 18 implementation is intentionally conservative:

- built-in ACME strategy is shared **HTTP-01**
- wildcard issuance is intentionally rejected
- any node can serve shared challenge records from the database
- certificate activation is tracked as a cluster operation with node ACKs
- private keys are encrypted at rest in PostgreSQL
- backup artifacts are encrypted and signed

## Documentation map

### Canonical project docs

- [`PRODUCTION_READINESS_ASSESSMENT.md`](PRODUCTION_READINESS_ASSESSMENT.md) — current risk inventory and production gap analysis
- [`IMPLEMENTATION_PLAN_BY_SESSION.md`](IMPLEMENTATION_PLAN_BY_SESSION.md) — roadmap and acceptance criteria
- [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) — session-by-session shipped status
- [`FINAL_PRODUCTION_CHECKLIST.md`](FINAL_PRODUCTION_CHECKLIST.md) — final assessment reconciliation and go-live checklist
- [`PRODUCTION_DEFERMENT_REGISTER.md`](PRODUCTION_DEFERMENT_REGISTER.md) — accepted gaps, compensating controls, and follow-up work
- [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) — ADR log across all sessions
- [`docs/architecture/current-architecture.md`](docs/architecture/current-architecture.md) — current implementation architecture and explicit boundaries

### Runbooks

- [`docs/runbooks/leader-failure.md`](docs/runbooks/leader-failure.md)
- [`docs/runbooks/nginx-config-rollback.md`](docs/runbooks/nginx-config-rollback.md)
- [`docs/runbooks/restore-from-encrypted-backup.md`](docs/runbooks/restore-from-encrypted-backup.md)
- [`docs/runbooks/certificate-issuance-failure.md`](docs/runbooks/certificate-issuance-failure.md)
- [`docs/runbooks/credential-rotation.md`](docs/runbooks/credential-rotation.md)
- [`docs/runbooks/security-break-glass.md`](docs/runbooks/security-break-glass.md)
- [`docs/runbooks/monitoring-alerts.md`](docs/runbooks/monitoring-alerts.md)

## Incident-first operator flow

When a node or workflow looks unhealthy, start with:

```bash
curl http://localhost:3000/health/deep | jq
curl http://localhost:3000/cluster/status -H "Authorization: Bearer $JWT" | jq
curl http://localhost:3000/cluster/lease -H "Authorization: Bearer $JWT" | jq
curl http://localhost:3000/cluster/operations -H "Authorization: Bearer $JWT" | jq
curl http://localhost:3000/logs -H "Authorization: Bearer $JWT" | jq
curl http://localhost:3000/audit -H "Authorization: Bearer $JWT" | jq
```

Then move into the dedicated runbook for the incident type.

## Deployment notes

### Single-node Compose

Use [`docker-compose.yml`](docker-compose.yml) for local or single-node evaluation.

### Swarm

Use [`docker-compose.swarm.yml`](docker-compose.swarm.yml) for controlled clustered testing.

Important current Swarm notes:

- peer communication uses explicit advertised control-plane settings (`CLUSTER_CONTROL_ADDRESS`, `CLUSTER_CONTROL_PORT`, or `CLUSTER_CONTROL_URL`)
- treat `CLUSTER_CONTROL_PORT` as the peer-facing port other nodes must dial; do not assume it matches PORT
- cluster leadership uses durable lease state with generation/fencing metadata
- cluster-wide reload and certificate activation flows use tracked operation IDs and per-node ACKs
- internal node transport is still authenticated HTTP, not mTLS

## Security reporting

For now, follow the project’s internal security process and review the current posture endpoints before performing high-risk maintenance:

- `GET /security/status`
- `GET /security/policy`
- `GET /security/secrets/health`
- `GET /security/access-review`

## License

UNLICENSED - Private project by Lyttle Development
