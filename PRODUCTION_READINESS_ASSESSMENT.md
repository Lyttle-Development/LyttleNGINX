# LyttleNGINX Production Readiness Assessment

## Executive summary

**Current verdict: not production ready for a global Docker Swarm deployment with strict auto-recovery requirements.**

The project already contains useful building blocks:
- NestJS control plane
- NGINX config generation
- PostgreSQL-backed certificate and cluster metadata
- ACME challenge storage in the database
- basic leader-election and reload workflows

However, the implementation still has multiple **P0/P1 blockers** that would cause outages, unsafe recovery behavior, split-brain risk, security exposure, and operational blind spots in production.

The biggest blockers are:
1. **Auto-recovery is not reliable**
2. **Security is too weak for administrative control of edge infrastructure**
3. **Inter-node communication is not robust or secure**
4. **Certificate issuance/distribution is not safe enough for a global cluster**
5. **NGINX reload/config deployment is destructive instead of transactional**
6. **Testing, CI/CD, observability, and documentation do not match production claims**

---

## Scope of this assessment

This assessment was based on source review of the current workspace, including:
- `src/`
- `prisma/`
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.swarm.yml`
- `docker-entrypoint.sh`
- `healthcheck.sh`
- NGINX configuration templates
- GitHub Actions workflow
- environment examples

Additional checks performed:
- dependency CVE scan on direct npm dependencies
- IDE error check on key TypeScript files
- attempted build/lint execution from this session

### Validation note

A full terminal build/lint run could **not** be completed from this workspace session because `npm` is not installed in the current execution environment. Static file error checks on sampled core files returned no TypeScript editor errors, but this is **not** a substitute for a full CI build/test pipeline.

---

## Production target definition

Based on your requirements, “production ready” here means:

- **global Docker Swarm deployment** with one instance per node
- **very fast self-recovery** after process, container, node, or transient dependency failure
- **certificate issuance that is safe in multi-node mode**
- **any node may receive public traffic**, including ACME challenge traffic
- **strong admin API**, but only for authenticated and authorized operators/services
- **cluster-aware responses** for mutating operations
- **safe config rollout and rollback**
- **security-first storage and transport of private keys and admin traffic**
- **verifiable operations** through metrics, logs, events, audit records, and tests

---

# 1. Critical weaknesses (P0)

## 1.1 Auto-recovery is currently not trustworthy

### Findings

#### A. `docker-entrypoint.sh` exits with success even on failure paths
`docker-entrypoint.sh` defines a `cleanup()` function that ends with `exit 0`.
That function is called in failure scenarios from `monitor_processes()`.

**Impact:**
- the container can terminate with success after an application failure
- Swarm `restart_policy.condition: on-failure` may not trigger
- this directly violates the “100% auto recover” requirement

#### B. the process monitor is not actually monitoring both processes continuously
In `monitor_processes()`:
- it checks PIDs once
- then immediately calls `wait "$NODE_PID"`
- once blocked in `wait`, it no longer actively checks whether NGINX dies

**Impact:**
- if NGINX dies while Node stays up, the script may not restart NGINX promptly or at all
- traffic can fail while the container still appears alive

#### C. restart suppression intentionally disables recovery
`docker-entrypoint.sh` tracks restart count and after too many restarts it enters:
- `sleep infinity`

**Impact:**
- recovery stops entirely
- the service becomes permanently wedged until manual intervention
- this is the opposite of the required operational model

#### D. Swarm restart policy is capped too aggressively
`docker-compose.swarm.yml` uses:
- `restart_policy.condition: on-failure`
- `max_attempts: 3`

**Impact:**
- a transient failure can permanently stop a node after 3 tries
- unacceptable for edge software that must self-heal

#### E. health checks are too weak to detect real failure
`healthcheck.sh` only checks whether `/ready` returns HTTP 200.
But `HealthController` always returns HTTP 200, and `HealthService.ready()` can report `status: degraded` without failing the endpoint.

**Impact:**
- unhealthy nodes can stay marked healthy
- Swarm will not restart or reschedule them
- traffic can keep flowing to degraded nodes

#### F. readiness does not check the most important dependency: PostgreSQL
The current readiness flow does not fail when the database is unavailable.

**Impact:**
- the node can appear ready while certificate issuance, cluster coordination, or config sync is broken

### Required changes

- remove any failure path that exits with code 0
- remove `sleep infinity` failure mode entirely
- implement proper supervision of both NGINX and the Node process
- preferably split Node control-plane and NGINX dataplane into separate containers/services, or use a real process supervisor if they must stay together
- change restart policy to favor continued recovery rather than permanent stop
- implement separate **startup**, **liveness**, and **readiness** semantics
- readiness must validate at least:
  - database connectivity
  - NGINX master process health
  - last successful config apply
  - last successful certificate sync
  - cluster communication health
- healthcheck must inspect response body, not just status code
- expose degraded/unhealthy as non-200 when recovery is required

---

## 1.2 Several dangerous write endpoints are public

### Findings

The following mutating endpoints are currently missing `ApiKeyGuard`:
- `POST /certificates/upload`
- `POST /certificates/generate-self-signed`
- `POST /certificates/sync`
- `POST /tls/dhparam`

### Impact

An unauthenticated caller may be able to:
- upload certificates and private keys
- generate self-signed certificates
- force sync behavior on nodes
- trigger expensive DH parameter generation

This is a **critical production security issue**.

### Required changes

- make **all mutating endpoints authenticated by default**
- introduce a deny-by-default security model
- require stronger internal auth for node-to-node operations than public admin auth
- separate public health/metrics endpoints from admin/control endpoints

---

## 1.3 Inter-node communication is not secure enough

### Findings

Current node-to-node behavior uses:
- direct HTTP
- IP addresses discovered via `getNodeIpAddress()`
- optional API key on some calls
- **no auth at all** on `POST /certificates/sync`
- no mTLS
- no request signing
- no replay protection
- no per-node identity

### Impact

- any reachable actor on the internal path could spoof a node
- admin/control traffic can be intercepted or replayed
- cluster state changes are not strongly attributable to an authenticated node identity

### Required changes

- create a dedicated **internal control network**
- require **mTLS between nodes**
- issue each node a unique cluster identity certificate
- use short-lived service tokens or mutual TLS SPIFFE-style identities
- sign inter-node requests and include timestamps/nonces
- require auth on **all** internal endpoints
- separate external admin API from internal node API

---

## 1.4 Cluster communication likely fails in Swarm as currently written

### Findings

#### A. wrong port assumption for inter-node calls
In several places the code uses:
- `process.env.PORT || 3000`

But `docker-compose.swarm.yml` publishes:
- container `3000` as host `3003`

Inter-node requests using `http://<node-ip>:3000/...` are likely wrong in host-published Swarm mode.

