# 🔒 LyttleNGINX

<p align="center">
  <img src="https://img.shields.io/badge/status-roadmap--in--progress-yellow" alt="Status" />
  <img src="https://img.shields.io/badge/readiness-not--production--ready-critical" alt="Readiness" />
  <img src="https://img.shields.io/badge/session%201-complete-blue" alt="Session 1" />
  <img src="https://img.shields.io/badge/session%202-complete-blue" alt="Session 2" />
  <img src="https://img.shields.io/badge/session%203-complete-blue" alt="Session 3" />
  <img src="https://img.shields.io/badge/session%204-complete-blue" alt="Session 4" />
  <img src="https://img.shields.io/badge/session%205-complete-blue" alt="Session 5" />
  <img src="https://img.shields.io/badge/session%206-complete-blue" alt="Session 6" />
  <img src="https://img.shields.io/badge/session%207-complete-blue" alt="Session 7" />
  <img src="https://img.shields.io/badge/session%208-complete-blue" alt="Session 8" />
  <img src="https://img.shields.io/badge/session%209-complete-blue" alt="Session 9" />
  <img src="https://img.shields.io/badge/session%2010-complete-blue" alt="Session 10" />
  <img src="https://img.shields.io/badge/session%2011-complete-blue" alt="Session 11" />
  <img src="https://img.shields.io/badge/session%2012-complete-blue" alt="Session 12" />
  <img src="https://img.shields.io/badge/session%2013-complete-blue" alt="Session 13" />
  <img src="https://img.shields.io/badge/session%2014-complete-blue" alt="Session 14" />
  <img src="https://img.shields.io/badge/session%2015-complete-blue" alt="Session 15" />
  <img src="https://img.shields.io/badge/session%2016-complete-blue" alt="Session 16" />
  <img src="https://img.shields.io/badge/session%2017-complete-blue" alt="Session 17" />
  <img src="https://img.shields.io/badge/session%2018-complete-blue" alt="Session 18" />
  <img src="https://img.shields.io/badge/session%2019-complete-blue" alt="Session 19" />
  <img src="https://img.shields.io/badge/session%2020-complete-blue" alt="Session 20" />
  <img src="https://img.shields.io/badge/session%2021-complete-blue" alt="Session 21" />
  <img src="https://img.shields.io/badge/session%2022-complete-blue" alt="Session 22" />
  <img src="https://img.shields.io/badge/session%2023-complete-blue" alt="Session 23" />
  <img src="https://img.shields.io/badge/session%2024-complete-blue" alt="Session 24" />
  <img src="https://img.shields.io/badge/session%2025-complete-blue" alt="Session 25" />
  <img src="https://img.shields.io/badge/session%2026-complete-blue" alt="Session 26" />
  <img src="https://img.shields.io/badge/session%2027-complete-blue" alt="Session 27" />
  <img src="https://img.shields.io/badge/session%2028-complete-blue" alt="Session 28" />
  <img src="https://img.shields.io/badge/license-UNLICENSED-red" alt="License" />
</p>

**NGINX proxy management control plane with certificate automation, monitoring primitives, and an active production-hardening roadmap.**

