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
  <img src="https://img.shields.io/badge/license-UNLICENSED-red" alt="License" />
</p>

**NGINX proxy management control plane with certificate automation, monitoring primitives, and an active production-hardening roadmap.**

Built with [NestJS](https://nestjs.com/) • Powered by [PostgreSQL](https://www.postgresql.org/) • Secured by [Let's Encrypt](https://letsencrypt.org/)

> Current state: this repository is under active implementation and hardening. It should **not** currently be treated as production-ready for single-node or Docker Swarm deployment. The current delivery baseline is tracked in `PRODUCTION_READINESS_ASSESSMENT.md`, `IMPLEMENTATION_PLAN_BY_SESSION.md`, `IMPLEMENTATION_STATUS.md`, and `ARCHITECTURE_DECISIONS.md`.

---

## 📍 Current Delivery Status

- **Roadmap status:** Phase 5 in progress
- **Completed in Sessions 1-18 plus follow-up maintenance:** delivery scaffolding, dependency hygiene, authenticated-by-default admin APIs, dependency-aware health semantics, fail-fast container supervision, explicit inter-node control-plane addressing, an identity-aware auth foundation, explicit RBAC authorization policies, durable audit logging for privileged and mutating operations, durable leader leases, lease-backed heartbeat/leader reconciliation, durable cluster operation journaling with per-node ACK tracking, staged NGINX release activation with rollback-safe config deployment, validated allowlisted custom NGINX fragments, strict certificate-domain validation with safe process execution, durable certificate-order state tracking with artifact history and retryable workflows, ACK-backed cluster certificate activation with rollback to prior artifact versions, and an explicit Nest-managed ACME strategy layer with built-in HTTP-01 challenge tracking plus DNS-01 orchestration metadata
- **Next recommended implementation session:** Session 19 — encrypt private key material at rest
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
npm run lint
npm run typecheck
npm run build
npm run verify
```

Current repo toolchain target:

```bash
node -v   # expected: v24.16.0
npm -v    # expected: 11.15.0
```

`npm run test` now runs the focused Session 3-18 regression tests for API access control, health semantics, container-supervision behavior, inter-node addressing, the identity-aware auth foundation, RBAC authorization policy enforcement, audit-logging regressions, lease-backed cluster coordination behavior, cluster-operation journaling, transactional NGINX rollout behavior, guarded `nginx_custom_code` validation, strict domain/process safety, durable certificate-order lifecycle tracking, ACK-backed certificate distribution plus rollback behavior, and the hardened ACME strategy. Session 26 still remains the planned milestone for broad unit/integration/e2e harness expansion.

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
- **HTTP to HTTPS Redirect** - Automatic when SSL is enabled
- **Reverse Proxy** - Full reverse proxy support
- **URL Redirects** - 301/302 redirect support
- **Guarded Custom NGINX Fragments** - Allowlisted server/location directives validated before rollout
- **WebSocket Support** - Full WebSocket proxying capability

### 📊 Monitoring & Observability

- **Prometheus Metrics** - 7+ metrics for Grafana dashboards
- **Health Checks** - Automated daily certificate health monitoring
- **Real-time Status** - Live certificate expiry tracking
- **JSON API** - Query certificate and proxy status
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
- `SMTP_PASS`
- `SLACK_WEBHOOK_URL`
- `DISCORD_WEBHOOK_URL`
- certificate private keys, backup archives, and exported PEM material

#### TLS Configuration

```bash
RENEW_BEFORE_DAYS=30                # Days before expiry to renew
```

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

### Session 3-9 access policy

As of Sessions 3-9, the control-plane API is **authenticated by default**, with a small public probe allowlist, an identity-aware authentication layer, explicit RBAC authorization policies on protected endpoints, and durable audit logging for privileged and mutating operations.

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

Session 7 introduced a JWT bearer-token foundation that attaches actor identity to each authenticated request. Session 8 builds on that with explicit RBAC policies. Session 9 adds durable audit logging for privileged and mutating operations, including successful writes, denied privileged attempts, and controller/service failures on protected routes. Legacy API keys remain supported temporarily as a migration bridge and can be exchanged for short-lived bearer tokens via `POST /auth/token` when `AUTH_JWT_SECRET` is configured.

Current identity model:

- `admin` actors for operator/API clients
- `internal-node` actors for trusted inter-node calls

Current RBAC roles:

- `viewer` — read-only admin visibility into certificates, cluster state, TLS recommendations, and auth configuration
- `operator` — operational actions such as config reloads, certificate renewals, and log access
- `security-admin` — certificate/key lifecycle, backup, export/import, and TLS hardening actions
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
| `security-admin` | certificate/key management, backup/export/import, TLS hardening      |
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
| DELETE | `/certificates/backup/:filename`  | Delete backup       | `security-admin` |
| POST   | `/certificates/backup/import`     | Import certificates | `security-admin` |
| GET    | `/certificates/backup/export/:id` | Export certificate  | `security-admin` |

### Metrics Endpoints

| Method | Endpoint        | Description        | Auth   |
| ------ | --------------- | ------------------ | ------ |
| GET    | `/metrics`      | Prometheus metrics | Public |
| GET    | `/metrics/json` | JSON metrics       | Public |

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

### Auth configuration

Sessions 7-8 add a JWT/OIDC-compatible claim foundation plus RBAC. The most relevant auth env vars are:

- `API_KEY` — temporary legacy compatibility credentials
- `AUTH_JWT_SECRET` — enables locally signed HS256 bearer tokens and `/auth/token`
- `AUTH_JWT_PUBLIC_KEY` — optional RS256 verification key for externally issued bearer tokens
- `AUTH_JWT_ISSUER` — expected token issuer and local token issuer
- `AUTH_JWT_AUDIENCE` — expected token audience and local token audience
- `AUTH_DEFAULT_ADMIN_ROLES` / `AUTH_DEFAULT_ADMIN_SCOPES` — bridge claims applied to legacy API keys during the migration from shared keys to bearer-token identities

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
- wildcard issuance now resolves to DNS-01 automatically when `ACME_CHALLENGE_STRATEGY=auto` and the required DNS hook configuration is present

### ACME strategy selection

Session 18 formalizes ACME challenge handling behind an explicit strategy layer.

The runtime now supports three `ACME_CHALLENGE_STRATEGY` modes:

- `auto` *(default)* — use built-in HTTP-01 for non-wildcard orders and DNS-01 for wildcard orders
- `http-01` — force the built-in database-backed HTTP-01 flow
- `dns-01` — force DNS-01 through the in-app NestJS challenge workflow with external DNS provisioning

#### Built-in HTTP-01 strategy

The hardened HTTP-01 flow is the default for non-wildcard orders and remains cluster-safe:

1. the issuing node starts an in-process ACME order through the NestJS `AcmeService`
2. the HTTP-01 challenge token + key authorization are written into PostgreSQL together with order/strategy metadata
3. any node can answer `/.well-known/acme-challenge/:token` from the shared database record
4. challenge verification happens in-process before the ACME order is completed
5. the certificate service finalizes the challenge lifecycle as `validated` or `failed`, which makes challenge publication / finalization inspectable after the run

The `GET /certificates/challenges` endpoint exposes recent built-in HTTP-01 challenge records with statuses such as `presented`, `cleaned-up`, `validated`, `failed`, and `expired`.

#### DNS-01 strategy

Wildcard orders and operator-selected DNS flows now stay inside the NestJS control plane as well:

- `ACME_DNS_PROVIDER` — operator-facing label for the external DNS workflow or provider integration
- `ACME_DNS_PROPAGATION_SECONDS` — initial propagation delay hint before verification begins
- `ACME_DNS_WAIT_TIMEOUT_MS` — maximum time the app waits for the expected TXT record to become visible
- `ACME_DNS_POLL_INTERVAL_MS` — polling interval while waiting for the TXT record to appear

For DNS-01, the application stores the desired TXT record name/value in `AcmeChallenge.metadata`, exposes it through `GET /certificates/challenges`, and then verifies the record in-process. This removes the old shell-hook dependency while keeping the workflow explicit and auditable.

Example configuration snippets:

```bash
# Default mixed strategy: HTTP-01 for normal domains, DNS-01 for wildcards
ACME_CHALLENGE_STRATEGY=auto

# Force the built-in database-backed HTTP-01 flow
ACME_CHALLENGE_STRATEGY=http-01
ACME_HTTP01_PROPAGATION_SECONDS=5

# Force DNS-01 through the in-app flow while an external DNS automation path publishes TXT records
ACME_CHALLENGE_STRATEGY=dns-01
ACME_DNS_PROVIDER=manual-dns-nest
ACME_DNS_PROPAGATION_SECONDS=45
ACME_DNS_WAIT_TIMEOUT_MS=180000
ACME_DNS_POLL_INTERVAL_MS=3000

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

- `lyttle_certificates_total` - Total certificates
- `lyttle_certificates_valid` - Valid certificates
- `lyttle_certificates_expiring_soon` - Expiring soon
- `lyttle_certificates_expired` - Expired certificates
- `lyttle_certificates_avg_days_until_expiry` - Average days until expiry
- `lyttle_proxy_entries_total` - Total proxy entries
- `lyttle_proxy_entries_ssl` - Proxies with SSL enabled

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

---

## 💾 Backup & Recovery

### Create Backup

```bash
curl -X POST http://localhost:3000/certificates/backup \
  -H "X-API-Key: $API_KEY"
```

Creates a ZIP file containing:

- `certificates.json` - Database export
- `certs/{certificate-storage-id}/fullchain.pem` - Certificate files
- `certs/{certificate-storage-id}/privkey.pem` - Private keys
- `metadata.json` - Backup metadata

### List Backups

```bash
curl http://localhost:3000/certificates/backup \
  -H "X-API-Key: $API_KEY"
```

### Download Backup

```bash
curl http://localhost:3000/certificates/backup/certificates-backup-2025-11-22.zip \
  -H "X-API-Key: $API_KEY" \
  --output backup.zip
```

### Restore from Backup

```bash
# Extract backup
unzip backup.zip

# Import certificates
curl -X POST http://localhost:3000/certificates/backup/import \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @certificates.json
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
- internal certificate-sync broadcasts also use the same operation journal so later certificate activation work can build on a shared ACK model

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
npm run verify             # Lint + typecheck + build
npm run test               # Focused regression suites for shipped sessions (Session 26 will expand the harness)

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
# Placeholder until Session 26
npm run test
```

At the time of Session 1, the repository does **not** yet have the automated unit/integration/e2e harness required by the implementation plan. That work is explicitly tracked in Session 26.

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