#### B. node address selection depends on public-IP discovery services
`src/utils/network-utils.ts` tries external services like:
- `api.ipify.org`
- `icanhazip.com`
- `ifconfig.me`

### Impact

- cluster behavior depends on third-party internet services
- nodes may register a public/NAT address that is not reachable from peers
- security and privacy leakage during address detection
- broadcasts/reloads/syncs may silently fail

### Required changes

- stop discovering node identity via public internet services
- use Swarm-provided node metadata, overlay networking, or explicit cluster configuration
- store both:
  - stable node ID
  - internal control-plane address
- never assume published-port == internal-port
- make control port configuration explicit and validated
- add per-node connectivity checks and ACK tracking

---

## 1.5 Certificate issuance and distribution is not robust enough for clustered production

### Findings

#### A. certificate state machine is too weak
The system stores some certificate status metadata, but it does not model a full order lifecycle such as:
- requested
- authorizing
- challenge-published
- validation-pending
- issued
- distributing
- activated
- failed
- rollback
- revoked

**Impact:**
- poor visibility
- weak recovery after mid-flight failure
- hard to reason about certbot/ACME retries safely

#### B. issuance uses shell commands with interpolated user/domain data
`CertificateService` and `TlsConfigService` build shell commands using string interpolation.
Domain DTOs only validate that values are non-empty strings.

