# LyttleNGINX Implementation Plan by Copilot Session

## Purpose

This document converts `PRODUCTION_READINESS_ASSESSMENT.md` into a practical, session-by-session implementation roadmap.

Each session is designed to be:
- focused
- testable
- reviewable
- low-risk
- independently shippable where possible

---

## Working rules for every session

- keep scope tight
- update docs for the touched area
- add or update tests
- avoid unrelated refactors
- finish each session with clear acceptance criteria

---

## Global definition of done

Before this project can be called production-ready, all of the following must be true:

- all mutating APIs are authenticated and authorized
- inter-node traffic is authenticated and integrity-protected
- config deployment is transactional with rollback
- certificate lifecycle is modeled as an auditable state machine
- auto-recovery works under process, container, and node failure
- health probes correctly reflect liveness/readiness/startup state
- secrets and private keys are handled securely
- cluster-wide operations return operation status and node ACKs
- automated tests cover critical flows
- CI blocks insecure or broken releases

---

# Phase 0 — Delivery setup and guardrails

## Session 1 — Delivery scaffolding and progress tracking

### Goal
Create the delivery scaffolding so later sessions are consistent.

### Scope
- add an implementation status tracker
- add an architecture decisions log
- normalize build/lint/test/typecheck scripts
- document local vs single-node vs swarm expectations

### Likely files
- `package.json`
- `README.md`
- new tracking docs

### Deliverables
- `IMPLEMENTATION_STATUS.md`
- `ARCHITECTURE_DECISIONS.md`
- standard repo verification scripts

### Acceptance criteria
- the repo has one place to track status
- common verification commands are defined
- future sessions can follow a stable format

---

## Session 2 — Dependency hygiene and secret-handling cleanup

### Goal
Remove immediate supply-chain and secret risks.

### Scope
- patch vulnerable dependencies found in the assessment
- tighten env examples
- verify sensitive env files are not tracked
- document secret handling via Swarm secrets or external secret stores

### Likely files
- `package.json`
- `package-lock.json`
- `.gitignore`
- `.env.example`
- `README.md`

### Acceptance criteria
- direct CVE findings are addressed
- env examples are safe to publish
- secret handling guidance is explicit

---

# Phase 1 — Emergency hardening and correctness fixes

## Session 3 — Lock down public mutating endpoints

### Goal
Close the immediate P0 security gap where dangerous write endpoints are public.

### Scope
- require auth on all mutating endpoints
- define an explicit public endpoint allowlist
- separate public health/metrics endpoints from admin endpoints
- add tests proving unauthenticated writes fail

### Likely files
- `src/certificate/certificate.controller.ts`
- `src/certificate/tls.controller.ts`
- `src/app.controller.ts`
- auth-related modules/guards

### Acceptance criteria
- all write endpoints reject unauthenticated access
- public probe endpoints remain intentionally public
- tests cover the new access rules

---

## Session 4 — Fix health, readiness, liveness, and startup semantics

### Goal
Make health signaling reliable for orchestration and recovery.

### Scope
- split `/health/live`, `/health/ready`, `/health/startup`
- optionally add `/health/deep`
- readiness must validate DB, NGINX, last successful config apply, and last certificate sync
- make unhealthy readiness return non-200
- update `healthcheck.sh`

### Likely files
- `src/health/health.controller.ts`
- `src/health/health.service.ts`
- `healthcheck.sh`

### Acceptance criteria
- DB outage causes readiness failure
- liveness and readiness are clearly distinct
- Docker/Swarm can act on real unhealthy state

---

## Session 5 — Fix container and process auto-recovery behavior

### Goal
Ensure process failure leads to correct container recovery.

### Scope
- rewrite `docker-entrypoint.sh` failure handling
- remove `exit 0` on error paths
- remove `sleep infinity`
- properly supervise both Node and NGINX
- tune restart policy in compose/swarm files

### Likely files
- `docker-entrypoint.sh`
- `docker-compose.yml`
- `docker-compose.swarm.yml`

### Acceptance criteria
- Node crash causes correct restart behavior
- NGINX crash is restarted or fails the container correctly
- no wedged state blocks auto recovery

---

## Session 6 — Fix inter-node addressing and Swarm communication model

### Goal
Stop relying on incorrect or fragile node discovery.

### Scope
- remove public-IP discovery from cluster comms
- define explicit internal control-plane address + port configuration
- fix assumptions around `PORT`, published port, and container port
- validate registered node addresses

### Likely files
- `src/utils/network-utils.ts`
- `src/distributed-lock/cluster-heartbeat.service.ts`
- `src/distributed-lock/cluster.controller.ts`
- `src/certificate/certificate.service.ts`
- swarm config files

### Acceptance criteria
- inter-node calls do not depend on public internet services
- cluster URLs are built from explicit, reachable internal addresses
- published and internal ports are not conflated

