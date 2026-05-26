# Architecture Decisions Log

Last updated: 2026-05-24

This file records repository-level architectural and delivery decisions so future implementation sessions can build on explicit, reviewable choices.

## How to use this log

- add a new ADR-style entry when a decision changes architecture, delivery shape, verification policy, or operator expectations
- link each decision to the session that introduced it
- mark superseded decisions explicitly instead of deleting history

---

## Decision index

| ID      | Title                                                                                     | Status   | Session    | Date       |
| ------- | ----------------------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| ADR-001 | Production-readiness source of truth                                                      | accepted | Session 1  | 2026-05-24 |
| ADR-002 | Session-based delivery model                                                              | accepted | Session 1  | 2026-05-24 |
| ADR-003 | Standard repository verification contract                                                 | accepted | Session 1  | 2026-05-24 |
| ADR-004 | Deployment mode expectations                                                              | accepted | Session 1  | 2026-05-24 |
| ADR-005 | Secret material stays out of git                                                          | accepted | Session 2  | 2026-05-24 |
| ADR-006 | Authenticated-by-default control-plane API                                                | accepted | Session 3  | 2026-05-24 |
| ADR-007 | Explicit probe endpoints with dependency-aware readiness                                  | accepted | Session 4  | 2026-05-24 |
| ADR-008 | Fail-fast container supervision and restart-friendly deployment policies                  | accepted | Session 5  | 2026-05-24 |
| ADR-009 | Explicit advertised control-plane endpoints for cluster communication                     | accepted | Session 6  | 2026-05-24 |
| ADR-010 | Identity-aware auth foundation with bearer-token support and legacy API-key compatibility | accepted | Session 7  | 2026-05-24 |
| ADR-011 | Explicit RBAC policies with a global authorization guard                                  | accepted | Session 8  | 2026-05-24 |
| ADR-012 | Durable audit events for privileged and mutating operations                               | accepted | Session 9  | 2026-05-24 |
| ADR-013 | Lease-based leader coordination with generation fencing tokens                            | accepted | Session 10 | 2026-05-24 |
| ADR-014 | Lease-backed heartbeat and leader reconciliation                                          | accepted | Session 11 | 2026-05-24 |
| ADR-015 | Durable cluster operation journal with per-node acknowledgements                          | accepted | Session 12 | 2026-05-24 |
| ADR-016 | Staged NGINX runtime releases with atomic activation and rollback                         | accepted | Session 13 | 2026-05-24 |
| ADR-017 | Validated allowlisted `nginx_custom_code` fragments                                       | accepted | Session 14 | 2026-05-24 |
| ADR-018 | Strict normalized certificate domains and argument-array process execution                | accepted | Session 15 | 2026-05-24 |
| ADR-019 | Durable certificate orders with artifact history and retryable lifecycle state            | accepted | Session 16 | 2026-05-24 |
| ADR-020 | ACK-backed certificate artifact activation with rollback to prior versions                | accepted | Session 17 | 2026-05-24 |
| ADR-021 | Explicit ACME strategy selection with DB-backed HTTP-01 tracking and DNS-01 hook support | accepted | Session 18 | 2026-05-24 |

---

## ADR-001 — Production-readiness source of truth

- Status: accepted
- Session: Session 1 — Delivery scaffolding and progress tracking
- Date: 2026-05-24

### Context

The repository README historically advertised production readiness, but the current source review in `PRODUCTION_READINESS_ASSESSMENT.md` documents multiple P0/P1 blockers. Future sessions need a single, honest baseline for what “done” means.

### Decision

Treat the following documents as the canonical delivery set:

1. `PRODUCTION_READINESS_ASSESSMENT.md` — current gap analysis and risk inventory
2. `IMPLEMENTATION_PLAN_BY_SESSION.md` — ordered remediation roadmap
3. `IMPLEMENTATION_STATUS.md` — live progress tracker for shipped work
4. `ARCHITECTURE_DECISIONS.md` — durable log of cross-session decisions

### Consequences

- README and other operator docs must not contradict the assessment or status tracker
- future sessions should update the status tracker and ADR log when scope materially changes
- production-readiness claims must be backed by completed roadmap work, not historical feature inventory alone

---

## ADR-002 — Session-based delivery model

- Status: accepted
- Session: Session 1 — Delivery scaffolding and progress tracking
- Date: 2026-05-24

### Context