**Impact:**
- command injection risk
- path traversal / invalid path materialization risk
- malformed domain values can poison certbot, OpenSSL, filesystem paths, or generated NGINX config

#### C. cert storage path uses raw domain values
Certificate directories are built from the primary domain.
Without strict canonical validation, this is unsafe.

#### D. certbot account/certificate metadata is not persisted in Swarm config
`docker-compose.swarm.yml` defines no persistent volumes for:
- `/etc/letsencrypt`
- `/etc/nginx/ssl`
- `/var/www/certbot`
- backup storage

Even if certificate PEMs are stored in PostgreSQL, loss of local certbot account metadata is still operationally dangerous.

#### E. challenge serving is globally reachable, but issuance coordination is still fragile
The ACME challenge-from-DB design is directionally correct for a cluster, but issuance coordination still relies on advisory locks + DB bookkeeping without a stronger lease/fencing model.

#### F. rate-limit handling is naive
The rate-limit logic counts local DB records by string `contains` on domains.
This is not a reliable Let’s Encrypt rate-limit model.

#### G. failed-cert retry logic may repeatedly churn without strong backoff orchestration across nodes
The current model is better than no retry, but still not robust enough for fleet-wide issuance incidents.

### Required changes

- replace ad-hoc shell command construction with safe process execution using argument arrays
- validate domain names strictly:
  - FQDN rules
  - wildcard rules
  - lowercase normalization
  - punycode handling
  - no path separators, whitespace, shell metacharacters, or control characters
- implement a full **certificate order state machine**
- add durable per-order history and audit records
- persist and version certificate activation state
- track per-node distribution/activation acknowledgements
- persist certbot account material if certbot remains in use
- strongly consider moving to:
  - **DNS-01** for wildcard/global resilience, or
  - a dedicated ACME control-plane service
- if staying with HTTP-01:
  - only one leader creates challenges
  - all nodes serve them from shared storage
  - activation only occurs after challenge publication and validation windows are confirmed
- add per-order fencing tokens and idempotency keys
- add emergency revoke, rollback-to-previous-cert, and freeze-issuance controls

---

## 1.6 NGINX config deployment is destructive, not transactional

### Findings

`ReloaderService.reloadConfig()` currently:
1. clears `/etc/nginx`
2. copies project config into `/etc/nginx`
3. generates files
4. runs `nginx -t`
5. reloads

### Impact

- a mid-process failure can leave NGINX broken or incomplete
- one bad config entry can take out a node
- this is not safe enough for production edge config management

### Additional issue: arbitrary config injection
`nginx_custom_code` is injected directly into generated server blocks.

**Impact:**
- config syntax corruption
- privilege abuse by anyone who can write DB state
- unsafe directives could break serving, leak files, or disable security

### Required changes

- implement **staged config generation** in a separate temp directory
- validate entire config tree there
- only atomically swap/symlink to active config after validation passes
- keep last-known-good config and allow immediate rollback
- store apply metadata:
  - config version
  - source revision
  - apply node
  - apply time
  - validation output
- replace raw `nginx_custom_code` with:
  - either a restricted directive allowlist
  - or a reviewed “advanced mode” with separate approval and validation
- add dry-run, diff, and staged-commit workflows

---

# 2. High-priority weaknesses (P1)

## 2.1 Authentication and authorization model is too weak

### Findings