---

# Phase 2 — Security model foundation

## Session 7 — Introduce a real auth foundation

### Goal
Move beyond simple shared API keys and prepare for proper identity.

### Scope
- design request identity model for admins and internal nodes
- introduce JWT/OIDC-compatible auth foundation
- keep temporary compatibility if API keys must remain during migration
- attach actor identity to request context

### Likely files
- `src/auth/*`
- `src/main.ts`
- global guards/interceptors

### Acceptance criteria
- requests carry identity, not just boolean auth
- the codebase is ready for RBAC and audit logging

---

## Session 8 — Add RBAC and authorization policies

### Goal
Control which actors can perform which actions.

### Scope
- define roles such as `viewer`, `operator`, `security-admin`, `platform-admin`, `internal-node`
- add permission decorators and guards
- map all endpoints to permissions

### Likely files
- `src/auth/*`
- controllers across `src/`

### Acceptance criteria
- sensitive actions require appropriate roles
- endpoint permission matrix is explicit and testable

---

## Session 9 — Add audit logging for privileged and mutating operations

### Goal
Make all sensitive actions attributable and reviewable.

### Scope
- add `AuditEvent` model
- log actor, action, target, result, timestamp, correlation ID
- capture successful and failed privileged actions

### Likely files
- `prisma/schema.prisma`
- new migration
- audit/logging services
- write controllers/services

### Acceptance criteria
- all mutating admin operations create audit entries
- failed privileged actions are also captured

---

# Phase 3 — Cluster coordination redesign

## Session 10 — Add lease-based coordination primitives

### Goal
Replace advisory-lock-centric leadership with a durable lease model.

### Scope
- add `ClusterLease` schema/model
- implement lease acquisition, renewal, release
- add generation/fencing token semantics

### Likely files
- `prisma/schema.prisma`
- new migration
- `src/distributed-lock/*`

### Acceptance criteria
- leader identity is lease-based
- stale leaders can be rejected using generation tokens

---

## Session 11 — Move heartbeat and leader flows onto leases

### Goal
Make membership and leadership internally consistent.

### Scope
- refactor heartbeat service to use lease-backed truth
- remove dangerous deadlock recovery assumptions
- improve stale-node handling and diagnostics

### Likely files
- `src/distributed-lock/cluster-heartbeat.service.ts`
- `src/distributed-lock/cluster.controller.ts`

### Acceptance criteria
- leadership state and DB state do not silently diverge
- split-brain recovery logic is simplified and testable

---

## Session 12 — Add cluster operations and per-node ACK tracking

### Goal
Support cluster-aware APIs and tracked asynchronous actions.

### Scope
- add `ClusterOperation`
- add `ClusterOperationAck`
- optionally add desired/applied state version tables
- convert cluster-wide mutations to tracked async operations

### Likely files
- `prisma/schema.prisma`
- new migrations
- cluster/reloader/certificate services and controllers

### Acceptance criteria
- cluster-wide changes return operation IDs instead of local-only success
- each node can ACK success/failure per operation

---

# Phase 4 — Configuration rollout and rollback safety

## Session 13 — Implement staged NGINX config generation and atomic activation

### Goal
Stop destructive config deployment.

### Scope
- generate full config in a staging directory
- validate staged config with `nginx -t`
- atomically activate only validated config
- preserve last-known-good config
- record apply metadata

### Likely files
- `src/reloader/reloader.service.ts`
- `src/nginx/nginx.service.ts`

### Acceptance criteria
- invalid config never replaces active config
- rollback path exists and is testable

---

## Session 14 — Restrict or redesign `nginx_custom_code`

### Goal
Eliminate arbitrary config injection risk while preserving flexibility.

### Scope
- replace raw config injection with allowlisted directives or reviewed advanced fragments
- validate custom config before rollout
- bind advanced access to stricter authorization

### Likely files
- `src/nginx/nginx.service.ts`
- `src/reloader/reloader.service.ts`

### Acceptance criteria
- unsafe config cannot be injected casually
- invalid fragments are rejected before apply

---

# Phase 5 — Certificate lifecycle redesign

## Session 15 — Add strict domain validation and safe process execution

### Goal
Remove injection and path risks in certificate workflows.

### Scope
- add strict domain normalization/validation
- enforce wildcard/punycode/FQDN rules
- replace shell string interpolation with safe process execution helpers using argument arrays
- sanitize filesystem path derivation

### Likely files
- `src/utils/domain-utils.ts`
- certificate DTOs
- `src/certificate/certificate.service.ts`
- `src/certificate/tls-config.service.ts`

### Acceptance criteria
- malicious or malformed domain input is rejected early
- OS command execution does not rely on unsafe shell concatenation

---