The remediation roadmap spans security, cluster coordination, certificate lifecycle, recovery, testing, and CI/CD. Shipping those changes safely requires small, reviewable increments.

### Decision

Use the session structure from `IMPLEMENTATION_PLAN_BY_SESSION.md` as the default delivery unit. Each session should be:

- focused
- testable or otherwise verifiable within current repo constraints
- low-risk
- reviewable
- documented before close-out

### Consequences

- implementation work should avoid unrelated refactors
- each completed session should update both status and documentation for the touched area
- acceptance criteria should remain explicit enough to verify before moving on

---

## ADR-003 — Standard repository verification contract

- Status: accepted
- Session: Session 1 — Delivery scaffolding and progress tracking
- Date: 2026-05-24

### Context

The repository previously had partial scripts, but there was no normalized verification contract covering linting, type-checking, builds, and an explicit placeholder for tests.

### Decision

Adopt the following standard commands in `package.json`:

- `npm run lint`
- `npm run lint:fix`
- `npm run format`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run verify`

For now, `npm run test` is an explicit placeholder until Session 26 adds the automated test harness.

### Consequences

- contributors have a consistent pre-review command set immediately
- CI/CD work in Session 28 can build on a stable script contract
- Session 26 is responsible for replacing the test placeholder with real automated coverage

---

## ADR-004 — Deployment mode expectations

- Status: accepted
- Session: Session 1 — Delivery scaffolding and progress tracking
- Date: 2026-05-24

### Context

The repository supports several deployment shapes, but they are not equally mature. The README previously blurred the lines between local evaluation, single-node use, and the intended Swarm target architecture.

### Decision

Document three explicit deployment expectations:

1. Local development
   - intended for coding, manual verification, and exploratory testing
2. Single-node Compose
   - intended for operator evaluation, demos, and non-HA environments
   - not yet positioned as hardened production
3. Docker Swarm global mode
   - remains the target production architecture
   - should be treated as controlled testing only until P0/P1 roadmap sessions are complete

### Consequences

- operator documentation must distinguish current support level from target architecture
- deployment examples should prefer clarity over overclaiming readiness
- later sessions should tighten each mode's docs and manifests without erasing the current warning state

---

## ADR-005 — Secret material stays out of git

- Status: accepted
- Session: Session 2 — Dependency hygiene and secret-handling cleanup
- Date: 2026-05-24

### Context

The production-readiness assessment identified secret handling as an immediate risk area. The repository already tracked only `.env.example`, but the ignore rules and operator docs did not clearly define which files and artifacts must stay out of version control or where production secrets should come from.

### Decision

Adopt the following repository policy:

1. `.env.example` remains the only env template intended for git tracking.
2. Live env overrides such as `.env`, `.env.local`, `.env.production`, and other `.env.*` files must remain untracked.
3. Generated certificate/key material and backup artifacts must also remain untracked.
4. Production secret sources should be Docker Swarm secrets or an external secret manager such as Vault or a cloud secret-management service.
5. Published examples and docs must use placeholders, not live-looking credentials.

### Consequences

- future delivery sessions should preserve the distinction between safe examples and runtime secret injection
- operators have an explicit default for where production secrets should live even before first-class secret-provider integration lands
- later sessions can add `_FILE` support or deeper secret-provider integrations without changing the repository rule that sensitive material must stay out of git

---

## ADR-006 — Authenticated-by-default control-plane API

- Status: accepted
- Session: Session 3 — Lock down public mutating endpoints
- Date: 2026-05-24

### Context

The production-readiness assessment identified several P0 write endpoints that were publicly reachable, including certificate upload, self-signed certificate generation, certificate sync, and DH parameter generation. The repository also relied on per-endpoint guard annotations, which made it easy to miss new routes and accidentally expose control-plane functionality.

### Decision

Adopt an authenticated-by-default API policy for the NestJS control plane:

1. register the API-key guard globally so admin and internal-control endpoints require authentication unless explicitly marked otherwise
2. keep a small, explicit public allowlist using a `@Public()` decorator
3. limit the current public allowlist to:
   - `GET /health`
   - `GET /ready`
   - `GET /metrics`
   - `GET /metrics/json`
   - `GET /.well-known/acme-challenge/:token`
4. remove the previous development-mode bypass that made protected endpoints public when `API_KEY` was unset

### Consequences

- new endpoints are protected by default, which reduces the chance of future accidental public mutations
- operators must configure `API_KEY` even in local evaluation when they need to access admin endpoints
- public observability and ACME flows remain available, but all other current API surfaces should be treated as admin/control-plane endpoints
- Session 7 and Session 8 can build on this deny-by-default posture when introducing richer identity and RBAC models

---

## ADR-007 — Explicit probe endpoints with dependency-aware readiness

- Status: accepted
- Session: Session 4 — Fix health, readiness, liveness, and startup semantics
- Date: 2026-05-24

### Context

The previous health model exposed only `/health` and `/ready`, always returned HTTP 200 for readiness, and did not validate the database or recent control-plane convergence. That allowed orchestration layers to keep routing traffic to nodes that had lost PostgreSQL connectivity, had stale config/certificate state, or had not finished startup.

### Decision

Adopt explicit probe semantics for the NestJS control plane:

1. expose `GET /health/live` for liveness
2. expose `GET /health/startup` for startup completion
3. expose `GET /health/ready` for readiness
4. keep `GET /health` and `GET /ready` as temporary compatibility aliases for liveness and readiness respectively
5. make readiness return HTTP 503 when any critical dependency check fails
6. require readiness to validate at least:
   - PostgreSQL connectivity
   - NGINX master-process health
   - a recent successful config apply
   - a recent successful certificate sync
7. update the container healthcheck script to inspect both the readiness HTTP status and the JSON body

### Consequences

- orchestrators can now distinguish “process alive” from “safe to receive traffic”
- the service stays unready after restart until config apply and certificate sync have completed successfully at least once
- later sessions should persist and broaden health signals beyond the current in-memory freshness tracking, especially for cluster-wide convergence and richer observability

---

## ADR-008 — Fail-fast container supervision and restart-friendly deployment policies

- Status: accepted
- Session: Session 5 — Fix container and process auto-recovery behavior
- Date: 2026-05-24

### Context

The previous container startup flow tried to recover crashes inside `docker-entrypoint.sh`, but it did so unsafely:

- failure paths ended with `exit 0`, which could suppress orchestrator restarts
- repeated failures eventually triggered `sleep infinity`, leaving the service permanently wedged
- `nginx` daemonized away from the supervising shell, which made process-state tracking fragile
- the Swarm manifest limited restart attempts to three failures, which was too aggressive for the intended self-healing edge runtime

### Decision

Adopt a fail-fast supervision model for the current single-container runtime:

1. run the NestJS process and the NGINX master as directly supervised child processes
2. start NGINX in foreground mode (`daemon off;`) so the entrypoint can track its actual lifecycle
3. treat any unexpected child-process exit as a container failure and exit non-zero so Docker or Swarm can restart the container
4. reserve exit code `0` for intentional shutdowns initiated by container stop signals
5. remove restart-state bookkeeping, in-container retry suppression, and all `sleep infinity` wedged states
6. configure deployment manifests to prefer continued recovery:
   - Compose uses `restart: unless-stopped`
   - Swarm uses `restart_policy.condition: any` without a hard `max_attempts` cap
   - both manifests allow a grace window for orderly child-process shutdown

### Consequences

- Node or NGINX crashes now translate into observable container failures instead of hidden partial outages
- graceful container stops still terminate both supervised processes cleanly without turning normal shutdown into a failure
- the current architecture still relies on a shell-based two-process container, so later sessions may still choose to split the control plane from the edge runtime or adopt a dedicated supervisor

---

## ADR-009 — Explicit advertised control-plane endpoints for cluster communication

- Status: accepted
- Session: Session 6 — Fix inter-node addressing and Swarm communication model
- Date: 2026-05-24

### Context

The production-readiness assessment identified two related cluster-communication flaws:

- nodes tried to discover their identity through third-party public-IP services
- inter-node requests assumed `process.env.PORT` matched the peer-facing reachable port in Swarm

That made peer communication fragile, leaked topology information to public services, and broke the distinction between the container's internal listen port and the port other nodes must actually call.

### Decision

Adopt an explicit advertised control-plane endpoint model:

1. each node advertises a routable control-plane address using `CLUSTER_CONTROL_ADDRESS` or `CLUSTER_CONTROL_URL`
2. each node advertises a peer-facing control-plane port using `CLUSTER_CONTROL_PORT`
3. `PORT` remains the local NestJS listen port and must not be reused implicitly for peer URL construction
4. cluster registration stores the advertised control-plane endpoint in node metadata
5. inter-node reload and certificate-sync broadcasts build their URLs from the registered endpoint, not from public-IP discovery or hard-coded port assumptions
6. loopback or otherwise non-routable advertised endpoints are rejected for peer use in production-mode registration

### Consequences

- Swarm and other clustered deployments must now provide explicit control-plane addressing configuration
- operators can inspect the registered peer endpoint for each node through cluster metadata instead of inferring behavior from logs or container internals
- inter-node communication remains HTTP + API-key authenticated for now; Session 7, Session 8, and later security work still need to introduce stronger node identity and transport security

---

## ADR-010 — Identity-aware auth foundation with bearer-token support and legacy API-key compatibility

- Status: accepted
- Session: Session 7 — Introduce a real auth foundation
- Date: 2026-05-24

### Context

The production-readiness assessment identified the current shared API-key model as too weak for real production administration because it lacked request identity, richer claim semantics, and a credible bridge toward RBAC, audit logging, and stronger internal node authentication.

Session 3 already moved the API surface to authenticated-by-default, but the code still treated auth as a yes/no API-key check rather than an actor model.

### Decision

Adopt an identity-aware authentication foundation with the following properties:

1. keep the API authenticated by default using the existing global guard posture
2. allow that guard to resolve either:
   - legacy API keys (`X-API-Key` or `Authorization: ApiKey ...`)
   - JWT bearer tokens (`Authorization: Bearer ...`)
3. attach a structured identity object to each authenticated request, including:
   - subject
   - actor type (`admin` or `internal-node`)
   - auth method
   - roles
   - scopes
   - issuer/audience metadata
4. support short-lived locally issued HS256 bearer tokens via `AUTH_JWT_SECRET`
5. support verification of externally issued bearer tokens through standard issuer/audience claims and optional `AUTH_JWT_PUBLIC_KEY` for RS256 verification
6. preserve temporary legacy API-key compatibility and allow API-key-authenticated clients to exchange for a bearer token via `POST /auth/token`
7. introduce identity inspection endpoints (`GET /auth/me`, enriched `GET /auth/status`, and richer `GET /auth/info`) so operators and future tests can observe the resolved actor context

### Consequences

- the codebase now has a real request identity object that later sessions can use for RBAC decisions, audit logging, and internal-node policy separation
- operators can begin migrating clients from raw API keys to short-lived bearer tokens without breaking existing integrations immediately
- bearer-token support is intentionally a foundation, not a full security model: Session 8 still needs RBAC, Session 9 still needs audit logging, and later sessions still need stronger internal transport security such as mTLS

---

## ADR-011 — Explicit RBAC policies with a global authorization guard

- Status: accepted
- Session: Session 8 — Add RBAC and authorization policies
- Date: 2026-05-24

### Context

Session 7 introduced stable request identity, but the API still treated most authenticated actors equivalently. The production-readiness assessment explicitly called for RBAC roles such as `viewer`, `operator`, `security-admin`, `platform-admin`, and `internal-node`, plus an explicit permission matrix for all endpoints.

Without a second authorization layer, any authenticated caller with a valid credential could still reach sensitive backup, cluster-maintenance, certificate, and TLS-hardening routes.

### Decision

Adopt an explicit RBAC model enforced by a global authorization guard:

1. keep the existing authenticated-by-default posture from Session 3 and identity resolution from Session 7
2. add a second global guard that evaluates authorization metadata on every non-public route
3. require protected routes to declare an explicit authorization policy; missing policy metadata is treated as a configuration error and denied
4. define the initial RBAC catalog as:
   - `viewer`
   - `operator`
   - `security-admin`
   - `platform-admin`
   - `internal-node`
5. adopt the following initial hierarchy:
   - `platform-admin` implies `security-admin`, `operator`, and `viewer`
   - `security-admin` implies `viewer`
   - `operator` implies `viewer`
   - `internal-node` remains separate from admin roles
6. map the current API surface explicitly, including:
   - read-only inspection endpoints → `viewer`
   - runtime operational actions such as reload and renew → `operator`
   - certificate/key, backup, export/import, and TLS hardening actions → `security-admin`
   - cluster leader-management and break-glass maintenance endpoints → `platform-admin`
   - internal certificate sync → `internal-node` or `platform-admin` for operator fallback during migration
7. preserve temporary legacy API-key compatibility by continuing to map configured API keys to default admin roles from env configuration

### Consequences

- the current endpoint permission matrix is now explicit in code, enforceable at runtime, and regression-tested
- later sessions can add audit logging, service accounts, and finer-grained operational APIs without first reworking the basic authorization model again
- legacy API keys remain a compatibility bridge rather than a destination state; future security work should continue pushing operators toward short-lived bearer identities and narrower role assignment

---

## ADR-012 — Durable audit events for privileged and mutating operations

- Status: accepted
- Session: Session 9 — Add audit logging for privileged and mutating operations
- Date: 2026-05-24

### Context

Sessions 7 and 8 introduced stable request identity and explicit RBAC, but the control plane still lacked a durable record of who attempted sensitive operations, what they targeted, whether they succeeded, and how to correlate those actions across logs and client-visible failures.

The production-readiness assessment explicitly called for audit logging of privileged and mutating operations, including failed privileged attempts.

### Decision

Adopt a durable audit-event model with request correlation for the current NestJS control plane:

1. persist audit records in a new Prisma-backed `AuditEvent` table
2. record at least:
   - actor identity metadata when available
   - action name
   - target identifier or label when available
   - outcome (`success`, `failure`, or `denied`)
   - request method/path and HTTP status
   - correlation ID and timestamp
3. generate or propagate a correlation ID for audited requests and return it via `X-Correlation-Id`
4. audit all protected mutating routes by default through a global interceptor
5. allow explicit `@Audit(...)` metadata on routes that need stable action names or auditing despite using non-mutating HTTP verbs
6. record denied attempts directly from the authentication and authorization guards so failed privileged requests are not lost before controller execution
7. expose a minimal privileged audit-review endpoint at `GET /audit`

### Consequences

- successful writes, controller/service failures, and denied privileged attempts are now durably attributable even before the later structured-logging work lands
- route authors can opt into clearer action naming and target extraction without reworking the global audit pipeline
- audit storage currently shares the main application database, so later sessions should still harden retention, redaction, export controls, and long-term operational reporting

---

## ADR-013 — Lease-based leader coordination with generation fencing tokens

- Status: accepted
- Session: Session 10 — Add lease-based coordination primitives
- Date: 2026-05-24

### Context

The previous cluster leader model relied on PostgreSQL advisory locks plus `ClusterNode.isLeader` booleans. That left leader intent split across transient session state and durable database state, made recovery paths advisory-lock-specific, and provided no monotonic fencing token that later cluster-wide operations could use to reject stale leaders.

The production-readiness assessment called for a durable lease record with expiration and generation semantics.

### Decision

Adopt a database-backed lease primitive for leader coordination:

1. add a new Prisma-backed `ClusterLease` table with a unique `leaseName`
2. store the current owner, acquisition/renewal timestamps, TTL, and expiry in that table
3. maintain a monotonically increasing `generation` value that acts as the leader fencing token
4. preserve the generation when a lease is released so the next owner observes a higher fencing token
5. make the leader-acquisition path in `DistributedLockService` use the durable lease primitive with automatic renewal
6. expose lease state through the cluster API so operators can inspect the active owner and fencing token

### Consequences

- leader identity is now durably visible in the database instead of existing only in a PostgreSQL session lock
- future cluster-wide writes can carry the leader generation and reject stale actors using the fencing token
- the codebase remains in a transitional hybrid state until Session 11 finishes moving heartbeat and leader reconciliation fully onto the lease model

---

## ADR-014 — Lease-backed heartbeat and leader reconciliation

- Status: accepted
- Session: Session 11 — Move heartbeat and leader flows onto leases
- Date: 2026-05-24

### Context

Session 10 introduced durable `ClusterLease` records and generation-based fencing tokens, but the heartbeat service still treated `ClusterNode.isLeader` as an operational source of truth. That left split-brain recovery logic dependent on stale DB flags and heartbeat recency rather than the current leader lease.

### Decision

Adopt the leader lease as the authoritative source of truth for cluster leadership:

1. derive leader reads, cluster stats, and node leader annotations from the active `cluster:leader` lease
2. treat `ClusterNode.isLeader` as a denormalized observability field only, reconciled from the lease rather than used for leader election
3. when the lease owner is missing or stale, clear denormalized leader flags and wait for lease expiry instead of force-electing a replacement from heartbeat recency
4. simplify admin repair flows so “enforce leader” means reconciling DB flags to the active lease, not choosing a winner from multiple DB leaders

### Consequences

- leadership and membership diagnostics now stay aligned with durable lease ownership instead of transient DB flag drift
- stale-node cleanup no longer performs risky split-brain arbitration; it marks nodes stale and lets lease expiry govern failover timing
- operator-facing leader status can explicitly report lease-owner-missing or lease-owner-not-active states, which were previously hidden behind generic “multiple leaders” logic
- later sessions can layer cluster operations and per-node ACKs onto a cleaner lease-backed control-plane model without preserving the old DB-leader election semantics

---

## ADR-015 — Durable cluster operation journal with per-node acknowledgements

- Status: accepted
- Session: Session 12 — Add cluster operations and per-node ACK tracking
- Date: 2026-05-24

### Context

Sessions 10 and 11 established lease-backed leader coordination, but cluster-wide mutations still returned local-only success. That meant operators could not tell whether a reload or sync had actually converged across the cluster, and later certificate/config rollout work had no durable operation record to build on.

### Decision

Represent cluster-wide mutations as durable operations with explicit per-node acknowledgement state:

1. add new Prisma-backed `ClusterOperation` and `ClusterOperationAck` tables to persist operation intent, status, and per-node outcomes
2. introduce a `ClusterOperationsService` that creates operation records before execution, seeds ACK rows for all targeted nodes, runs local work, and issues authenticated peer calls to collect ACKs
3. change cluster-wide reload requests to return `202 Accepted` with an operation ID instead of a best-effort synchronous broadcast result
4. expose operation inspection endpoints so operators can query current status and per-node ACK details
5. route cluster-triggered certificate sync broadcasts through the same operation journal so later certificate activation work can reuse a consistent contract

### Consequences

- cluster-wide mutations now have durable, queryable status instead of collapsing into local-node success responses
- operators can inspect which nodes succeeded or failed for a given operation before later Session 22 API expansion work lands
- future sessions can layer desired-state versions, certificate activation ACK policies, and richer operational metrics onto the shared operation journal instead of inventing separate tracking paths
- operation execution is still initiated in-process on the requesting node, so restart-resume durability and stronger internal transport guarantees remain future work

---

## ADR-016 — Staged NGINX runtime releases with atomic activation and rollback

- Status: accepted
- Session: Session 13 — Implement staged NGINX config generation and atomic activation
- Date: 2026-05-24

### Context

The previous NGINX reload flow cleared `/etc/nginx` in place, recopied repository assets directly into the live directory, regenerated configs there, and only then ran `nginx -t`. That meant a failed copy, partial write, or invalid generated config could leave a node with a broken or incomplete live NGINX tree before validation had even occurred.

### Decision

Adopt a staged runtime-release model for NGINX virtual-host configuration:

1. keep `/etc/nginx/nginx.conf` as a stable loader that includes `/etc/nginx/runtime/current/conf.d/*.conf`
2. create a full staged release under `/etc/nginx/runtime/releases/<release-id>` for every reload attempt
3. validate the staged release with a release-specific `nginx -t -c <release>/.validation-nginx.conf` before activation
4. activate a validated release by atomically swapping the `current` symlink to the new release
5. preserve a `last-known-good` symlink and automatically roll back to the prior release if `nginx -s reload` fails after activation
6. record release metadata on disk in `lyttle-nginx-release.json`, including release phase, apply node, validation output, and rollback context when applicable
7. bootstrap a runtime `current` and `last-known-good` release at container startup so the stable loader is usable before the first dynamic reload occurs

### Consequences

- invalid generated configs are rejected before they become the active NGINX release
- live config activation no longer depends on destructive in-place mutation of `/etc/nginx`
- operators have a filesystem-local rollback point and release metadata trail even before later sessions add richer config-version APIs or database-backed apply history
- later sessions should build on this model for metrics, operator inspection APIs, certificate artifact activation, and stronger controls around advanced custom NGINX fragments

---

## ADR-017 — Validated allowlisted `nginx_custom_code` fragments

- Status: accepted
- Session: Session 14 — Restrict or redesign `nginx_custom_code`
- Date: 2026-05-24

### Context

Even after Session 13 made NGINX rollout transactional, `ProxyEntry.nginx_custom_code` still flowed straight into generated server blocks as raw text. That left the system open to arbitrary directive injection, unsafe filesystem path materialization through `root` and `alias`, and accidental or malicious syntax that could bypass the intent of the managed proxy template.

### Decision

Keep `nginx_custom_code` as a narrow extensibility surface for now, but replace raw injection with a validated fragment model:

1. parse custom fragments before rollout instead of copying them verbatim into generated config
2. allow only a small server-level directive set (`add_header`, `client_max_body_size`, `expires`) plus `location` blocks
3. allow only reviewed static-content and response-shaping directives inside custom `location` blocks (`root`, `alias`, `try_files`, `index`, `return`, `default_type`, `autoindex`, `add_header`, `expires`, `client_max_body_size`)
4. reject dangerous directives and structures such as nested `server`/`if` blocks, regex locations, `proxy_pass`, `include`, and other arbitrary config escapes
5. require `root` and `alias` paths to stay under an operator-configured allowlist via `NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES`
6. fail the staged reload immediately when a fragment is invalid so unsafe config never reaches `nginx -t`, activation, or directory creation side effects

### Consequences

- advanced per-proxy static-file and response-header customization remains possible without preserving arbitrary server-block injection
- the reloader now treats invalid custom fragments as rollout failures instead of silently ignoring or partially applying them
- future proxy-management APIs in Session 21 should keep building on this validated fragment contract, or replace it with a stricter structured model if operators need richer NGINX extensibility later

---

## ADR-018 — Strict normalized certificate domains and argument-array process execution

- Status: accepted
- Session: Session 15 — Add strict domain validation and safe process execution
- Date: 2026-05-24

### Context

The production-readiness assessment identified two closely related certificate risks:

1. domain input was weakly validated, which left room for malformed FQDNs, wildcard/path confusion, and unsafe filesystem path derivation
2. certificate and TLS workflows still built OpenSSL and certbot commands through shell-interpolated strings, which increased command-injection risk and made argument handling brittle

These problems affected certificate issuance, upload, self-signed generation, TLS inspection helpers, generated NGINX certificate paths, and backup archive naming.

### Decision

Adopt the following certificate-domain and certificate-process policy:

1. normalize certificate-related domains to lowercase ASCII/punycode before use
2. accept only fully-qualified domains; reject local-only names, IPs, path separators, whitespace, and control characters early
3. accept wildcard domains only in the left-most `*.` form, and explicitly reject wildcard issuance in the current built-in ACME flow until DNS-01 support exists
4. derive certificate storage paths from deterministic safe storage identifiers instead of raw domain strings
5. execute OpenSSL, certbot, and NGINX helper commands in the certificate/TLS path through `execFile`-style argument arrays rather than shell-interpolated command strings

### Consequences

- certificate uploads, self-signed generation, TLS inspection, and route-param-based domain workflows now fail fast on malformed input before they reach filesystem or subprocess boundaries
- wildcard certificate issuance remains intentionally unavailable in the current HTTP-01 flow, which makes the limitation explicit until Session 18 lands a wildcard-safe ACME strategy
- generated NGINX certificate paths, local certificate directories, and backup archive paths no longer depend on raw domain text, reducing path-confusion risk
- future certificate lifecycle work should build on the shared normalized-domain utilities and safe process helper instead of reintroducing ad hoc validation or shell command construction

---

## ADR-019 — Durable certificate orders with artifact history and retryable lifecycle state

- Status: accepted
- Session: Session 16 — Add certificate order state machine
- Date: 2026-05-24

### Context

The production-readiness assessment called out that certificate issuance was still modeled mostly as transient process execution plus the final `Certificate` row. That left the system with weak visibility into mid-flight state, poor retry history, and no durable artifact-version trail for later activation/rollback work.

### Decision

Adopt a certificate-order lifecycle model with three persistent record types:

1. `CertificateOrder`
   - captures the workflow intent, normalized domains, source type, current state, attempt counters, retry schedule, and final linked certificate
2. `CertificateOrderEvent`
   - records state transitions and retry/backoff history for each order without relying on ephemeral logs
3. `CertificateArtifactVersion`
   - stores versioned certificate artifacts so future distribution and rollback work can build on stable artifact history instead of only the latest active certificate row

The initial Session 16 state vocabulary is:

- `requested`
- `challenge-published`
- `validating`
- `issued`
- `distributing`
- `activated`
- `failed`
- `revoked`

### Consequences

- ACME issuance, uploaded certificates, and self-signed certificates now create durable workflow records that can be queried through dedicated order APIs instead of being inferred from logs alone
- failed ACME orders now persist retry/backoff history and can be resumed safely through an explicit retry path rather than only by hoping a later scheduled renewal happens to recreate context
- certificate artifact metadata is now versioned, which gives Session 17 a concrete foundation for separating issuance from cluster-wide activation and for adding rollback-aware distribution state
- artifact history currently stores the same PEM material as the existing certificate table, so Session 19 must build encryption-at-rest on top of this new lifecycle model before it is suitable for hardened production key storage

---

## ADR-020 — ACK-backed certificate artifact activation with rollback to prior versions

- Status: accepted
- Session: Session 17 — Rework cluster certificate distribution and activation
- Date: 2026-05-24

### Context

Session 16 introduced durable certificate orders and artifact history, but issuance still looked complete as soon as the leader had PEM material locally. Remote nodes could still be out of date, and there was no explicit artifact-level activation contract or rollback path to a previously known-good version.

### Decision

Separate issuance from activation and make activation an ACK-backed cluster operation:

1. issuance, upload, and self-signed generation now store a `CertificateArtifactVersion` first instead of immediately treating the artifact as the active cluster certificate
2. activating an artifact now runs through the cluster-operation journal so every node returns an explicit success/failure acknowledgement
3. the live `Certificate` row is updated only after the artifact activation operation succeeds across the cluster
4. artifact records now persist rollout metadata (`isCurrent`, `distributionStatus`, `distributionOperationId`, `distributionCompletedAt`) so operators can inspect which version is active and what the latest rollout did
5. failed activation retries should reuse the stored artifact instead of reissuing certificate material
6. rollback should reactivate the prior successful artifact version rather than mutating raw certificate state in place

### Consequences

- a certificate order now becomes `activated` only after the cluster rollout succeeds, not merely after local issuance succeeds
- per-node distribution status is inspectable through the linked cluster operation and exposed on order detail responses
- failed activations leave the previously active certificate row unchanged, preserving a safe rollback target and letting later reconciliation flows restore drifted nodes from the durable active state

---

## ADR-021 — Explicit ACME strategy selection with DB-backed HTTP-01 tracking and DNS-01 hook support

- Status: accepted
- Session: Session 18 — Harden the ACME strategy for clustered production
- Date: 2026-05-24

### Context

By the end of Session 17, certificate activation and rollback were cluster-aware, but the pre-issuance ACME flow still relied on an implicit HTTP-01-only certbot invocation. That left three gaps called out in the production-readiness assessment:

1. wildcard issuance still had no supported path
2. challenge publication / cleanup / finalization was not explicit or inspectable enough for operators
3. the repository had no clear operator-facing contract for when to use shared HTTP challenge serving versus external DNS provider hooks

### Decision

Adopt an explicit ACME strategy layer with the following rules:

1. introduce `ACME_CHALLENGE_STRATEGY` with `auto`, `http-01`, and `dns-01` modes
2. keep the built-in cluster-safe HTTP-01 path for non-wildcard orders by writing challenge state into PostgreSQL and serving it from every node through `/.well-known/acme-challenge/:token`
3. preserve HTTP-01 challenge rows through cleanup/finalization so operators can inspect challenge lifecycle state instead of losing it immediately on cleanup
4. support DNS-01 through operator-supplied manual hook scripts configured by absolute-path env vars (`ACME_DNS_AUTH_HOOK`, `ACME_DNS_CLEANUP_HOOK`) plus an explicit provider label (`ACME_DNS_PROVIDER`)
5. in `auto` mode, resolve wildcard orders to DNS-01 and non-wildcard orders to the built-in HTTP-01 path
6. expose recent built-in HTTP-01 challenge records through an authenticated inspection API (`GET /certificates/challenges`)

### Consequences

- wildcard issuance is now supported when DNS-01 hooks are configured, without weakening the existing safe-domain validation rules
- the built-in HTTP-01 flow remains cluster-safe because any node can serve the shared challenge record, while challenge publication / cleanup / validation state is now queryable afterward
- DNS-01 provider behavior remains intentionally pluggable: the application defines the hook contract and metadata, while provider-specific DNS mutations stay outside the main codebase until a later provider integration session is justified
- future certificate, observability, and operator-API sessions should build on this explicit ACME strategy metadata instead of assuming a single hard-coded HTTP-01 flow
- later sessions can build richer activation policies, operator APIs, and certificate-distribution observability on top of artifact-level rollout state instead of inferring activation from local filesystem writes alone