Current auth is effectively:
- shared API key(s) in env
- exact string match in memory
- no RBAC
- no user identity
- no session/service-account model
- no audit identity
- no key rotation workflow
- no constant-time comparison
- some endpoints are public by mistake

### Impact

This is not adequate for production infrastructure administration.

### Required changes

Implement a real security model:

#### External admin API
- OIDC or JWT-based authentication
- short-lived tokens
- RBAC roles such as:
  - `viewer`
  - `operator`
  - `security-admin`
  - `platform-admin`
- optional IP/network policy for admin endpoints
- optional MFA enforced by upstream auth provider

#### Internal node API
- mTLS-only
- service identity per node
- scoped permissions for:
  - sync
  - reload
  - lease/heartbeat
  - cluster ack

#### Security controls
- audit log every mutating action
- token/key rotation endpoints and procedures
- break-glass credentials with expiration and audit trail

---

## 2.2 Private keys are stored and exported insecurely

### Findings

- certificate private keys are stored in plaintext in PostgreSQL
- backup ZIP archives contain plaintext private keys
- certificate export endpoints return raw key material
- no encryption-at-rest strategy is defined at application layer

### Impact

Compromise of:
- database
- backup directory
- backup transport
- application memory
- admin endpoint access

would expose TLS private keys.

### Required changes

- encrypt private keys before storing them in the database
- use envelope encryption with a KMS/HSM/Vault-managed master key
- version and rotate data encryption keys
- encrypt backups with strong authenticated encryption
- provide checksum/signature validation for backups
- restrict raw key export to a dedicated privileged role
- log and alert on all key export actions

---

## 2.3 Backup and restore are not production-grade

### Findings

Current backup behavior lacks:
- encryption
- integrity signatures
- retention policy
- restore validation
- transactionally consistent snapshots
- off-site storage strategy
- cluster-wide restore workflow

`importCertificates()` also accepts loosely typed payloads and does not perform strong validation.

### Required changes

- define backup classes:
  - config backup
  - certificate backup
  - database backup
  - disaster-recovery bundle
- encrypt all backups
- add integrity manifest + signing
- add retention/rotation policy
- validate imported certificates before acceptance
- support point-in-time recovery for database state
- support cluster restore with node reconciliation

---

## 2.4 Leader election is not strong enough for high-stakes coordination

### Findings

Current approach uses PostgreSQL advisory locks plus DB booleans.
Problems include:
- no fencing token / generation counter
- lock state and DB state can diverge
- deadlock recovery logic comments overstate what `pg_advisory_unlock_all()` can do from a single session
- lock management is tied to the general Prisma client rather than an isolated lock session
- leader intent is duplicated across services

### Impact

Under restart storms, DB hiccups, or timing races, this can still create inconsistent control-plane behavior.

### Required changes

Use a real lease model:
- `cluster_leases` table or dedicated coordination backend
- fields:
  - `lease_name`
  - `owner_node_id`
  - `generation`
  - `expires_at`
  - `renewed_at`
- leader operations must include the active generation/fencing token
- stale generation writes must be rejected
- one component should own leader/lease decisions centrally
- optionally move to etcd/Consul if stronger consensus is required

---

## 2.5 Health, metrics, and alerting are incomplete

### Findings

Current metrics are useful but too shallow.
Missing metrics include:
- per-node sync lag
- config apply success/failure counts
- last successful NGINX reload timestamp
- leader lease age
- certificate order states
- ACME challenge publication latency
- inter-node request failure rate
- backup success/failure/age
- DB connectivity and latency
- reconcile loop duration

Current alerting also lacks:
- timeout/retry discipline
- deduplication
- escalation routing
- silence windows/maintenance mode

### Required changes

- instrument all control-plane workflows
- export Prometheus counters, histograms, and gauges for every critical state machine
- add `/health/live`, `/health/ready`, `/health/startup`, `/health/deep`
- add alert rules for:
  - no leader
  - stale leader lease
  - challenge publication failure
  - no successful reload in X minutes
  - no successful cert sync in X minutes
  - node drift from desired config
  - backup age exceeds threshold
  - DB unavailable / latency high