## Session 16 — Add certificate order state machine

### Goal
Model issuance as a durable, auditable workflow.

### Scope
- add models such as `CertificateOrder`, `CertificateArtifactVersion`, optionally `CertificateActivation`
- define explicit states: requested, challenge-published, validating, issued, distributing, activated, failed, revoked
- persist retry/backoff history

### Likely files
- `prisma/schema.prisma`
- new migrations
- certificate services/controllers

### Acceptance criteria
- every certificate workflow is queryable and auditable
- mid-flight failures can be resumed or retried safely

---

## Session 17 — Rework cluster certificate distribution and activation

### Goal
Ensure issued certificates are safely propagated across nodes.

### Scope
- separate issuance from activation
- tie activation to cluster operations and ACKs
- track per-node distribution status
- support rollback to prior artifact version

### Likely files
- `src/certificate/certificate.service.ts`
- cluster operation services/controllers

### Acceptance criteria
- certificate completion is not just local leader success
- nodes explicitly ACK activation success/failure

---

## Session 18 — Harden the ACME strategy for clustered production

### Goal
Make certificate issuance robust in global mode.

### Scope
- decide between hardened HTTP-01, DNS-01 support, or an abstraction that allows both
- formalize challenge publication/finalization workflow
- document the provider strategy

### Likely files
- `src/certificate/*`
- ACME hooks/scripts if retained
- deployment docs

### Acceptance criteria
- challenge handling is explicit and testable
- cluster issuance works when any node receives public challenge traffic

---

# Phase 6 — Secrets, backups, and data protection

## Session 19 — Encrypt private key material at rest

### Goal
Protect certificate private keys stored in the database.

### Scope
- add application-layer encryption for private keys
- create an abstraction for Vault/KMS/HSM integration
- store encryption metadata/versioning

### Likely files
- Prisma schema
- certificate storage services
- backup/export code paths

### Acceptance criteria
- private keys are not stored plaintext in the DB
- encryption supports future key rotation

---

## Session 20 — Harden backup, export, import, and restore flows

### Goal
Make backup and recovery production-grade.

### Scope
- encrypt backup artifacts
- add integrity manifests/signatures/checksums
- validate imported/restored content before acceptance
- tighten export permissions and audit coverage

### Likely files
- `src/certificate/certificate-backup.service.ts`
- `src/certificate/backup.controller.ts`
- auth/RBAC/audit wiring

### Acceptance criteria
- backups are encrypted and verifiable
- imports/restores reject invalid or tampered content
- key export/import operations are strictly authorized and audited

---

# Phase 7 — Operational API expansion

## Session 21 — Add proxy management API

### Goal
Manage proxy configuration through the API instead of direct DB mutation.

### Scope
- add CRUD endpoints for proxies
- add validation/test endpoint(s)
- prepare desired-state version hooks

### Likely files
- new proxy controller/service/module or related extensions
- DTOs and validators

### Acceptance criteria
- proxies can be managed through authenticated API endpoints
- invalid upstream/config combinations are rejected before rollout

---

## Session 22 — Add cluster operations and node-status admin APIs

### Goal
Expose the cluster coordination model to operators.

### Scope
- add endpoints for cluster status, operations, node detail, per-node config/cert state
- normalize response contracts for async operations

### Likely files
- `src/distributed-lock/cluster.controller.ts`
- related services/DTOs

### Acceptance criteria
- operators can inspect cluster convergence through the API
- async operations are queryable by operation ID

---

## Session 23 — Add security administration APIs

### Goal
Support operational security tasks safely.

### Scope
- add security status endpoints
- add token/key rotation or bridge flows as applicable
- add internal cert rotation hooks for future mTLS lifecycle
- document break-glass procedures

### Likely files
- auth/security modules
- docs/runbooks
- audit logging integration

### Acceptance criteria
- security maintenance actions are explicit, authorized, and audited

---

# Phase 8 — Logging, metrics, and SRE readiness

## Session 24 — Replace ad hoc logging with structured operational and audit logging

### Goal
Make logs production-usable and safe for centralized collection.

### Scope
- emit structured JSON logs
- add request IDs, node IDs, operation IDs, actor identity
- separate operational logging from audit logging
- remove synchronous local file logging as the primary path
- add secret redaction

### Likely files
- `src/logs/logs.service.ts`
- `src/app.module.ts`
- middleware/interceptors
- audit service

### Acceptance criteria
- logs are machine-parseable and consistent
- sensitive data is redacted
- cluster workflows are traceable end-to-end

---

## Session 25 — Expand metrics and alerting

### Goal
Provide the signals needed to detect and diagnose incidents quickly.

### Scope
- add metrics for leases, cluster operations, config apply, cert orders, backups, DB health
- expose richer dependency health detail
- document recommended alert rules