Built with [NestJS](https://nestjs.com/) • Powered by [PostgreSQL](https://www.postgresql.org/) • Secured by [Let's Encrypt](https://letsencrypt.org/)

> Current state: this repository is under active implementation and hardening. It should **not** currently be treated as production-ready for single-node or Docker Swarm deployment. The current delivery baseline is tracked in `PRODUCTION_READINESS_ASSESSMENT.md`, `IMPLEMENTATION_PLAN_BY_SESSION.md`, `IMPLEMENTATION_STATUS.md`, and `ARCHITECTURE_DECISIONS.md`.

---

## 📍 Current Delivery Status

- **Roadmap status:** Phase 9 in progress
- **Completed in Sessions 1-28 plus follow-up maintenance:** delivery scaffolding, dependency hygiene, authenticated-by-default admin APIs, dependency-aware health semantics, fail-fast container supervision, explicit inter-node control-plane addressing, an identity-aware auth foundation, explicit RBAC authorization policies, durable audit logging for privileged and mutating operations, durable leader leases, lease-backed heartbeat/leader reconciliation, durable cluster operation journaling with per-node ACK tracking, staged NGINX release activation with rollback-safe config deployment, validated allowlisted custom NGINX fragments, strict certificate-domain validation with safe process execution, durable certificate-order state tracking with artifact history and retryable workflows, ACK-backed cluster certificate activation with rollback to prior artifact versions, an explicit Nest-managed ACME strategy layer with cluster-safe shared HTTP-01 challenge tracking that does not require DNS TXT changes, application-layer envelope encryption for certificate private keys stored in PostgreSQL, encrypted backup/restore envelopes with signed manifests, an authenticated proxy management API with validation-first CRUD workflows, structured JSON operational logging with request correlation, actor context, operation IDs, and secret redaction, expanded Prometheus/JSON metrics and dependency drilldowns for leases, cluster operations, certificate orders, backups, and DB health, a classified Node.js test harness with unit/integration/e2e suite commands and baseline coverage for auth, health, leases, config generation, and certificate-order transitions, a dedicated chaos/fault-injection suite that reproduces DB outages, leader-lease recovery, NGINX crash supervision, staged config rollback, node communication failures, and partial certificate activation failures, plus gated GitHub Actions release workflows for lint, typecheck, coverage-backed tests, production dependency audit, container scanning, and publish-after-success image pushes
- **Next recommended implementation session:** Session 29 — reconcile README, architecture docs, and runbooks with reality
- **Canonical planning and status docs:**
  - [`PRODUCTION_READINESS_ASSESSMENT.md`](PRODUCTION_READINESS_ASSESSMENT.md)
  - [`IMPLEMENTATION_PLAN_BY_SESSION.md`](IMPLEMENTATION_PLAN_BY_SESSION.md)
  - [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md)
  - [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md)

## 🧭 Deployment Mode Expectations

| Mode                     | Use it for                                       | Current expectation                                                                         |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Local development        | coding, manual verification, exploratory testing | best-supported workflow today                                                               |
| Single-node Compose      | demos, operator evaluation, non-HA environments  | usable for local/single-node evaluation, **not** yet positioned as hardened production      |
| Docker Swarm global mode | target cluster architecture                      | roadmap target only; use for controlled testing until P0/P1 hardening sessions are complete |

## ✅ Repository Verification Commands

Run these commands once a local Node/npm toolchain is available:

```bash
npm run test
npm run test:chaos
npm run lint
npm run lint:ci
npm run typecheck
npm run test:coverage:ci
npm run build
npm run audit:prod
npm run verify
npm run verify:ci
```

Current repo toolchain target:

```bash
node -v   # expected: v24.16.0
npm -v    # expected: 11.15.0
```

`npm run test` now executes the classified harness across explicit `unit`, `integration`, `e2e`, and `chaos` suites. The baseline pillars cover auth, health, leases, config generation, certificate-order transitions, and deterministic fault-injection recovery checks. Use `npm run test:chaos` when you want to focus specifically on the Session 27 failure-mode drills.

`npm run test:coverage:ci` adds the Session 28 coverage gate on top of the full regression suite. The current enforced minimums are:

- line coverage: `70%`
- branch coverage: `67%`
- function coverage: `76%`

`npm run lint:ci` is the CI-specific semantic lint gate. It intentionally suppresses only the `prettier/prettier` rule for now because the repository still carries repo-wide formatting debt that would otherwise force a large unrelated reformatting diff.

## 🧪 CI/CD Release Gates

GitHub Actions now enforces the following pipeline on pull requests and `main` pushes:

1. `lint` — semantic ESLint gate via `npm run lint:ci`
2. `typecheck` — `npm run prisma:generate` + `npm run typecheck`
3. `tests` — full regression suite with the Session 28 coverage thresholds
4. `build` — application compilation via `npm run build`
5. `dependency-audit` — production npm audit via `npm run audit:prod`
6. `container-scan` — Docker build plus Trivy scan for high/critical OS and library CVEs

Container publication to GHCR now happens only on pushes to `main`, and only after every gate above succeeds.

> Note: branch protections and required status checks still need to be enabled in the GitHub repository settings so merges cannot bypass the workflow policy.

---

## 🌟 Features

### 🔐 SSL/TLS Certificate Management

- **Automatic Let's Encrypt** - Zero-touch certificate issuance and renewal
- **Manual Certificate Upload** - Support for custom/purchased certificates
- **Self-Signed Certificates** - One-click generation for development
- **Certificate Validation** - Automatic cert/key pair validation
- **Multi-Domain Support** - SAN (Subject Alternative Names) support
- **Cluster-Aware Certificate Activation** - Issuance now rolls out a specific artifact across nodes and waits for tracked ACKs before marking it active
- **Certificate Rollback** - Operators can roll back to the prior activated artifact version when a rollout must be reverted
- **Certificate Backup/Restore** - Complete backup and recovery solution

### 🚀 NGINX Proxy Management

- **Dynamic Configuration** - Database-driven proxy configuration
- **Proxy Management API** - Authenticated CRUD, validation, and upstream test endpoints for proxy entries
- **HTTP to HTTPS Redirect** - Automatic when SSL is enabled
- **Reverse Proxy** - Full reverse proxy support
- **URL Redirects** - 301/302 redirect support
- **Guarded Custom NGINX Fragments** - Allowlisted server/location directives validated before rollout
- **WebSocket Support** - Full WebSocket proxying capability

### 📊 Monitoring & Observability

- **Prometheus Metrics** - dependency, lease, cluster-operation, certificate-order, backup, and certificate lifecycle gauges for Grafana dashboards
- **Health Checks** - Automated daily certificate health monitoring
- **Real-time Status** - Live certificate expiry tracking
- **JSON API** - Query certificate and proxy status
- **Structured Operational Logs** - stdout JSON logs with request IDs, actor identity, node IDs, operation IDs, and secret redaction
- **Alert System** - Multi-channel notifications (email, Slack, Discord)

### 🔔 Alert System

- **Email Alerts** - SMTP-based email notifications
- **Slack Integration** - Real-time Slack webhook alerts
- **Discord Integration** - Discord webhook notifications
- **Configurable Thresholds** - Set custom alert timing (default: 14 days)
- **Alert Types** - Expiring soon, expired, renewal success/failure

### 🌐 Cluster Management

- **Lease-based Leader Coordination** - Durable PostgreSQL-backed leader leases with generation-based fencing tokens
- **Leader Election** - Automatic leader election with fail-over and lease renewal
- **Node Heartbeats** - Real-time cluster health monitoring
- **Stale Node Cleanup** - Automatic removal of dead nodes (2 min timeout)
- **Lease-Backed Leadership Reconciliation** - Heartbeats and leader diagnostics derive authority from the active lease instead of stale DB flags
- **Auto-Recovery** - Self-healing from crashes and network issues
- **Admin Endpoints** - Manual cluster management and diagnostics
- **Health Monitoring** - Built-in scripts for cluster health checks

### 🛡️ Security Features

- **TLS 1.2/1.3 Only** - No legacy protocol support
- **Strong Cipher Suites** - ECDHE, AES-GCM, ChaCha20-Poly1305
- **OCSP Stapling** - Enhanced SSL performance and privacy
- **Security Headers** - HSTS, X-Frame-Options, CSP support
- **Input Validation** - Comprehensive DTO validation
- **Rate Limiting** - 3-tier rate limiting (10/sec, 60/min, 100/15min)
- **HTTP/2 Support** - Modern protocol support

### 💾 Backup & Recovery

- **Automated Backups** - ZIP archives with all certificates
- **Export/Import** - Individual certificate export/import
- **Backup Management** - List, download, delete backups via API
- **Metadata Tracking** - Complete backup history
- **Disaster Recovery** - Full restoration capability

### 🎯 Developer Experience

- **REST API** - Complete REST API for all operations
- **OpenAPI Ready** - API documentation ready
- **Error Handling** - Structured error responses with codes
- **Comprehensive Docs** - 2,500+ lines of documentation
- **Docker Support** - Evaluation manifests with hardening work tracked in the roadmap
- **TypeScript** - Fully typed codebase

---

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Current Delivery Status](#-current-delivery-status)
- [Deployment Mode Expectations](#-deployment-mode-expectations)
- [Repository Verification Commands](#-repository-verification-commands)
- [CI/CD Release Gates](#-cicd-release-gates)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [API Documentation](#-api-documentation)
- [Certificate Management](#-certificate-management)
- [Monitoring & Alerts](#-monitoring--alerts)
- [Backup & Recovery](#-backup--recovery)
- [Docker Deployment](#-docker-deployment)
- [Development](#-development)
- [Documentation](#-documentation)
- [Troubleshooting](#-troubleshooting)

---

## 🚀 Quick Start

### Prerequisites

- Node.js 24.16.0
- npm 11.15.0
- PostgreSQL 12 or higher
- Docker & Docker Compose (optional)

### 1. Clone and Install

```bash
git clone <repository-url>
cd LyttleNGINX
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
```

Use `.env` only for local evaluation. Do **not** commit `.env`, `.env.local`, `.env.production`, or any other live secret file.

**Minimum Configuration:**

```bash
# Connection pooling is automatically configured, but you can customize:
DATABASE_URL=postgresql://user:<db-password>@localhost:5432/lyttlenginx?connection_limit=10&pool_timeout=10&connect_timeout=10
ADMIN_EMAIL=admin@example.com
NODE_ENV=production
```

> **Note:** Connection pooling limits are automatically applied (10 connections per instance). Until dedicated database-operations docs are added, use `PRODUCTION_READINESS_ASSESSMENT.md` and `IMPLEMENTATION_PLAN_BY_SESSION.md` as the current references for production-hardening work.

### Custom NGINX fragment guardrails

Session 14 narrows `ProxyEntry.nginx_custom_code` from raw server-block injection to a validated fragment model:

- only reviewed server-level directives (`add_header`, `client_max_body_size`, `expires`) and `location` blocks are accepted
- inside custom `location` blocks, only a small allowlist of static-content and response-shaping directives is accepted
- dangerous directives such as `proxy_pass`, `include`, nested `server`/`if` blocks, certificate directives, and regex locations are rejected before rollout
- `root` and `alias` paths must stay under operator-approved prefixes configured with `NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES`

Example:

```bash
NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES="/var/www,/srv/www,/etc/nginx/custom"
```

If a fragment violates these rules, the staged reload fails before `nginx -t` or activation. This keeps advanced per-proxy static-file behavior available without preserving arbitrary config injection as a casual escape hatch.

### 3. Setup Database

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4. Build and Run

```bash
npm run build
npm run start:prod
```

### 5. Verify Installation

```bash
# Check health
curl http://localhost:3000/ready

# View metrics
curl http://localhost:3000/metrics/json

# List certificates (admin API key required)
curl http://localhost:3000/certificates \
  -H "X-API-Key: $API_KEY"
```

**🎉 You're ready to go!**

---

## 📦 Installation

### Development Setup

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start in development mode
npm run start:dev
```

### Production Setup

```bash
# Install production dependencies
npm ci --only=production

# Generate Prisma client
npm run prisma:generate

# Build application
npm run build

# Run migrations
npm run prisma:deploy

# Start production server
npm run start:prod
```

### Docker Setup

```bash
# Build image
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f app
```

---

## ⚙️ Configuration

### Environment Variables

#### Required

```bash
DATABASE_URL=postgresql://user:<db-password>@host:5432/db
ADMIN_EMAIL=admin@example.com        # For Let's Encrypt
NODE_ENV=production                  # production | development
PORT=3000                            # Internal NestJS listen port inside the container
CLUSTER_CONTROL_ADDRESS=node-a.internal
CLUSTER_CONTROL_PORT=3003            # Peer-facing control-plane port; do not assume it matches PORT
CLUSTER_CONTROL_PROTOCOL=http
```

For Session 6 and later, inter-node traffic should be configured from these explicit control-plane settings rather than from public-IP discovery or implicit `PORT` assumptions. If you prefer a single variable, you can provide `CLUSTER_CONTROL_URL=http://node-a.internal:3003` instead of the address/port pair.

### Secret handling policy

The repository is intentionally configured so that only `.env.example` is tracked. Real runtime secrets must stay outside git.

- **Local/single-node evaluation:** keep secrets in an untracked `.env` file on the operator workstation.
- **Docker Swarm:** store sensitive values as Swarm secrets and inject them at deploy time instead of hard-coding them into compose files or committed env files.
- **External secret stores:** Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, or equivalent are preferred for long-lived production credentials.
- **Current implementation note:** the app still consumes environment variables directly. Until first-class `*_FILE` support or a dedicated secret-provider integration is added, have the deployment system materialize secret values at runtime rather than committing them.

Treat at least the following as secret material:

- `DATABASE_URL`
- `API_KEY`
- `PRIVATE_KEY_ENCRYPTION_MASTER_KEY`
- `SMTP_PASS`
- `SLACK_WEBHOOK_URL`
- `DISCORD_WEBHOOK_URL`
- certificate private keys, backup archives, and exported PEM material

#### TLS Configuration

```bash
RENEW_BEFORE_DAYS=30                # Days before expiry to renew
```

#### Private-key encryption at rest

```bash
PRIVATE_KEY_ENCRYPTION_PROVIDER=local
PRIVATE_KEY_ENCRYPTION_MASTER_KEY=<inject-at-runtime>
PRIVATE_KEY_ENCRYPTION_KEY_VERSION=v1
```

Session 19 adds application-layer envelope encryption for certificate private keys stored in PostgreSQL:

- each certificate row and certificate-artifact row gets a freshly generated data key
- the data key is wrapped by the configured master key and stored alongside per-record encryption metadata/versioning
- legacy plaintext rows are migrated on application startup, and changing `PRIVATE_KEY_ENCRYPTION_KEY_VERSION` causes the runtime to re-encrypt stored keys under the new version metadata
- the current shipped provider is a local master-key envelope implementation; the service boundary is intentionally shaped so later sessions can plug in Vault/KMS/HSM-backed providers without changing certificate workflows

Session 20 hardens backup and restore handling on top of the Session 19 storage-layer encryption:

- created backups are now encrypted at the artifact layer before they are written to disk or downloaded
- each backup contains a signed integrity manifest plus per-entry SHA-256 checksums, and restore verifies both the manifest signature and entry digests before any import happens
- restore now runs through a first-class server-side verification + import flow instead of requiring manual unzip/import of plaintext archives
- raw certificate export still returns decrypted PEM material, so it remains intentionally restricted to `platform-admin` and should be treated as a break-glass action

#### Alert Configuration

```bash
# Email Alerts
ALERT_EMAIL=alerts@example.com
ALERT_FROM_EMAIL=noreply@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alerts@example.com
SMTP_PASS=<inject-at-runtime>

# Alert Threshold
ALERT_THRESHOLD_DAYS=14             # Alert when expiring within X days

# Webhook Alerts
SLACK_WEBHOOK_URL=<inject-at-runtime>
DISCORD_WEBHOOK_URL=<inject-at-runtime>
```

#### Backup Configuration

```bash
BACKUP_DIR=/var/backups/certificates
BACKUP_ENCRYPTION_KEY=<inject-runtime-secret>
BACKUP_ENCRYPTION_KEY_VERSION=v1
```

### Database Schema

The application uses PostgreSQL with Prisma ORM. Key models:

- **ProxyEntry** - NGINX proxy configurations
- **Certificate** - SSL/TLS certificates with metadata

Run migrations with:

```bash
npm run prisma:migrate
```

---

## 📚 API Documentation

### Session 3-24 access policy

As of Sessions 3-24, the control-plane API is **authenticated by default**, with a small public probe allowlist, an identity-aware authentication layer, explicit RBAC authorization policies on protected endpoints, durable audit logging for privileged and mutating operations, hardened backup/restore/export flows, a validated proxy-management surface that replaces direct proxy-table mutation as the preferred operator workflow, and structured operational logging that keeps request IDs, actor identity, and cluster operation IDs attached to runtime logs.

The current explicit public allowlist is limited to:

- `GET /health/live`
- `GET /health/startup`
- `GET /health/ready`
- `GET /metrics`
- `GET /metrics/json`
- `GET /.well-known/acme-challenge/:token`

Legacy compatibility aliases currently remain available for:

- `GET /health` → liveness
- `GET /ready` → readiness

All other endpoints should be treated as admin or internal control-plane endpoints and require one of:

- `Authorization: Bearer <jwt>`
- `X-API-Key: <key>`
- `Authorization: ApiKey <key>`

Session 7 introduced a JWT bearer-token foundation that attaches actor identity to each authenticated request. Session 8 builds on that with explicit RBAC policies. Session 9 adds durable audit logging for privileged and mutating operations, including successful writes, denied privileged attempts, and controller/service failures on protected routes. Session 23 adds dedicated security administration APIs for secret-health review, access review, API-key rotation planning, private-key re-encryption maintenance, and the future internal-certificate rotation contract. Session 24 adds structured JSON operational logging to stdout with correlation IDs, actor metadata, node/operation IDs, and consistent secret redaction while keeping audit events on the separate `GET /audit` review surface. Legacy API keys remain supported temporarily as a migration bridge and can be exchanged for short-lived bearer tokens via `POST /auth/token` when `AUTH_JWT_SECRET` is configured.

Current identity model:

- `admin` actors for operator/API clients
- `internal-node` actors for trusted inter-node calls

Current RBAC roles:

- `viewer` — read-only admin visibility into certificates, cluster state, TLS recommendations, and auth configuration
- `operator` — operational actions such as config reloads, certificate renewals, and log access
- `security-admin` — certificate/key lifecycle, encrypted backup/import/restore, and TLS hardening actions
- `platform-admin` — full administrative access, including cluster-leadership and break-glass maintenance flows
- `internal-node` — reserved for trusted inter-node identities; currently used for internal certificate sync and future cluster control-plane policies

Role hierarchy:

- `platform-admin` ⟶ `security-admin`, `operator`, `viewer`
- `security-admin` ⟶ `viewer`
- `operator` ⟶ `viewer`
- `internal-node` is separate and does not inherit admin roles

The resolved identity now carries:

- subject
- actor type
- auth method
- roles
- scopes
- issuer/audience metadata

Protected privileged and mutating requests now also receive an `X-Correlation-Id` response header. Audit events persist:

- actor identity
- action name
- target identifier or label when available
- outcome (`success`, `failure`, or `denied`)
- HTTP status and request path
- correlation ID and timestamp

Readiness now returns **HTTP 503** when critical dependencies are unhealthy. The readiness body also reports the status of:

- PostgreSQL connectivity
- NGINX master-process health
- last successful config apply
- last successful certificate sync

### Current authorization matrix

| Role / actor     | Intended scope                                                       |
| ---------------- | -------------------------------------------------------------------- |
| Public           | health probes, metrics, ACME challenge serving                       |
| `viewer`         | read-only admin inspection endpoints                                 |
| `operator`       | runtime operations such as reload, renew, and log inspection         |
| `security-admin` | certificate/key management, encrypted backup/import/restore, TLS hardening |
| `platform-admin` | full admin access including cluster maintenance endpoints            |
| `internal-node`  | internal certificate sync and future node-only control-plane actions |

### Certificate Endpoints

| Method | Endpoint                             | Description                       | Required role / actor               |
| ------ | ------------------------------------ | --------------------------------- | ----------------------------------- |
| GET    | `/certificates`                      | List all certificates with status | `viewer`                            |
| GET    | `/certificates/:id`                  | Get certificate details           | `viewer`                            |
| POST   | `/certificates/upload`               | Upload custom certificate         | `security-admin`                    |
| POST   | `/certificates/generate-self-signed` | Generate self-signed cert         | `security-admin`                    |
| POST   | `/certificates/renew/:id`            | Renew specific certificate        | `operator`                          |
| POST   | `/certificates/renew-all`            | Renew all certificates            | `operator`                          |
| DELETE | `/certificates/:id`                  | Delete certificate                | `security-admin`                    |
| GET    | `/certificates/validate/:domain`     | Validate domain                   | `viewer`                            |
| GET    | `/certificates/health/ocsp-check`    | Inspect OCSP support status       | `viewer`                            |
| POST   | `/certificates/sync`                 | Trigger certificate sync          | `internal-node` or `platform-admin` |

### Backup Endpoints

| Method | Endpoint                          | Description         | Required role    |
| ------ | --------------------------------- | ------------------- | ---------------- |
| POST   | `/certificates/backup`            | Create backup       | `security-admin` |
| GET    | `/certificates/backup`            | List backups        | `security-admin` |
| GET    | `/certificates/backup/:filename`  | Download backup     | `security-admin` |
| POST   | `/certificates/backup/:filename/verify`  | Verify encrypted backup integrity | `security-admin` |
| POST   | `/certificates/backup/:filename/restore` | Restore from encrypted backup     | `security-admin` |
| DELETE | `/certificates/backup/:filename`  | Delete backup       | `security-admin` |
| POST   | `/certificates/backup/import`     | Import certificates | `security-admin` |
| GET    | `/certificates/backup/export/:id` | Export decrypted certificate PEMs | `platform-admin` |

### Metrics Endpoints

| Method | Endpoint        | Description        | Auth   |
| ------ | --------------- | ------------------ | ------ |
| GET    | `/metrics`      | Prometheus metrics for health, leases, operations, certificates, and backups | Public |
| GET    | `/metrics/json` | JSON metrics with per-section collection status and errors | Public |

### Logs Endpoints

| Method | Endpoint | Description | Required role |
| ------ | -------- | ----------- | ------------- |
| GET    | `/logs`  | Return recent in-memory operational log entries and raw JSON log lines for the current process | `operator` |

Operational logs now emit structured JSON to stdout for platform log shipping. Audit events remain queryable separately through `GET /audit`.

### Proxy Management Endpoints

| Method | Endpoint                     | Description                                                     | Required role    |
| ------ | ---------------------------- | --------------------------------------------------------------- | ---------------- |
| GET    | `/proxies`                   | List proxy entries                                              | `viewer`         |
| GET    | `/proxies/:id`               | Get one proxy entry                                             | `viewer`         |
| POST   | `/proxies`                   | Create a proxy entry                                            | `platform-admin` |
| PATCH  | `/proxies/:id`               | Update a proxy entry                                            | `platform-admin` |
| DELETE | `/proxies/:id`               | Delete a proxy entry                                            | `platform-admin` |
| POST   | `/proxies/validate`          | Validate a draft proxy payload and render a config preview      | `operator`       |
| POST   | `/proxies/:id/validate`      | Re-validate a stored proxy entry                                | `operator`       |
| POST   | `/proxies/:id/test-upstream` | Resolve and inspect the configured upstream hostname for a proxy | `operator`       |

Proxy mutations now return a small `configChange` object with `reloadRequired: true` and a suggested `/cluster/reload` follow-up. This is the current desired-state hook until later sessions add broader config-version orchestration.

Example create + validate flow:

```bash
# Validate a draft proxy definition before persisting it
curl http://localhost:3000/proxies/validate \
  -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["api.example.com"],
    "proxyPassHost": "http://backend.internal:8080",
    "type": "PROXY",
    "ssl": true
  }'

# Persist the proxy entry once validation looks correct
curl http://localhost:3000/proxies \
  -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["api.example.com"],
    "proxyPassHost": "http://backend.internal:8080",
    "type": "PROXY",
    "ssl": true
  }'
```

### TLS Configuration Endpoints

| Method | Endpoint                          | Description         | Required role    |
| ------ | --------------------------------- | ------------------- | ---------------- |
| GET    | `/tls/config/:domain`             | Get TLS config      | `viewer`         |
| GET    | `/tls/test/:domain`               | Test TLS connection | `viewer`         |
| POST   | `/tls/dhparam`                    | Generate DH params  | `security-admin` |
| GET    | `/tls/dhparam/status`             | Check DH params     | `viewer`         |
| POST   | `/tls/certificate/info`           | Parse certificate   | `security-admin` |
| POST   | `/tls/certificate/validate-chain` | Validate chain      | `security-admin` |

### Authentication Endpoints

| Method | Endpoint       | Description                                                        | Required role / actor                        |
| ------ | -------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| GET    | `/auth/status` | Check authentication status and return the resolved actor identity | any authenticated `admin` or `internal-node` |
| GET    | `/auth/info`   | Get auth capability/configuration info                             | `viewer`                                     |
| POST   | `/auth/token`  | Exchange a legacy API key identity for a short-lived bearer token  | authenticated `admin`                        |

### Audit Endpoints

| Method | Endpoint      | Description                                                        | Required role                                |
| ------ | ------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| GET    | `/audit`      | List recent audit events with optional filters                     | `security-admin`                             |
| GET    | `/auth/me`    | Inspect the current request identity                               | any authenticated `admin` or `internal-node` |
| POST   | `/auth/token` | Exchange a legacy API-key-authenticated request for a bearer token | any authenticated `admin`                    |

### Security Administration Endpoints

| Method | Endpoint                                 | Description                                                                        | Required role    |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| GET    | `/security/status`                       | Review current auth, secret-health, encryption, and break-glass posture            | `security-admin` |
| GET    | `/security/policy`                       | Review the operator-facing security policy, public allowlist, and rotation surface | `security-admin` |
| GET    | `/security/secrets/health`               | Inspect which secret inputs are configured and whether any fallback modes are used | `security-admin` |
| GET    | `/security/access-review`                | Review the current caller's effective roles and high-risk capability access        | `security-admin` |
| POST   | `/security/rotate/api-key`               | Validate a replacement API key and return a safe manual overlap-rotation plan      | `platform-admin` |
| POST   | `/security/rotate/private-key-encryption`| Re-encrypt stored private keys with the active configured master-key version       | `security-admin` |
| POST   | `/security/rotate/internal-certs`        | Reserved hook for future internal mTLS certificate rotation workflows              | `platform-admin` |

Session 23 intentionally keeps API-key rotation as a **manual secret-store + redeploy** workflow. The rotation endpoint does not persist or return raw key material; it validates the candidate, reports safe fingerprints/IDs, and can optionally mint a short-lived bearer token so operators can test the bearer-token path before retiring legacy API keys.

### Auth configuration

Sessions 7-8 add a JWT/OIDC-compatible claim foundation plus RBAC. The most relevant auth env vars are:

- `API_KEY` — temporary legacy compatibility credentials
- `AUTH_JWT_SECRET` — enables locally signed HS256 bearer tokens and `/auth/token`
- `AUTH_JWT_PUBLIC_KEY` — optional RS256 verification key for externally issued bearer tokens
- `AUTH_JWT_ISSUER` — expected token issuer and local token issuer
- `AUTH_JWT_AUDIENCE` — expected token audience and local token audience
- `AUTH_DEFAULT_ADMIN_ROLES` / `AUTH_DEFAULT_ADMIN_SCOPES` — bridge claims applied to legacy API keys during the migration from shared keys to bearer-token identities

Session 23 also formalizes the current rotation expectations:

- rotate `API_KEY` outside the app by updating the injected secret/config and redeploying every node; use `POST /security/rotate/api-key` to validate the candidate and generate a safe overlap plan
- rotate certificate master keys by changing `PRIVATE_KEY_ENCRYPTION_KEY_VERSION` plus the injected `PRIVATE_KEY_ENCRYPTION_MASTER_KEY`, then calling `POST /security/rotate/private-key-encryption`
- rotate backup-envelope keys by changing `BACKUP_ENCRYPTION_KEY_VERSION` plus `BACKUP_ENCRYPTION_KEY`, then re-creating fresh backup artifacts

Example migration flow:

```bash
# Exchange a legacy API key for a short-lived bearer token
JWT=$(curl -s http://localhost:3000/auth/token \
  -X POST \
  -H "X-API-Key: $API_KEY" | jq -r '.accessToken')

# Use the bearer token for subsequent admin requests
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer $JWT"
```

### Health Endpoints

| Method | Endpoint          | Description                                                               | Auth       |
| ------ | ----------------- | ------------------------------------------------------------------------- | ---------- |
| GET    | `/health/live`    | Liveness probe; returns 200 while the process is alive                    | Public     |
| GET    | `/health/startup` | Startup probe; returns 503 until first config apply + cert sync succeed   | Public     |
| GET    | `/health/ready`   | Readiness probe; returns 503 when DB/NGINX/config/cert state is unhealthy | Public     |
| GET    | `/health/dependencies` | Dependency drilldown for DB, NGINX, config apply, and certificate sync | Public     |
| GET    | `/health/deep`    | Combined liveness/startup/readiness/dependency report for incident triage | Public     |
| GET    | `/health`         | Legacy alias for `/health/live`                                           | Public     |
| GET    | `/ready`          | Legacy alias for `/health/ready`                                          | Public     |
| POST   | `/reload`         | Reload NGINX config                                                       | `operator` |

### ACME Challenge Endpoint

| Method | Endpoint                             | Description               | Auth   |
| ------ | ------------------------------------ | ------------------------- | ------ |
| GET    | `/.well-known/acme-challenge/:token` | Serve ACME challenge data | Public |

### ACME Challenge Operations

| Method | Endpoint                  | Description                                                    | Auth     |
| ------ | ------------------------- | -------------------------------------------------------------- | -------- |
| GET    | `/certificates/challenges` | Inspect recent ACME challenge publication / cleanup lifecycle | `viewer` |

**📖 API documentation status:** a refreshed API reference is still pending; for now, use the controller source under `src/`, `IMPLEMENTATION_STATUS.md`, and `PRODUCTION_READINESS_ASSESSMENT.md` as the current references.

---

## 🔐 Certificate Management

### Automatic Let's Encrypt

Certificates are automatically obtained and renewed for proxy entries with `ssl = true`.

```sql
-- Enable SSL for a proxy entry
UPDATE "ProxyEntry"
SET ssl = true
WHERE id = 1;
```

The system will:

1. Generate HTTP-only NGINX config
2. Obtain Let's Encrypt certificate via ACME
3. Update config with HTTPS + HTTP→HTTPS redirect
4. Auto-renew when within `RENEW_BEFORE_DAYS` threshold

Certificate domain input is now normalized and validated strictly before any filesystem or process interaction:

- domains must be fully-qualified (`example.com`, not `localhost`)
- internationalized domains are normalized to ASCII/punycode
- wildcard domains must use the left-most `*.` form
- path separators, whitespace, control characters, and shell metacharacter tricks are rejected early
- wildcard issuance remains intentionally unsupported in the hardened built-in ACME flow because production issuance should not require DNS TXT changes

### ACME strategy selection

Session 18 formalizes ACME challenge handling behind an explicit strategy layer.

The runtime supports two `ACME_CHALLENGE_STRATEGY` modes:

- `auto` *(default)* — use the built-in HTTP-01 flow
- `http-01` — force the built-in database-backed HTTP-01 flow

This Session 18 implementation is intentionally HTTP-01 only so clustered production issuance works without operator DNS TXT changes. Wildcard orders are rejected early with a clear validation error.

#### Built-in HTTP-01 strategy

The hardened HTTP-01 flow is the default for non-wildcard orders and remains cluster-safe:

1. the issuing node starts an in-process ACME order through the NestJS `AcmeService`
2. the HTTP-01 challenge token + key authorization are written into PostgreSQL together with order/strategy metadata
3. any node can answer `/.well-known/acme-challenge/:token` from the shared database record
4. challenge verification happens in-process before the ACME order is completed
5. the certificate service finalizes the challenge lifecycle as `validated` or `failed`, which makes challenge publication / finalization inspectable after the run

The `GET /certificates/challenges` endpoint exposes recent built-in HTTP-01 challenge records with statuses such as `presented`, `cleaned-up`, `validated`, `failed`, and `expired`.

### Private-key storage model

As of Session 19, the database no longer stores certificate private keys as plaintext PEMs for active certificates or certificate artifacts.

- `Certificate.keyPem` and `CertificateArtifactVersion.keyPem` now contain encrypted payloads rather than raw PEM text
- per-record `keyEncryption` metadata stores the envelope version, provider type, master-key version, and ciphertext parameters needed for decryption/rotation
- runtime workflows decrypt private keys only when they need to validate material, write local `privkey.pem` files, create backups, or serve explicit export flows

That means order-history APIs still avoid raw key exposure, while the storage layer now has a clear path for future master-key rotation and external key-manager integration.

### Backup and restore protection model

Session 20 moves backup artifacts themselves onto a hardened envelope format:

- backups are written as encrypted `.lyttlebackup` artifacts instead of plaintext ZIP files
- the encrypted payload contains the familiar logical entries (`certificates.json`, `metadata.json`, `certs/.../fullchain.pem`, `certs/.../privkey.pem`), but those entries are only available after successful decryption
- every backup includes a signed manifest with per-entry SHA-256 checksums, and restore refuses to import anything unless the manifest signature, decrypted payload, and entry digests all verify cleanly
- direct import still exists for explicitly supplied certificate payloads, but each entry is now validated for PEM structure, private-key match, certificate SAN/CN coverage, and validity-window consistency before it is accepted
- raw certificate export is treated as a higher-risk break-glass flow and is now restricted to `platform-admin`
- Session 23 adds `GET /security/status`, `GET /security/secrets/health`, and `GET /security/access-review` so operators can inspect whether the backup and private-key protection inputs are present before attempting high-risk maintenance

### Break-glass procedures

Session 23 adds an explicit operator-facing break-glass note instead of leaving these actions implicit:

- use `GET /certificates/backup/export/:id` only for time-bound emergency recovery that truly requires decrypted PEM material
- prefer encrypted backup verify/restore flows and bearer tokens for normal operations
- record the reason for any break-glass action, review `GET /audit` afterward, and rotate/re-issue credentials if exposed material may have been copied outside the platform
- follow the detailed runbook in `docs/runbooks/security-break-glass.md`

Example configuration snippets:

```bash
# Default production strategy: shared HTTP-01 without DNS TXT changes
ACME_CHALLENGE_STRATEGY=auto

# Force the built-in database-backed HTTP-01 flow
ACME_CHALLENGE_STRATEGY=http-01
ACME_HTTP01_PROPAGATION_SECONDS=5


# Optional explicit ACME account key location
ACME_ACCOUNT_PRIVATE_KEY_PATH=/app/state/acme/account.pem
```

### Certificate order state machine

Session 16 adds a durable certificate-order workflow so issuance is no longer just an ephemeral ACME subprocess plus a best-effort database write.

Current order states are:

- `requested`
- `challenge-published`
- `validating`
- `issued`
- `distributing`
- `activated`
- `failed`
- `revoked`

Each order now stores:

- normalized domains and primary domain
- source type (`acme`, `uploaded`, `self-signed`, `imported`)
- attempt and retry counters
- next retry time for failed ACME orders
- per-order event history
- certificate artifact versions linked to the order

The order read APIs intentionally return metadata and history only; they do **not** expose raw certificate private keys.

```bash
# List recent certificate orders
curl http://localhost:3000/certificates/orders \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Inspect one order, its state transitions, and artifact-version history
curl http://localhost:3000/certificates/orders/<order-id> \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Retry a failed ACME or self-signed order
curl -X POST http://localhost:3000/certificates/orders/<order-id>/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Session 17 already separates issuance from cluster-wide distribution / activation ACKs. Session 18 builds on that by making the pre-issuance challenge strategy explicit and operator-configurable.

### Upload Custom Certificate

```bash
curl -X POST http://localhost:3000/certificates/upload \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["example.com", "www.example.com"],
    "certPem": "-----BEGIN CERTIFICATE-----\n...",
    "keyPem": "-----BEGIN PRIVATE KEY-----\n...",
    "chainPem": "-----BEGIN CERTIFICATE-----\n..."
  }'
```

### Generate Self-Signed Certificate

Perfect for development and testing:

```bash
curl -X POST http://localhost:3000/certificates/generate-self-signed \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["example.test", "*.example.test"]}'
```

### Certificate Status

Certificates have three statuses:

- **valid** - More than `RENEW_BEFORE_DAYS` until expiry
- **expiring_soon** - Within renewal threshold
- **expired** - Past expiration date

```bash
# Check certificate status
curl http://localhost:3000/certificates \
  -H "X-API-Key: $API_KEY" | jq '.[] | {domain: .domains[0], status, days: .daysUntilExpiry}'
```

---

## 📊 Monitoring & Alerts

### Prometheus Metrics

Expose metrics for Grafana dashboards:

```bash
# Prometheus format
curl http://localhost:3000/metrics

# JSON format
curl http://localhost:3000/metrics/json
```

**Available Metrics:**

- `lyttle_health_dependency_status{name=...}` - health status for DB, NGINX, config apply, and certificate sync
- `lyttle_db_connectivity_status` / `lyttle_db_query_duration_ms` - DB health and latency
- `lyttle_config_apply_*` / `lyttle_certificate_sync_*` - freshness, timestamps, and last-error indicators
- `lyttle_cluster_leader_lease_seconds_remaining` / `lyttle_cluster_leader_lease_generation` - leader lease health and fencing token visibility
- `lyttle_cluster_operations_total{status=...}` / `lyttle_cluster_operations_recent_failures_total` - operation convergence and recent failure windows
- `lyttle_cluster_operation_acks_total{status=...}` - per-node ACK state rollups
- `lyttle_certificate_orders_total{status=...}` / `lyttle_certificate_orders_stale_total` - certificate workflow backlog and stuck-order visibility
- `lyttle_backups_total` / `lyttle_backup_freshness_status` - encrypted backup presence and freshness
- `lyttle_certificates_*` - certificate inventory and expiry distribution
- `lyttle_proxy_entries_*` - proxy inventory and SSL coverage
- `lyttle_metrics_collection_status{section=...}` - whether each metrics section was collected successfully

The JSON view at `GET /metrics/json` also includes a `collection.errors` array so dashboards and incident tooling can distinguish a partial metrics scrape from a full endpoint failure.

### Dependency Drilldowns

Use the health drilldown endpoints during incidents:

```bash
# Dependency-only drilldown
curl http://localhost:3000/health/dependencies | jq

# Full deep-health report
curl http://localhost:3000/health/deep | jq
```

These endpoints return structured details for:

- PostgreSQL connectivity and latency
- NGINX master-process status
- config-apply freshness and last-error state
- certificate-sync freshness and last-error state
- combined startup/readiness/dependency summaries for operator triage

### Configure Prometheus Scraping

**prometheus.yml:**

```yaml
scrape_configs:
  - job_name: 'lyttlenginx'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'
    scrape_interval: 30s
```

### Email Alerts

Configure SMTP for email notifications:

```bash
ALERT_EMAIL=alerts@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Webhook Alerts

**Slack:**

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Discord:**

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
```

### Alert Types

1. **Certificate Expiring Soon** - Sent 14 days before expiry (configurable)
2. **Certificate Expired** - Sent immediately when cert expires
3. **Renewal Success** - Confirmation after successful renewal
4. **Renewal Failure** - Alert when renewal fails

The monitoring service runs **daily at 9 AM** automatically.

For Prometheus/Grafana alerting, see [`docs/runbooks/monitoring-alerts.md`](docs/runbooks/monitoring-alerts.md) for recommended rules covering dependency health, leader leases, cluster operations, certificate orders, and backup freshness.

---

## 💾 Backup & Recovery

### Create Backup

```bash
curl -X POST http://localhost:3000/certificates/backup \
  -H "X-API-Key: $API_KEY"
```

Creates an encrypted `.lyttlebackup` artifact containing these logical entries inside the encrypted payload:

- `certificates.json` - database export for restore/import
- `certs/{certificate-storage-id}/fullchain.pem` - certificate files
- `certs/{certificate-storage-id}/privkey.pem` - private keys
- `metadata.json` - backup metadata

The backup file on disk is encrypted and signed; plaintext PEM material is not written to the backup directory.

### List Backups

```bash
curl http://localhost:3000/certificates/backup \
  -H "X-API-Key: $API_KEY"
```

### Download Backup

```bash
curl http://localhost:3000/certificates/backup/certificates-backup-2026-05-26T18-40-26-776Z.lyttlebackup \
  -H "X-API-Key: $API_KEY" \
  --output backup.lyttlebackup
```

### Verify Backup Integrity

```bash
curl -X POST http://localhost:3000/certificates/backup/certificates-backup-2026-05-26T18-40-26-776Z.lyttlebackup/verify \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Restore from Backup

```bash
# Verify and restore the encrypted backup server-side
curl -X POST http://localhost:3000/certificates/backup/certificates-backup-2026-05-26T18-40-26-776Z.lyttlebackup/restore \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Direct Import / Break-Glass Export

```bash
# Direct certificate import still exists for explicit operator-supplied payloads.
curl -X POST http://localhost:3000/certificates/backup/import \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "certificates": [
      {
        "domains": ["example.com", "www.example.com"],
        "certPem": "-----BEGIN CERTIFICATE-----\\n...",
        "keyPem": "-----BEGIN PRIVATE KEY-----\\n...",
        "issuedAt": "2026-05-26T18:36:53.000Z",
        "expiresAt": "2036-05-23T18:36:53.000Z"
      }
    ]
  }'

# Raw PEM export is now restricted to platform-admin because it returns decrypted key material.
curl http://localhost:3000/certificates/backup/export/<certificate-id> \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN"
```

### Automated Backups

**Create backup script:**

```bash
#!/bin/bash
# /scripts/backup-daily.sh

curl -X POST http://localhost:3000/certificates/backup -H "X-API-Key: $API_KEY"
FILENAME=$(curl -s http://localhost:3000/certificates/backup -H "X-API-Key: $API_KEY" | jq -r '.[0].filename')
curl http://localhost:3000/certificates/backup/$FILENAME -H "X-API-Key: $API_KEY" -o /backups/$FILENAME
```

**Add to crontab:**

```cron
0 2 * * * /scripts/backup-daily.sh >> /var/log/backup.log 2>&1
```

---

## 🐳 Docker Deployment

### Docker Swarm (Roadmap Target / Controlled Testing Only)

Deploy LyttleNGINX in **global mode** across your Docker Swarm cluster only for controlled testing while the hardening roadmap is still in progress:

> **Secret handling for Swarm:** keep live credentials out of committed env files. Store them as Swarm secrets or in an external secret manager, then inject them at deployment time. Session 2 cleaned up the tracked examples and documentation, but runtime secret-file ingestion is still future work.

```bash
# Quick deployment with script
./deploy-swarm.sh

# Or manually
docker stack deploy -c docker-compose.swarm.yml lyttlenginx
```

**Current caveats:**

- global mode is the intended target architecture
- Session 6 replaces public-IP autodiscovery with explicit `CLUSTER_CONTROL_ADDRESS` / `CLUSTER_CONTROL_PORT` registration
- Session 10 replaces leader advisory-lock ownership with a durable `ClusterLease` record and generation-based fencing token
- Session 12 adds durable `ClusterOperation` and `ClusterOperationAck` tracking so cluster-wide reload/sync flows return operation IDs and per-node convergence state
- Sessions 7-8 add request identity plus explicit RBAC, but internal-node traffic is still plain HTTP and mTLS remains future work
- the current assessment still identifies remaining P0/P1 blockers in full lease-backed heartbeat reconciliation, cluster ACK tracking, certificate lifecycle hardening, internal-traffic security, and transactional config rollout even after the completed health, auto-recovery, inter-node addressing, auth/RBAC, audit logging, and lease-foundation sessions
- use the swarm manifest for evaluation and development feedback, not as a final production deployment contract yet

The current container model is intentionally **fail-fast**: if either the NestJS control-plane process or the foreground NGINX master exits unexpectedly, the container exits non-zero so Docker or Swarm can restart it instead of leaving the node wedged.

The current Swarm manifest now treats peer communication as an **advertised control-plane endpoint** problem:

- `PORT` remains the internal NestJS listen port inside the container (`3000` by default)
- `CLUSTER_CONTROL_PORT` is the peer-facing port other nodes should call (`3003` in the current host-published Swarm example)
- `CLUSTER_CONTROL_ADDRESS` is the routable hostname/address peers should use for this node (`{{.Node.Hostname}}` in the current example)
- nodes register that advertised endpoint in the database and cluster broadcasts now use that registration instead of building URLs from discovered public IPs

Leader election now uses a durable database lease:

- `CLUSTER_LEASE_TTL_SECONDS` controls how long the leader lease remains valid without renewal (default `30`)
- `CLUSTER_LEASE_RENEW_INTERVAL_MS` controls how frequently the local leader renews that lease (default: one third of the TTL, minimum `1000ms`)
- the active lease carries a monotonically increasing generation number that acts as the leader fencing token for later cluster operations

Cluster-wide mutations now use a durable operation journal:

- `POST /cluster/reload` now returns `202 Accepted` with an operation ID instead of only reporting local-node success
- `GET /cluster/operations` returns recent cluster operations and summary counts
- `GET /cluster/operations/:operationId` returns per-node acknowledgement state for a specific operation
- `GET /cluster/operations?nodeId=<node>&type=<operation>` filters the operation journal down to the node and workflow an operator is investigating
- internal certificate-sync broadcasts also use the same operation journal so later certificate activation work can build on a shared ACK model

Session 22 adds operator-focused cluster inspection APIs on top of that journal:

- `GET /cluster/status` returns a single overview payload containing cluster counts, leader/lease health, active nodes, and recent operations
- `GET /cluster/nodes?includeInactive=true` includes stale/inactive nodes instead of only the currently active set
- `GET /cluster/nodes/:nodeId` returns node detail plus recent per-node operation history, config state, and certificate state
- `GET /cluster/nodes/:nodeId/config` returns the latest reload ACK for that node and, on the local node, the current/last-known-good NGINX runtime release metadata
- `GET /cluster/nodes/:nodeId/certificates` returns the latest certificate activation/sync ACKs for that node and, on the local node, a summary of the current certificate inventory from the shared database

Transactional config activation now uses a managed runtime release layout:

- the stable loader at `/etc/nginx/nginx.conf` reads virtual-host configs from `/etc/nginx/runtime/current/conf.d/*.conf`
- each reload stages a full config snapshot under `/etc/nginx/runtime/releases/<release-id>`
- the staged snapshot is validated with `nginx -t -c <release>/.validation-nginx.conf` before activation
- activation swaps the `current` symlink atomically, preserves a `last-known-good` symlink, and rolls back automatically if `nginx -s reload` fails
- each staged release records metadata in `lyttle-nginx-release.json`, including validation output, apply node, phase, and rollback context when relevant

If your Swarm nodes are not mutually reachable by node hostname, override `CLUSTER_CONTROL_ADDRESS` with a routable internal DNS name or address per node before treating cluster operations as healthy.

**View cluster status:**

```bash
# See all nodes
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/nodes

# Inspect the current leader lease and fencing token
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/lease

# Queue a cluster-wide reload and capture the returned operation id
curl -X POST -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/reload

# Inspect recent cluster operations
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/operations

# Inspect one operation and its per-node acknowledgements
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/operations/<operation-id>

# See the aggregated cluster status overview
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/status

# Inspect a node, including config and certificate rollout state
curl -H "Authorization: Bearer $JWT" http://localhost:3003/cluster/nodes/<node-id>

# Filter the operation journal down to one node + one workflow
curl -H "Authorization: Bearer $JWT" "http://localhost:3003/cluster/operations?nodeId=<node-id>&type=cluster.reload"

# View leader
docker service logs lyttlenginx_lyttlenginx 2>&1 | grep "LEADER"

# Check service health
docker service ps lyttlenginx_lyttlenginx
```

**📖 Current deployment references:** [`docker-compose.swarm.yml`](docker-compose.swarm.yml), [`PRODUCTION_READINESS_ASSESSMENT.md`](PRODUCTION_READINESS_ASSESSMENT.md), and [`IMPLEMENTATION_PLAN_BY_SESSION.md`](IMPLEMENTATION_PLAN_BY_SESSION.md)

---

### Docker Compose (Single-node Evaluation)

Use `docker-compose.yml` for local or single-node evaluation only. It is not yet the documented high-availability production path.

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:18.4-alpine
    environment:
      POSTGRES_DB: lyttlenginx
      POSTGRES_USER: lyttlenginx
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data

  app:
    image: ghcr.io/lyttle-development/lyttlenginx:main
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://lyttlenginx:${POSTGRES_PASSWORD}@postgres:5432/lyttlenginx
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      NODE_ENV: production
    volumes:
      - letsencrypt-data:/etc/letsencrypt
      - nginx-ssl:/etc/nginx/ssl
    ports:
      - 80:80
      - 443:443
      - 3003:3000
    restart: unless-stopped
    stop_grace_period: 45s

volumes:
  postgres-data:
  letsencrypt-data:
  nginx-ssl:
```

### Deploy

```bash
# Create .env file
echo "POSTGRES_PASSWORD=<local-only-password>" > .env
echo "ADMIN_EMAIL=admin@example.com" >> .env

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f app

# Check status
docker-compose ps
```

For any environment beyond local/single-node evaluation, prefer Swarm secrets or an external secret store over checked-in or shared `.env` files.

**📖 Current single-node references:** [`docker-compose.yml`](docker-compose.yml) and [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md)

---

## 🔧 Development

### Project Structure

```
LyttleNGINX/
├── src/
│   ├── alert/              # Alert system (email, Slack, Discord)
│   ├── certificate/        # Certificate management
│   │   ├── errors/         # Custom error types
│   │   └── dto/            # Data transfer objects
│   ├── filters/            # Global exception filters
│   ├── health/             # Health check endpoints
│   ├── logs/               # Logging service
│   ├── metrics/            # Prometheus metrics
│   ├── nginx/              # NGINX configuration generation
│   ├── prisma/             # Database client
│   ├── rate-limit/         # Rate limiting
│   ├── reloader/           # Config reload service
│   └── utils/              # Utility functions
├── nginx/                  # NGINX configuration templates
├── prisma/                 # Database schema and migrations
├── IMPLEMENTATION_STATUS.md        # Session-by-session delivery tracker
└── ARCHITECTURE_DECISIONS.md       # Architecture decision log
```

### Available Scripts

```bash
# Repository verification
npm run lint               # Run ESLint without modifying files
npm run lint:fix           # Run ESLint and apply safe fixes
npm run typecheck          # Run TypeScript type-checking
npm run build              # Build application
npm run verify             # Lint + typecheck + test + build
npm run test               # Run all classified unit, integration, and e2e suites
npm run test:unit          # Run isolated service/script/config regression suites
npm run test:integration   # Run workflow-level integration suites
npm run test:e2e           # Run controller/Nest application surface suites
npm run test:coverage      # Run the full harness with Node test-runner coverage enabled
npm run test:list          # List suites and baseline coverage pillars

# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Formatting
npm run format             # Format with Prettier
npm run format:check       # Check formatting without changing files

# Runtime
npm run start:prod         # Start production server

# Database
npm run prisma:generate    # Generate Prisma client
npm run prisma:migrate     # Run migrations
npm run prisma:deploy      # Deploy migrations (production)
npm run prisma:format      # Format Prisma schema

# Docker
npm run docker:build       # Build Docker image
npm run docker:setup       # Setup for Docker
```

### Adding a New Feature

1. **Create service:**

   ```bash
   nest g service feature
   ```

2. **Create controller:**

   ```bash
   nest g controller feature
   ```

3. **Create module:**

   ```bash
   nest g module feature
   ```

4. **Add to app.module.ts:**
   ```typescript
   imports: [
     // ... existing imports
     FeatureModule,
   ];
   ```

### Testing

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
```

Session 26 formalized the repository test harness around the built-in Node.js test runner with explicit suite classification and a shared preload step for `ts-node` + `reflect-metadata`.

Current baseline coverage pillars:

- **Auth:** API-key identity, bearer-token validation, endpoint lockdown, RBAC, and security-administration regressions
- **Health:** probe semantics, readiness/startup state, dependency drilldowns, and metrics-facing health reporting
- **Leases:** lease-backed heartbeat behavior and cluster-operation acknowledgement workflows
- **Config generation:** staged NGINX release activation, rollback behavior, and guarded custom-fragment handling
- **Certificate order transitions:** durable order state, artifact activation/rollback, ACME publication, and backup/import/export flows

---

## 📖 Documentation

### Complete Documentation Set

1. **[README.md](README.md)** - current project overview and operator notes
2. **[PRODUCTION_READINESS_ASSESSMENT.md](PRODUCTION_READINESS_ASSESSMENT.md)** - current gap analysis and remediation priorities
3. **[IMPLEMENTATION_PLAN_BY_SESSION.md](IMPLEMENTATION_PLAN_BY_SESSION.md)** - session-by-session delivery roadmap
4. **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)** - live progress tracker for shipped work
5. **[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)** - architecture decision log
6. **[docker-compose.yml](docker-compose.yml)** - single-node evaluation manifest
7. **[docker-compose.swarm.yml](docker-compose.swarm.yml)** - swarm evaluation manifest and target architecture reference
8. **[.env.example](.env.example)** - environment configuration template

### Key Topics

- **Readiness and risk register** → [PRODUCTION_READINESS_ASSESSMENT.md](PRODUCTION_READINESS_ASSESSMENT.md)
- **Implementation roadmap** → [IMPLEMENTATION_PLAN_BY_SESSION.md](IMPLEMENTATION_PLAN_BY_SESSION.md)
- **Delivery progress** → [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- **Architecture decisions** → [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)
- **Environment setup** → [.env.example](.env.example)
- **Deployment manifests** → [docker-compose.yml](docker-compose.yml), [docker-compose.swarm.yml](docker-compose.swarm.yml)

---

## 🐛 Troubleshooting

### Common Issues

#### Build Fails

```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build
```

#### Database Connection Issues

```bash
# Check DATABASE_URL format
# postgresql://user:password@host:port/database

# Test connection
psql $DATABASE_URL
```

#### Certificate Not Being Issued

```bash
# 1. Check DNS resolution
curl http://localhost:3000/certificates/validate/yourdomain.com

# 2. Check logs
docker-compose logs app | grep -i acme

# 3. Verify email is set
echo $ADMIN_EMAIL

# 4. Ensure ports 80 and 443 are accessible
```

#### NGINX Won't Reload

```bash
# Test config syntax
docker-compose exec app nginx -t

# Check certificate files
docker-compose exec app ls -la /etc/letsencrypt/live/

# View error logs
docker-compose exec app cat /var/log/nginx/error.log
```

#### Alerts Not Sending

```bash
# Check configuration
docker-compose exec app printenv | grep -E "(ALERT|SMTP|SLACK)"

# Check if alert service initialized
docker-compose logs app | grep -i "alert"

# View alert logs
docker-compose logs app | grep -E "(Alert|Monitor)"
```

### Debug Mode

Enable debug logging:

```bash
# Set in .env
LOG_LEVEL=debug

# Restart
docker-compose restart app

# View logs
docker-compose logs -f app
```

### Support

For issues and questions:

1. Check [`PRODUCTION_READINESS_ASSESSMENT.md`](PRODUCTION_READINESS_ASSESSMENT.md) for known gaps and risks
2. Review [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for the latest shipped scope
3. Check application logs: `docker-compose logs -f app`

---

## 🏆 Features at a Glance

| Feature           | Status | Description                             |
| ----------------- | ------ | --------------------------------------- |
| 🔐 Auto SSL       | ✅     | Let's Encrypt integration               |
| 📤 Upload Cert    | ✅     | Custom certificate upload               |
| 🔧 Self-Signed    | ✅     | Development certificates                |
| 🔄 Auto Renew     | ✅     | Automatic renewal (12h check)           |
| 🚦 HTTP→HTTPS     | ✅     | Automatic redirect                      |
| 📊 Prometheus     | ✅     | Metrics export                          |
| 📧 Email Alerts   | ✅     | SMTP notifications                      |
| 💬 Slack/Discord  | ✅     | Webhook alerts                          |
| 💾 Backup/Restore | ✅     | Complete backup solution                |
| ⚡ Rate Limiting  | ✅     | 3-tier protection                       |
| ✅ Validation     | ✅     | Input validation                        |
| 🛡️ TLS 1.3        | ✅     | Modern protocols only                   |
| 🔒 OCSP Stapling  | ✅     | Enhanced performance                    |
| 📈 Monitoring     | ✅     | Daily health checks                     |
| 🐳 Docker         | ⚠️     | Evaluation-ready, hardening in progress |

---

## 📊 Statistics

- **Lines of Code:** ~12,000+
- **Documentation:** 2,500+ lines
- **API Endpoints:** 35+
- **Services:** 17+
- **Controllers:** 9
- **Modules:** 11+
- **Verification Status:** Scripts normalized in Session 1; full execution requires a local Node/npm toolchain

---

## 🔒 Security

### Security Features

- ✅ TLS 1.2/1.3 only (no legacy protocols)
- ✅ Strong cipher suites (ECDHE, AES-GCM, ChaCha20-Poly1305)
- ✅ OCSP stapling enabled
- ✅ Security headers (HSTS, X-Frame-Options, CSP)
- ✅ Input validation on all endpoints
- ✅ Rate limiting (3-tier)
- ✅ Certificate/key pair validation
- ✅ HTTP/2 support

### Reporting Security Issues

Please report security vulnerabilities to: admin@example.com

---

## 📜 License

UNLICENSED - Private project by Lyttle Development

---

## 🙏 Acknowledgments

Built with:

- [NestJS](https://nestjs.com/) - Progressive Node.js framework
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [NGINX](https://nginx.org/) - High-performance web server
- [Let's Encrypt](https://letsencrypt.org/) - Free SSL certificates
- [PostgreSQL](https://www.postgresql.org/) - Advanced database

---

## 🚀 Getting Started

Ready to deploy? Follow these steps:

1. **[Installation](#-installation)** - Set up the project
2. **[Configuration](#-configuration)** - Configure environment
3. **[Quick Start](#-quick-start)** - Get running in 5 minutes
4. **[Documentation](#-documentation)** - Read the docs
5. **[Deploy](#-docker-deployment)** - Go to production

---

<p align="center">
  <strong>LyttleNGINX - Enterprise Certificate Management Made Simple</strong>
</p>

<p align="center">
  <sub>Built with ❤️ by Lyttle Development</sub>
</p>