---

## 2.6 Rate limiting is not production-tuned

### Findings

- throttling is hard-coded in `RateLimitModule`
- env vars for rate limits are present in compose files but not actually wired into the module
- no endpoint-specific policy
- no exemption/alternate policy for internal node traffic

### Required changes

- make limits configurable per environment
- define separate policies for:
  - public health/metrics
  - admin reads
  - admin writes
  - internal node communication
- add burst control and IP/account-based controls

---

## 2.7 Logging is not production-grade

### Findings

- synchronous file writes in `LogsService`
- duplicate stdout/stderr writes in multiple places
- no structured JSON logging standard
- no correlation IDs
- no audit/event log separation
- possible sensitive data exposure in logs

### Required changes

- emit structured JSON logs
- include:
  - request ID
  - node ID
  - cluster operation ID
  - certificate order ID
  - actor identity
- send logs to stdout only and use platform log shipping
- separate operational logs from audit logs
- redact secrets and private material consistently

---

# 3. Moderate weaknesses (P2)

## 3.1 CI/CD does not validate production claims

### Findings

`.github/workflows/main.yml` only:
- checks out code
- builds Docker image
- pushes image

There is no:
- test execution
- lint gate
- typecheck gate
- security scan
- dependency audit gate
- container scan
- SBOM generation
- deployment smoke test

README claims such as “production-ready”, “build passing”, and “coverage ready” are not supported by the actual repository state.

### Required changes

Add mandatory CI stages:
- install
- lint
- typecheck
- unit tests
- integration tests
- e2e tests
- migration test
- Docker build test
- Trivy/Grype image scan
- npm audit / CVE gate
- SBOM generation
- signed image provenance

---

## 3.2 There are effectively no automated tests in the project

### Findings

No test files were found in the workspace for unit or e2e coverage.
`package.json` also does not define normal test scripts.

### Required changes

Minimum required test suite:
- unit tests for services/utilities
- integration tests for Prisma and ACME challenge flows
- e2e tests for auth and controller behavior
- NGINX config generation snapshot tests
- certificate order recovery tests
- leader-election and failover tests
- chaos/fault-injection tests for:
  - DB blips
  - node restart
  - NGINX crash
  - stale leader
  - partial cluster reachability

---

## 3.3 Documentation is inconsistent with repository reality

### Findings

`README.md` references many docs that are not present in the visible repository structure.
The README also advertises production readiness and coverage that are not substantiated by tests or CI.

### Required changes

- keep documentation honest and generated from actual state
- add architecture docs for cluster mode
- add runbooks for:
  - failed issuance
  - node replacement
  - DB failover
  - backup restore
  - emergency cert revoke
  - broken config rollback

---

## 3.4 Docker packaging has security and reproducibility issues

### Findings

- runtime image installs Node via external setup script during build
- comment says versions are specific/reproducible, but most apt packages are not actually pinned
- container appears to run as root
- NGINX logs are made world-writable (`chmod 666`)
- secret env vars are passed directly rather than via Swarm secrets/configs

### Required changes

- run as non-root wherever possible
- pin base images and packages appropriately
- avoid curl-to-shell where feasible
- use Swarm secrets for sensitive values
- tighten file permissions on key/cert/log locations
- add read-only root filesystem where possible
- drop Linux capabilities not required
- add seccomp/apparmor/capability policy guidance

---

## 3.5 The single-instance compose file is not validly production usable

### Findings

`docker-compose.yml` contains both:
- `network_mode: host`
- `ports:` mappings

with comments saying “USE ... OR ... NOT BOTH”, but both are present.

### Impact

- ambiguous/invalid deployment behavior
- not safe for operators to use as-is

### Required changes