### Likely files
- `src/metrics/metrics.service.ts`
- `src/metrics/metrics.controller.ts`
- health/cluster/certificate services

### Acceptance criteria
- key workflows emit Prometheus metrics
- failure modes from the assessment are observable

---

# Phase 9 — Test harness and release gates

## Session 26 — Add automated test harness and baseline coverage

### Goal
Create the missing automated test foundation.

### Scope
- add test framework configuration and scripts
- add baseline tests for auth, health, leases, config generation, certificate order transitions

### Likely files
- `package.json`
- test configuration files
- new test files

### Acceptance criteria
- the repo can run unit/integration/e2e tests
- critical new behaviors are covered by tests

---

## Session 27 — Add chaos and fault-injection validation

### Goal
Prove the auto-recovery and coordination claims.

### Scope
- add reproducible tests/scripts for DB outage, leader crash, NGINX crash, bad config apply, node comms failure, partial cert activation failure

### Likely files
- test scripts/harness
- supporting docs

### Acceptance criteria
- major failure modes from the assessment are reproducibly testable
- recovery behavior is demonstrated, not assumed

---

## Session 28 — Upgrade CI/CD and release gating

### Goal
Prevent broken or insecure releases from shipping.

### Scope
- add CI jobs for lint, typecheck, tests, vuln scan, container scan, optionally SBOM generation
- block image push unless verification passes

### Likely files
- `.github/workflows/main.yml`
- supporting configs

### Acceptance criteria
- image publication occurs only after all gates pass
- insecure or broken builds are blocked

---

# Phase 10 — Documentation and final validation

## Session 29 — Reconcile README, architecture docs, and runbooks with reality

### Goal
Make documentation accurate and useful for operators.

### Scope
- update `README.md`
- add/refresh architecture docs
- add runbooks for leader failure, restore, rollback, issuance failure, credential rotation

### Likely files
- `README.md`
- new docs files

### Acceptance criteria
- docs no longer overstate readiness
- operators have documented procedures for high-risk scenarios

---

## Session 30 — Final production-readiness validation pass

### Goal
Perform the final convergence check against the assessment and roadmap.

### Scope
- review remaining gaps against the assessment and this plan
- mark everything done, deferred, or replaced by an accepted alternative
- produce final go-live checklist

### Deliverables
- `FINAL_PRODUCTION_CHECKLIST.md`
- remaining gap/deferment register if needed

### Acceptance criteria
- every assessment item is accounted for
- final release checklist exists

---

# Recommended execution order

## Immediate start order
1. Session 3 — lock down public mutating endpoints
2. Session 4 — fix health semantics
3. Session 5 — fix auto-recovery behavior
4. Session 6 — fix inter-node address/port model
5. Session 2 — patch vulnerable dependencies and clean secret handling

## Then build the foundation
6. Session 7 — auth foundation
7. Session 8 — RBAC
8. Session 9 — audit logging
9. Session 10 — leases
10. Session 11 — heartbeat/leader refactor
11. Session 12 — cluster operations + ACKs

## Then platform safety
12. Session 13 — transactional config apply
13. Session 14 — safe custom NGINX extensibility
14. Session 15 — strict domain validation + safe process execution
15. Session 16 — certificate order state machine
16. Session 17 — certificate distribution/activation ACK flow
17. Session 18 — ACME strategy hardening
18. Session 19 — encrypt private key material
19. Session 20 — secure backup/restore

## Then operability and proof
20. Session 21 — proxy management API
21. Session 22 — cluster operation APIs
22. Session 23 — security admin APIs
23. Session 24 — structured logging
24. Session 25 — advanced metrics/alerts
25. Session 26 — automated test harness
26. Session 27 — chaos/fault tests
27. Session 28 — CI/CD gating
28. Session 29 — docs and runbooks
29. Session 30 — final readiness validation

---

# Suggested first implementation session

## Start with Session 3

Why:
- it closes an immediate P0 risk
- it is relatively small and reviewable
- it reduces exposure while larger architecture work is still pending

### First-session scope
- protect all currently public mutating endpoints
- define the public endpoint allowlist
- add auth tests for those endpoints
- update API docs for the new access rules

### First-session exit criteria
- unauthenticated write/admin actions fail
- public probe endpoints still work intentionally
- tests cover the new behavior

---

# Progress tracking template

Use this format per session:

```markdown
## Session N — <title>
- Status: not started | in progress | done | blocked
- Objective:
- Files touched:
- Tests added/updated:
- Risks:
- Follow-up sessions:
- Notes:
```

---

# Final note

This roadmap is intentionally ordered so we first reduce the biggest risks, then strengthen the architecture, then prove the system through tests and release gates.

The best next step is:

> Start Session 3 and implement the immediate endpoint lockdown and auth-enforcement pass.