- provide separate, valid deployment examples for:
  - local dev
  - single-node prod
  - Swarm global mode
- remove contradictory config

---

## 3.6 NGINX template issues exist even in defaults

### Findings

`nginx/conf.d/default.conf` references `/errors/50x.html`, while the workspace contains `nginx/html/errors/5xx.html`.

### Impact

- error-page behavior is inconsistent and may fail during real incidents

### Required changes

- correct default assets/templates
- add automated tests validating rendered NGINX configs and referenced files

---

# 4. Dependency and supply-chain concerns

## 4.1 Known dependency vulnerabilities

Dependency scan results found direct dependency issues including:
- `@nestjs/core@11.1.9` → upgrade to `11.1.18+`
- `nodemailer@7.0.10` → upgrade to a fixed release line

### Required changes

- patch vulnerable direct dependencies immediately
- generate SBOM
- add automated vulnerability scans to CI
- define dependency update cadence and emergency patch SLA

---

# 5. Architecture changes required for true production readiness

## 5.1 Recommended target architecture

### Preferred model: split control plane from edge dataplane

#### Control plane
Responsible for:
- admin API
- desired-state management
- certificate order workflow
- leader lease / coordination
- config versioning
- audit logging
- backup orchestration

#### Edge agent / node runtime
Responsible for:
- local NGINX runtime
- serving ACME HTTP-01 challenges from shared state
- applying validated config bundles
- activating certificate bundles
- reporting ACK/status/health to control plane

### Why this is better

It reduces the risk that every node performs every critical control-plane function independently.
It also makes it easier to implement:
- strict RBAC
- cleaner failure domains
- transactional config rollout
- node reconciliation
- controlled certificate activation

---

## 5.2 Cluster-safe certificate design for global mode

### Recommended workflow

1. Admin/API request reaches **any node**
2. Receiving node authenticates/authorizes request
3. Request is forwarded to leader over internal mTLS, or leader is resolved and the request is proxied internally
4. Leader creates a **certificate order record** with idempotency key
5. Leader acquires a lease/fencing token for issuance
6. Leader publishes ACME challenge records to shared storage
7. All nodes serve challenge responses from shared storage
8. Leader finalizes ACME order
9. New cert/key bundle is encrypted and stored centrally
10. Desired-state version is incremented
11. Each node pulls the bundle, validates it locally, writes atomically, runs `nginx -t`, reloads, and ACKs success/failure
12. Leader reports completion only after required ACK policy is met

### ACK policy options

- `all-nodes`
- `majority`
- `at-least-one-per-region`
- `best-effort`

For certificate activation, I strongly recommend:
- **all eligible nodes ACK** before the operation is considered complete
- failure should leave old cert active where possible

---

## 5.3 Stronger coordination model

Replace advisory-lock-only logic with:
- lease record with expiration
- generation number
- idempotency keys on all mutating requests
- operation journal/event table
- per-node apply acknowledgements

Suggested tables:
- `ClusterLease`
- `ClusterOperation`
- `ClusterOperationAck`
- `DesiredConfigVersion`
- `NodeAppliedConfigVersion`
- `CertificateOrder`
- `CertificateArtifactVersion`

---

# 6. API expansion required for production operations

You asked for an extensive API with cluster-aware admin tools. Below is the recommended surface.

## 6.1 Authentication / authorization API

- `POST /auth/login` (if local auth is used)
- `POST /auth/token/refresh`
- `GET /auth/me`
- `GET /auth/roles`
- `POST /auth/service-accounts`
- `POST /auth/service-accounts/:id/rotate`
- `GET /auth/audit`

## 6.2 Cluster topology and control

- `GET /cluster/status`
- `GET /cluster/nodes`
- `GET /cluster/nodes/:nodeId`
- `POST /cluster/nodes/:nodeId/drain`
- `POST /cluster/nodes/:nodeId/undrain`
- `POST /cluster/nodes/:nodeId/maintenance`
- `POST /cluster/nodes/:nodeId/reconcile`
- `GET /cluster/leader`
- `GET /cluster/lease`
- `POST /cluster/lease/transfer`
- `POST /cluster/reconcile`
- `GET /cluster/operations`
- `GET /cluster/operations/:operationId`

## 6.3 Desired state / config rollout

- `GET /config/current`
- `POST /config/draft`
- `POST /config/draft/:id/validate`
- `GET /config/draft/:id/diff`
- `POST /config/draft/:id/commit`
- `POST /config/rollback/:version`
- `GET /config/versions`
- `GET /config/versions/:version/acks`
- `POST /config/test-render`

## 6.4 Proxy management

Currently this is a major gap. Add:
- `GET /proxies`
- `POST /proxies`
- `GET /proxies/:id`
- `PATCH /proxies/:id`
- `DELETE /proxies/:id`
- `POST /proxies/:id/validate`
- `POST /proxies/:id/test-upstream`
- `POST /proxies/:id/disable`
- `POST /proxies/:id/enable`

## 6.5 Certificate lifecycle

- `GET /certificates`
- `POST /certificates/orders`
- `GET /certificates/orders/:id`
- `POST /certificates/orders/:id/retry`
- `POST /certificates/orders/:id/cancel`
- `POST /certificates/:id/renew`
- `POST /certificates/:id/revoke`
- `POST /certificates/import`
- `POST /certificates/export`
- `GET /certificates/:id/history`
- `GET /certificates/:id/distribution`
- `POST /certificates/:id/activate`
- `POST /certificates/:id/rollback`
- `GET /certificates/challenges`

## 6.6 Node sync/apply status

- `GET /nodes/:nodeId/certs`
- `GET /nodes/:nodeId/config`
- `GET /nodes/:nodeId/health`
- `GET /nodes/:nodeId/last-ack`
- `POST /nodes/:nodeId/reload`
- `POST /nodes/:nodeId/sync`

## 6.7 Backup / restore / disaster recovery

- `POST /backups`
- `GET /backups`
- `GET /backups/:id`
- `POST /backups/:id/verify`
- `POST /restore/plan`
- `POST /restore/execute`
- `GET /restore/jobs/:id`

## 6.8 Observability and audit

- `GET /metrics`
- `GET /events`
- `GET /audit`
- `GET /logs/search`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/deep`
- `GET /health/dependencies`

## 6.9 Security administration

- `GET /security/status`
- `GET /security/secrets/health`
- `POST /security/rotate/api-key` (if API keys remain)
- `POST /security/rotate/internal-certs`
- `GET /security/policy`
- `GET /security/access-review`

### API behavior rule for cluster-wide mutating actions

For actions that affect cluster state, the API should not simply return local-node success.
It should return one of:
- accepted with operation ID (`202`)
- completed with ACK summary
- failed with per-node error detail

That means every cluster mutation should be represented as an operation object with:
- operation ID
- initiator
- desired state version
- target nodes
- ACK state per node
- timeout
- final status

---

# 7. Security hardening checklist

## Must-have
- authenticate every mutating endpoint
- RBAC
- mTLS internal traffic
- secrets via Swarm secrets / Vault / KMS
- at-rest encryption for key material
- audit trail for all sensitive operations
- structured secret redaction in logs
- signed backups
- dependency scanning and image scanning
- non-root runtime where feasible
- strict domain validation
- safe process execution without shell interpolation

## Strongly recommended
- OIDC SSO for admins
- IP allowlisting for admin surface
- WAF/rate controls in front of admin API
- immutable config versions
- signed configuration bundles
- config approval workflow for dangerous directives

---

# 8. Observability and SRE requirements

## Metrics to add
- `cluster_leader_lease_seconds_remaining`
- `cluster_operation_duration_seconds`
- `cluster_operation_failures_total`
- `node_config_version`
- `node_desired_config_version`
- `node_cert_sync_lag_seconds`
- `nginx_reload_failures_total`
- `certificate_orders_total{state=...}`
- `certificate_activation_failures_total`
- `db_connectivity_status`
- `db_query_duration_seconds`
- `backup_age_seconds`

## Alerts to add
- no active leader
- leader lease expires soon
- node missed heartbeat
- config apply failed on any node
- cluster desired/applied version drift
- certificate order stuck > X minutes
- no successful backup in X hours
- DB unavailable
- repeated container restarts
- unhealthy node still receiving traffic

## Runbooks required
- replace failed node
- DB failover event
- ACME provider outage
- certificate issuance stuck
- rollback bad NGINX config
- restore lost certificate material
- rotate compromised admin credentials

---

# 9. Data model changes required

## Current schema gaps
The current schema is too small for reliable clustered operations.

## Add at minimum
- `CertificateOrder`
- `CertificateArtifact`
- `CertificateActivation`
- `ClusterLease`
- `ClusterOperation`
- `ClusterOperationAck`
- `DesiredStateVersion`
- `NodeState`
- `AuditEvent`
- `SecretMetadata`

This will let the system track:
- intent
- current state
- per-node convergence
- who changed what
- rollback points

---

# 10. Testing strategy required before calling this production-ready

## Unit tests
- domain parsing/validation
- lock/lease service logic
- NGINX config generation
- certificate validation helpers

## Integration tests
- Prisma migration and boot
- ACME challenge publication/retrieval
- certificate order state transitions
- config staging + atomic swap

## E2E tests
- auth + RBAC
- certificate request flow
- cluster reload flow
- backup/restore flow
- node ACK aggregation

## Fault-injection / chaos tests
- DB temporary outage
- leader crash during issuance
- NGINX crash during config apply
- node restart during cert activation
- inter-node network partition
- stale leader lease recovery

## Swarm tests
- rolling update in global mode
- node join/leave behavior
- published-port/internal-port communication validation
- host-mode traffic behavior under failure

---

# 11. Prioritized remediation plan

## Phase 0: stop the biggest risks immediately
1. lock down all public mutating endpoints
2. remove `exit 0` failure masking from entrypoint
3. remove `sleep infinity` restart suppression
4. fix health/readiness semantics
5. fix Swarm inter-node address/port model
6. stop using public-IP discovery services for node comms
7. patch vulnerable dependencies
8. use Swarm secrets for credentials/API keys

## Phase 1: make cluster behavior correct
1. implement lease + fencing token model
2. build operation journal + node ACK tracking
3. make reload/config apply transactional with rollback
4. define stable internal node identities and mTLS
5. harden certificate order workflow

## Phase 2: make it secure and operable
1. introduce RBAC + audit logging
2. encrypt key material and backups
3. add structured logs, richer metrics, alerts, runbooks
4. add proxy CRUD/config versioning APIs

## Phase 3: prove it works
1. add unit/integration/e2e/chaos tests
2. add CI/CD gates and supply-chain checks
3. run staged cluster simulations and failure drills
4. publish an honest operations guide and SLOs

---

# 12. Final conclusion

LyttleNGINX is **not yet safe to classify as production-ready** for the operating model you described.

It has a promising foundation, especially:
- database-backed ACME challenge serving
- cluster metadata tracking
- NGINX generation
- certificate synchronization ideas

But today it still has critical weaknesses in:
- recovery behavior
- endpoint security
- inter-node trust
- config rollout safety
- certificate lifecycle control
- observability
- test coverage
- operational rigor

If you want this system to be trusted as a global edge control component, the next milestone should be:

> **Convert it from a “feature-complete prototype” into a lease-driven, transactional, audited, cluster-reconciled control plane with strict security boundaries.**

That is the level required to satisfy your no-long-outage / auto-recovery / any-node-can-receive-traffic production goal.

