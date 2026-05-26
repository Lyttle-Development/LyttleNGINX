# LyttleNGINX Implementation Status

Last updated: 2026-05-26

This file is the working delivery tracker for the roadmap in `IMPLEMENTATION_PLAN_BY_SESSION.md`.
Use it as the single place to record what has shipped, what is in progress, and what remains.

## Current summary

- Overall status: in progress
- Current phase: Phase 7 — Operational API expansion
- Most recently completed session: Session 21 — Add proxy management API
- Next recommended session from the roadmap: Session 22 — Add cluster operations and node-status admin APIs
- Readiness reference: `PRODUCTION_READINESS_ASSESSMENT.md`
- Architecture decision log: `ARCHITECTURE_DECISIONS.md`

---

## Phase 0 — Delivery setup and guardrails

## Session 1 — Delivery scaffolding and progress tracking

- Status: done
- Objective: create a consistent delivery scaffold for future sessions
- Files touched:
  - `package.json`
  - `README.md`
  - `IMPLEMENTATION_STATUS.md`
  - `ARCHITECTURE_DECISIONS.md`
- Tests added/updated:
  - none yet; Session 26 remains the dedicated test-harness milestone
- Risks:
  - verification scripts are now defined, but this workspace session cannot execute Node/npm commands because the current environment does not have `node` or `npm` installed
  - the `test` script is intentionally a documented placeholder until the automated test harness is introduced
- Follow-up sessions:
  - Session 3 — lock down public mutating endpoints
  - Session 4 — fix health, readiness, liveness, and startup semantics
  - Session 2 — dependency hygiene and secret-handling cleanup
- Notes:
  - added a single status tracker for the roadmap
  - added an architecture decision log for major repo-level choices
  - normalized common verification commands around `lint`, `typecheck`, `build`, and `verify`
  - documented current expectations for local, single-node, and swarm deployment modes in `README.md`

## Session 2 — Dependency hygiene and secret-handling cleanup

- Status: done
- Objective: remove immediate supply-chain and secret risks
- Files touched:
  - `package.json`
  - `package-lock.json`
  - `.gitignore`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
- Tests added/updated:
  - no automated tests yet; Session 26 remains the dedicated test-harness milestone
  - validated direct npm CVE fixes against the upgraded target versions
  - verified via git that only `.env.example` is tracked among env files
- Risks:
  - the application still relies on direct environment-variable injection; first-class `*_FILE` or secret-provider integration remains future work
  - broader automated dependency scanning and release gating remain deferred to Session 28
  - lockfile regeneration could not be performed with npm in this workspace, so the lockfile was updated manually using npm registry metadata for the patched versions
- Follow-up sessions:
  - Session 3 — lock down public mutating endpoints
  - Session 19 — encrypt private key material at rest
  - Session 20 — harden backup, export, import, and restore flows
  - Session 23 — add security administration APIs
  - Session 28 — upgrade CI/CD and release gating
- Notes:
  - upgraded the direct dependency versions called out in the assessment (`@nestjs/core`-aligned Nest packages and `nodemailer`)
  - follow-up maintenance on 2026-05-24 refreshed the full npm package set to the latest available versions, regenerated `package-lock.json`, and pinned the repo toolchain to Node `24.16.0` and npm `11.15.0`
  - tightened `.gitignore` so live env files, generated key material, and backup artifacts stay out of git while keeping `.env.example` tracked
  - rewrote `.env.example` to use safe placeholders and explicit runtime-injection guidance
  - documented Docker Swarm secrets and external secret-manager expectations in `README.md`

---

## Phase 1 — Emergency hardening and correctness fixes

## Session 3 — Lock down public mutating endpoints

- Status: done
- Objective: require auth on all mutating endpoints and define the public allowlist
- Files touched:
  - `package.json`
  - `README.md`
  - `IMPLEMENTATION_STATUS.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `tsconfig.json`
  - `tsconfig.test.json`
  - `src/auth/auth.module.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/decorators/public.decorator.ts`
  - `src/auth/guards/api-key.guard.ts`
  - `src/certificate/acme.controller.ts`
  - `src/health/health.controller.ts`
  - `src/metrics/metrics.controller.ts`
  - `test/session3/auth-lockdown.test.js`
- Tests added/updated:
  - added `test/session3/auth-lockdown.test.js` to prove unauthenticated writes are rejected and explicit public probe endpoints remain reachable
  - wired `npm run test` to execute the Session 3 regression checks with Node's built-in test runner
  - verified the focused access-control test suite passes locally
- Risks:
  - authentication is still API-key based only; Session 7 and Session 8 remain responsible for real identity and RBAC
  - internal node-to-node traffic still shares the same auth mechanism and is not yet mTLS-protected
  - health/readiness semantics are still shallow until Session 4 lands
- Follow-up sessions:
  - Session 4 — fix health, readiness, liveness, and startup semantics
  - Session 7 — introduce a real auth foundation
  - Session 8 — add RBAC and authorization policies
  - Session 26 — expand automated test coverage beyond the current focused regression set
- Notes:
  - admin and internal-control endpoints are now authenticated by default through a global guard
  - the explicit public allowlist is currently limited to health probes, metrics, and the ACME challenge endpoint
  - removed the previous development-mode auth bypass so write endpoints no longer become public when `API_KEY` is unset

## Session 4 — Fix health, readiness, liveness, and startup semantics

- Status: done
- Objective: make health signaling reliable for orchestration and recovery
- Files touched:
  - `README.md`
  - `IMPLEMENTATION_STATUS.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `healthcheck.sh`
  - `src/health/health.controller.ts`
  - `src/health/health.module.ts`
  - `src/health/health.service.ts`
  - `src/reloader/reloader.module.ts`
  - `src/reloader/reloader.service.ts`
  - `src/certificate/certificate.module.ts`
  - `src/certificate/certificate.service.ts`
  - `test/session4/health-semantics.test.js`
- Tests added/updated:
  - added `test/session4/health-semantics.test.js` to verify explicit liveness/startup/readiness routes and their HTTP status semantics
  - validated the focused Session 4 test suite locally with the repository test runner
- Risks:
  - readiness still relies on in-memory timestamps for config apply and certificate sync, so state is reset on process restart until the first successful post-boot operations complete
  - cluster communication health and deeper dependency reporting remain future work for Session 6 and Session 25
- Follow-up sessions:
  - Session 5 — fix container and process auto-recovery behavior
  - Session 6 — fix inter-node addressing and Swarm communication model
  - Session 25 — expand metrics and alerting
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - added explicit `GET /health/live`, `GET /health/startup`, and `GET /health/ready` endpoints while keeping `/health` and `/ready` as compatibility aliases
  - readiness now returns non-200 when PostgreSQL, NGINX master health, recent config apply, or recent certificate sync checks fail
  - `healthcheck.sh` now inspects both the readiness HTTP status and the JSON body instead of trusting status code alone

## Session 5 — Fix container and process auto-recovery behavior

- Status: done
- Objective: ensure process failure leads to correct container recovery
- Files touched:
  - `docker-entrypoint.sh`
  - `docker-compose.yml`
  - `docker-compose.swarm.yml`
  - `README.md`
  - `IMPLEMENTATION_STATUS.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `test/session5/entrypoint-recovery.test.js`
- Tests added/updated:
  - added `test/session5/entrypoint-recovery.test.js` to verify fail-fast supervision for Node and NGINX crashes, graceful signal handling, and restart-policy regressions in the deployment manifests
  - validated the focused Session 5 recovery suite locally with the repository test runner
- Risks:
  - Node and NGINX still share a single container, so this remains shell-based supervision rather than a split control-plane/dataplane architecture or a dedicated supervisor
  - restart behavior now depends on Docker or Swarm policy after container exit; deeper fault-injection proof remains planned for Session 27
- Follow-up sessions:
  - Session 6 — fix inter-node addressing and Swarm communication model
  - Session 13 — implement staged NGINX config generation and atomic activation
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - removed restart-state tracking, `sleep infinity`, and all failure paths that masked crashes with `exit 0`
  - NGINX now runs as a supervised foreground child, and the entrypoint exits non-zero when either supervised process dies unexpectedly
  - the single-node Compose manifest now uses a valid port-mapping configuration instead of the previous conflicting host-network example
  - the Swarm manifest now favors continued recovery by restarting on any exit without a hard `max_attempts` cap and by allowing a graceful stop window

## Session 6 — Fix inter-node addressing and Swarm communication model

- Status: done
- Objective: use explicit internal control-plane addressing instead of fragile discovery assumptions
- Files touched:
  - `src/utils/network-utils.ts`
  - `src/distributed-lock/cluster-heartbeat.service.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `src/certificate/certificate.service.ts`
  - `prisma/schema.prisma`
  - `docker-compose.yml`
  - `docker-compose.swarm.yml`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session6/inter-node-addressing.test.js`
- Tests added/updated:
  - added `test/session6/inter-node-addressing.test.js` to cover explicit control-plane endpoint parsing, peer URL construction, and manifest/documentation regressions
  - verified the focused Session 6 regression suite locally with the repository test runner
  - verified type-checking for the edited TypeScript files after migrating peer URL construction away from `process.env.PORT`
- Risks:
  - the current peer transport is still plain HTTP with shared API keys; mTLS and per-node identity remain future work
  - Swarm hostname reachability is environment-specific, so operators must override `CLUSTER_CONTROL_ADDRESS` where node hostnames are not resolvable or routable on the internal network
  - cluster-wide operations are still best-effort broadcasts without durable ACK tracking until Sessions 10-12
- Follow-up sessions:
  - Session 7 — introduce a real auth foundation
  - Session 10 — add lease-based coordination primitives
  - Session 11 — move heartbeat and leader flows onto leases
  - Session 12 — add cluster operations and per-node ACK tracking
- Notes:
  - removed all public-IP discovery from `src/utils/network-utils.ts` and replaced it with explicit `CLUSTER_CONTROL_ADDRESS` / `CLUSTER_CONTROL_PORT` or `CLUSTER_CONTROL_URL` registration
  - node heartbeats now persist the advertised control-plane endpoint in cluster metadata so operators and peer workflows can inspect what each node registered
  - inter-node reload and certificate-sync broadcasts now build URLs from the registered endpoint instead of assuming the peer-facing port matches the local `PORT`
  - authenticated peer requests now attach the configured API key to certificate sync broadcasts so the Session 3 lockdown does not silently break cluster propagation

---

## Phase 2 — Security model foundation

## Session 7 — Introduce a real auth foundation

- Status: done
- Objective: move from shared API keys toward a real identity model
- Files touched:
  - `src/auth/auth.controller.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/guards/api-key.guard.ts`
  - `src/auth/decorators/current-identity.decorator.ts`
  - `src/auth/interfaces/authenticated-request.interface.ts`
  - `src/auth/types/auth-identity.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session7/auth-foundation.test.js`
- Tests added/updated:
  - added `test/session7/auth-foundation.test.js` to verify structured request identity, bearer-token auth, legacy API-key token exchange, and expired-token rejection
  - validated the focused Session 7 auth suite locally with the repository test runner
  - validated TypeScript type-checking for the edited auth files after introducing bearer-token verification and request identity types
- Risks:
  - bearer-token support is now in place, but endpoint-level authorization policy remains coarse until Session 8 introduces RBAC
  - inter-node traffic can now carry an `internal-node` identity model, but the transport is still plain HTTP and not yet mTLS-protected
  - local token issuance currently uses HS256 shared-secret signing; external IdP/JWKS integration remains future work if operators need full OIDC federation
- Follow-up sessions:
  - Session 8 — add RBAC and authorization policies
  - Session 9 — add audit logging for privileged and mutating operations
  - Session 23 — add security administration APIs
- Notes:
  - the global auth guard now resolves either legacy API keys or JWT bearer tokens and attaches a structured identity object to `request.auth`
  - the identity model distinguishes `admin` and `internal-node` actors and carries roles/scopes so later RBAC and audit work can build on stable request context
  - `POST /auth/token` now provides a migration bridge from API-key clients to short-lived bearer tokens when `AUTH_JWT_SECRET` is configured

## Session 8 — Add RBAC and authorization policies

- Status: done
- Objective: make endpoint permissions explicit and enforceable
- Files touched:
  - `src/auth/auth.module.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/auth.controller.ts`
  - `src/auth/decorators/authorize.decorator.ts`
  - `src/auth/guards/authorization.guard.ts`
  - `src/auth/types/auth-identity.ts`
  - `src/auth/types/auth-role.ts`
  - `src/auth/types/authorization-policy.ts`
  - `src/app.controller.ts`
  - `src/logs/logs.controller.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/backup.controller.ts`
  - `src/certificate/tls.controller.ts`
  - `src/certificate/certificate.module.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session3/auth-lockdown.test.js`
  - `test/session7/auth-foundation.test.js`
  - `test/session8/rbac-authorization.test.js`
- Tests added/updated:
  - added `test/session8/rbac-authorization.test.js` to verify viewer/operator/security-admin/platform-admin/internal-node authorization behavior and role hierarchy
  - updated the Session 3 and Session 7 auth regression harnesses to include the new global authorization guard
  - verified `npm test` passes with the full Session 3-8 regression suite after the RBAC changes landed
- Risks:
  - RBAC is now explicit for the current route surface, but it still relies on bearer-token/API-key claims rather than centralized user/service-account persistence
  - legacy API keys still map to broad admin roles for migration compatibility; Session 23 should narrow rotation and break-glass workflows further
  - internal-node traffic now has a distinct authorization path, but transport security remains HTTP until later mTLS work
- Follow-up sessions:
  - Session 9 — add audit logging for privileged and mutating operations
  - Session 21 — add proxy management API
  - Session 22 — add cluster operations and node-status admin APIs
  - Session 23 — add security administration APIs
- Notes:
  - added a second global guard so protected endpoints must now have an explicit authorization policy in addition to authentication
  - defined the initial role catalog and hierarchy: `viewer`, `operator`, `security-admin`, `platform-admin`, and `internal-node`
  - mapped the current API surface to explicit role requirements and documented that matrix in `README.md`
  - fixed controller registration order so `/certificates/backup` resolves to the intended backup controller instead of being shadowed by `/certificates/:id`

## Session 9 — Add audit logging for privileged and mutating operations

- Status: done
- Objective: make sensitive actions attributable and reviewable
- Files touched:
  - `prisma.config.ts`
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524153000_session9_audit_events/migration.sql`
  - `src/audit/audit.module.ts`
  - `src/audit/audit.controller.ts`
  - `src/audit/audit.interceptor.ts`
  - `src/audit/audit.service.ts`
  - `src/audit/audit-context.ts`
  - `src/audit/audit-record.utils.ts`
  - `src/audit/decorators/audit.decorator.ts`
  - `src/audit/types/audit.types.ts`
  - `src/app.module.ts`
  - `src/app.controller.ts`
  - `src/auth/auth.module.ts`
  - `src/auth/auth.controller.ts`
  - `src/auth/guards/api-key.guard.ts`
  - `src/auth/guards/authorization.guard.ts`
  - `src/auth/interfaces/authenticated-request.interface.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/backup.controller.ts`
  - `src/certificate/certificate-backup.service.ts`
  - `src/certificate/tls.controller.ts`
  - `src/certificate/certificate.service.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `src/logs/logs.controller.ts`
  - `src/prisma/prisma.service.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session9/audit-logging.test.js`
  - `tsconfig.json`
- Tests added/updated:
  - added `test/session9/audit-logging.test.js` to verify successful mutating audit events, denied privileged attempts, controller-level failures, and the new audit review endpoint
  - re-ran the repository test suite so Sessions 3-9 continue to pass together after the new global interceptor and guard changes
  - regenerated the Prisma client after adding the `AuditEvent` model so TypeScript and runtime code resolve the new table correctly
- Risks:
  - audit persistence currently shares the primary application database, so a database outage can still block durable audit writes until later resilience work lands
  - audit retention, redaction, export controls, and long-term reporting remain future work for Sessions 20, 23, and 24
  - audit payloads intentionally avoid request bodies by default, which reduces secret exposure but means some targets are represented by IDs or labels rather than full change diffs
- Follow-up sessions:
  - Session 20 — harden backup, export, import, and restore flows
  - Session 23 — add security administration APIs
  - Session 24 — replace ad hoc logging with structured operational and audit logging
  - Session 28 — upgrade CI/CD and release gating
- Notes:
  - added a Prisma-backed `AuditEvent` model and migration for durable audit persistence
  - introduced a global audit interceptor plus explicit `@Audit(...)` route metadata so all protected mutating routes are audited by default and privileged GET-style maintenance actions can opt in explicitly
  - updated the authentication and authorization guards to record denied attempts before controller execution, closing the gap for failed privileged actions
  - added `GET /audit` for security-admin review workflows and propagated per-request `X-Correlation-Id` headers for audited requests
  - aligned the repo with Prisma 7 generation and typing requirements so the new audit-event schema can be generated and type-checked cleanly in this workspace

---

## Phase 3 — Cluster coordination redesign

## Session 10 — Add lease-based coordination primitives

- Status: done
- Objective: replace advisory-lock-centric leadership with durable leases and fencing tokens
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524161500_session10_cluster_leases/migration.sql`
  - `src/distributed-lock/distributed-lock.service.ts`
  - `src/distributed-lock/cluster-heartbeat.service.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session10/lease-coordination.test.js`
- Tests added/updated:
  - added `test/session10/lease-coordination.test.js` to cover the new lease schema/migration, leader-lease acquisition state, fencing-token validation, and the new cluster lease inspection endpoint
  - regenerated the Prisma client after adding `ClusterLease` so the new delegate and schema types resolve correctly in TypeScript
  - re-ran the repository test suite so Sessions 3-10 continue to pass together after the lease-foundation changes
- Risks:
  - the cluster heartbeat service still maintains transitional `ClusterNode.isLeader` reconciliation until Session 11 completes the full lease-backed leader flow
  - cluster-wide operations do not yet persist operation IDs or per-node ACKs; Session 12 remains responsible for making lease ownership actionable across async workflows
  - inter-node transport is still authenticated HTTP rather than mTLS, so this session improves coordination correctness but not network trust boundaries
- Follow-up sessions:
  - Session 11 — move heartbeat and leader flows onto leases
  - Session 12 — add cluster operations and per-node ACK tracking
  - Session 22 — add cluster operation and node-status admin APIs
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - added a durable `ClusterLease` table with owner, TTL, expiry, and generation-based fencing-token state
  - moved leader acquisition in `DistributedLockService` to lease upsert/renew/release primitives while preserving the existing advisory-lock helper methods for non-leader exclusivity
  - replaced the advisory-lock-specific deadlock recovery path with lease reconciliation so the transitional cluster heartbeat can reason about durable lease ownership before the full Session 11 refactor lands
  - exposed `GET /cluster/lease` and enriched `GET /cluster/leader/status` so operators can inspect current lease owner and fencing-token state

## Session 11 — Move heartbeat and leader flows onto leases

- Status: done
- Objective: align membership and leadership around the new lease model
- Files touched:
  - `src/distributed-lock/distributed-lock.service.ts`
  - `src/distributed-lock/cluster-heartbeat.service.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `test/session11/lease-backed-heartbeat.test.js`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
- Tests added/updated:
  - added `test/session11/lease-backed-heartbeat.test.js` to verify lease-derived leader reads, stale lease-owner handling, lease-only leader election, and stale-node cleanup behavior
  - re-ran the focused Session 11 regression suite and the repository test suite so Sessions 3-11 continue to pass together after the lease-backed refactor
  - validated the edited cluster coordination files with `npm run typecheck` and `npm run build` after removing the remaining generated-client dependency from lease snapshot reads
- Risks:
  - `ClusterNode.isLeader` is still retained as a denormalized observability field for compatibility, so later sessions should continue reducing reliance on legacy node flags in any new APIs
  - cluster-wide mutating workflows still do not persist operation IDs or per-node ACKs; Session 12 remains responsible for making lease ownership actionable across async workflows
  - inter-node transport is still authenticated HTTP rather than mTLS, so this session improves coordination correctness but not network trust boundaries
- Follow-up sessions:
  - Session 12 — add cluster operations and per-node ACK tracking
  - Session 22 — add cluster operation and node-status admin APIs
  - Session 24 — replace ad hoc logging with structured operational and audit logging
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - heartbeat updates, leader reads, and cluster stats now derive leadership from the active leader lease instead of choosing a leader from `ClusterNode.isLeader` flags
  - stale-node cleanup now marks nodes stale and clears denormalized leader flags, but it waits for lease expiry instead of force-electing a replacement from heartbeat recency
  - the cluster leader status endpoint now surfaces lease-owner-missing and lease-owner-not-active states explicitly so leadership drift is diagnosable without relying on split-brain heuristics

## Session 12 — Add cluster operations and per-node ACK tracking

- Status: done
- Objective: represent cluster-wide mutations as tracked async operations
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524182000_session12_cluster_operations/migration.sql`
  - `src/distributed-lock/cluster-operations.service.ts`
  - `src/distributed-lock/cluster.controller.ts`
  - `src/distributed-lock/distributed-lock.module.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/certificate.service.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session6/inter-node-addressing.test.js`
  - `test/session8/rbac-authorization.test.js`
  - `test/session9/audit-logging.test.js`
  - `test/session12/cluster-operations.test.js`
- Tests added/updated:
  - added `test/session12/cluster-operations.test.js` to verify successful cluster-wide operation tracking and remote ACK failure handling when peer auth is unavailable
  - updated the Session 6 regression to assert peer URL construction now lives in the new cluster-operations layer instead of the controller directly
  - updated Session 8 and Session 9 controller harnesses so `ClusterController` still instantiates with the new cluster-operations dependency
  - re-ran `npm test`, `npm run typecheck`, and `npm run build` after regenerating the Prisma client for the new operation models
- Risks:
  - cluster operations are now durable and queryable, but execution is still process-local in-memory orchestration, so restart-resume semantics remain future work
  - remote node ACKs still rely on authenticated HTTP responses rather than mTLS-backed service identity or a separate ACK callback channel
  - only the current reload and certificate-sync workflows use the operation journal so far; additional cluster-wide mutations still need to adopt the same contract in later sessions
- Follow-up sessions:
  - Session 13 — implement staged NGINX config generation and atomic activation
  - Session 17 — rework cluster certificate distribution and activation
  - Session 22 — add cluster operations and node-status admin APIs
  - Session 25 — expand metrics and alerting
- Notes:
  - added durable `ClusterOperation` and `ClusterOperationAck` tables so cluster-wide mutations can be tracked independently from lease state
  - introduced `ClusterOperationsService` to create operation records, pre-register per-node ACK rows, execute local and remote work, and summarize final success/partial-failure state
  - changed `POST /cluster/reload` to return `202 Accepted` with an operation ID and added `GET /cluster/operations` plus `GET /cluster/operations/:operationId` for inspection
  - updated cluster-triggered certificate sync broadcasts to use the same operation journal, and the per-node sync endpoint now returns HTTP 500 for tracked failures so remote ACK state is accurate

---

## Phase 4 — Configuration rollout and rollback safety

## Session 13 — Implement staged NGINX config generation and atomic activation

- Status: done
- Objective: make config rollout transactional and rollbackable
- Files touched:
  - `src/reloader/reloader.service.ts`
  - `src/nginx/nginx.service.ts`
  - `nginx/nginx.conf`
  - `nginx/conf.d/default.conf`
  - `docker-entrypoint.sh`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session13/transactional-nginx-rollout.test.js`
- Tests added/updated:
  - added `test/session13/transactional-nginx-rollout.test.js` to verify staged release validation, atomic `current` symlink activation, rollback to the prior release on reload failure, and the bootstrap runtime layout wiring
  - re-ran `npm test`, `npm run typecheck`, and `npm run build` after the staged rollout changes landed
- Risks:
  - the stable loader currently swaps only the managed virtual-host release path; broader NGINX extensibility such as `nginx_custom_code` still remains unsafe until Session 14 narrows or redesigns that surface
  - release metadata is currently filesystem-backed inside the container/runtime volume rather than persisted in PostgreSQL, so operators must retain the runtime state directory to preserve local rollout history across node replacement
  - certificate and TLS asset paths are still live-system paths outside the staged release tree, so later certificate-hardening sessions must keep config rollout and certificate artifact activation coordinated
- Follow-up sessions:
  - Session 14 — restrict or redesign `nginx_custom_code`
  - Session 17 — rework cluster certificate distribution and activation
  - Session 25 — expand metrics and alerting
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - reloader deployments now create full staged releases under `/etc/nginx/runtime/releases/<release-id>` instead of clearing `/etc/nginx` in place
  - each staged release is validated with a release-specific `nginx -t` config before activation, and activation now swaps the `current` release symlink atomically
  - the runtime keeps both `current` and `last-known-good` symlinks, and failed reloads automatically roll back to the previous release before returning an error
  - each release writes `lyttle-nginx-release.json` metadata with phase, node, validation output, and rollback details so apply state is inspectable on disk

## Session 14 — Restrict or redesign `nginx_custom_code`

- Status: done
- Objective: remove arbitrary config injection risk while preserving advanced extensibility
- Files touched:
  - `src/nginx/nginx-custom-code.ts`
  - `src/nginx/nginx.service.ts`
  - `src/reloader/reloader.service.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session14/nginx-custom-code-guardrails.test.js`
- Tests added/updated:
  - added `test/session14/nginx-custom-code-guardrails.test.js` to verify allowlisted custom fragments render successfully, dangerous directives are rejected, path-prefix enforcement works, and invalid fragments fail reloads before activation
  - re-ran `npm test`, `npm run typecheck`, and `npm run build` after landing the guarded fragment parser so Sessions 3-14 continue to pass together
- Risks:
  - `nginx_custom_code` is now constrained to a narrow allowlist, so operators who relied on arbitrary directives will need to move to the reviewed fragment subset or wait for a future structured extensibility model
  - proxy management still occurs outside a dedicated API surface today; Session 21 remains responsible for shipping authenticated CRUD and validation workflows around proxy state instead of direct database mutation
- Follow-up sessions:
  - Session 15 — add strict domain validation and safe process execution
  - Session 21 — add proxy management API
  - Session 29 — reconcile README, architecture docs, and runbooks with reality
- Notes:
  - raw `nginx_custom_code` injection has been replaced with a validated fragment parser that only accepts reviewed server-level directives and `location` blocks
  - `root` and `alias` paths now must stay within `NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES`, and directory creation derives from the validated fragment AST instead of regex extraction from raw text
  - invalid custom fragments now fail the staged reload immediately, preventing unsafe or unsupported config from reaching `nginx -t`, activation, or side-effectful directory creation

---

## Phase 5 — Certificate lifecycle redesign

## Session 15 — Add strict domain validation and safe process execution

- Status: done
- Objective: reject malformed domains early and stop using unsafe shell interpolation
- Files touched:
  - `src/utils/domain-utils.ts`
  - `src/utils/process-utils.ts`
  - `src/utils/pipes/normalized-domain.pipe.ts`
  - `src/certificate/dto/domain-list.decorator.ts`
  - `src/certificate/dto/generate-self-signed.dto.ts`
  - `src/certificate/dto/upload-certificate.dto.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/tls.controller.ts`
  - `src/certificate/certificate.service.ts`
  - `src/certificate/tls-config.service.ts`
  - `src/certificate/certificate-backup.service.ts`
  - `src/certificate/certificate-monitor.service.ts`
  - `src/certificate/certificate-cleanup.service.ts`
  - `src/nginx/nginx.service.ts`
  - `src/reloader/reloader.service.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session15/domain-validation-and-safe-process.test.js`
- Tests added/updated:
  - added `test/session15/domain-validation-and-safe-process.test.js` to verify strict FQDN normalization, malformed-domain rejection, wildcard HTTP-01 issuance rejection, safe OpenSSL argument execution, and safe certificate storage names in generated NGINX config
  - ran `npm run typecheck`, `npm test`, and `npm run build` successfully after landing the domain-validation and process-execution changes
  - ran `npm run lint`; the repo-wide lint command still reports pre-existing unrelated formatting debt in untouched files, but the Session 15 files were cleaned up and do not block typecheck/build/test verification
- Risks:
  - wildcard issuance remains intentionally blocked until Session 18 introduces DNS-01 or another wildcard-safe ACME strategy
  - certificate lifecycle durability, retry journaling, and resumable issuance state are still pending Session 16 and Session 17
  - private keys and backup artifacts are still not encrypted at rest; Session 19 and Session 20 remain responsible for that hardening
- Follow-up sessions:
  - Session 16 — add certificate order state machine
  - Session 17 — rework cluster certificate distribution and activation
  - Session 18 — harden the ACME strategy for clustered production
  - Session 19 — encrypt private key material at rest
  - Session 20 — harden backup, export, import, and restore flows
  - Session 26 — expand automated regression coverage further
- Notes:
  - domain handling now enforces lowercase normalized FQDNs with punycode conversion, explicit wildcard rules, and early rejection of path separators, whitespace, control characters, and IP addresses
  - certificate storage directories now derive from safe deterministic storage IDs instead of raw domain strings, preventing wildcard/path characters from leaking into filesystem layout or generated NGINX certificate paths
  - OpenSSL, certbot, and NGINX invocations in the certificate and TLS flows now use argument arrays via a shared `execFile`-based helper instead of shell-interpolated command strings
  - route params and certificate DTO domain arrays are validated and normalized before the certificate services run, reducing the chance of malformed input reaching DNS lookups, certbot, OpenSSL, or archive generation

## Session 16 — Add certificate order state machine

- Status: done
- Objective: model certificate issuance as a durable workflow
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524191500_session16_certificate_orders/migration.sql`
  - `src/certificate/certificate-order.constants.ts`
  - `src/certificate/certificate-order.service.ts`
  - `src/certificate/dto/certificate-order.dto.ts`
  - `src/certificate/certificate.service.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/certificate.module.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session15/domain-validation-and-safe-process.test.js`
  - `test/session16/certificate-order-state-machine.test.js`
- Tests added/updated:
  - added `test/session16/certificate-order-state-machine.test.js` to verify durable self-signed order history, artifact-version tracking, failed ACME order persistence, and manual retry/resume behavior
  - updated the Session 15 certificate-service harness for the new order-service dependency
  - ran `npm run prisma:generate`, `npm run typecheck`, the focused Session 16 regression, the full `npm test` suite, and `npm run build` successfully after landing the new workflow models and APIs
- Risks:
  - order activation is still local-first and immediate; Session 17 remains responsible for separating issuance from cluster-wide distribution and ACK-driven activation
  - uploaded/imported orders are queryable but not automatically retryable because replaying those workflows safely still requires operator-supplied certificate material and later restore hardening
  - certificate artifact versions currently store plaintext PEMs alongside the existing certificate table, so Session 19 remains responsible for encryption-at-rest before this history is suitable for production key storage
- Follow-up sessions:
  - Session 17 — rework cluster certificate distribution and activation
  - Session 18 — harden the ACME strategy for clustered production
  - Session 19 — encrypt private key material at rest
  - Session 25 — expand metrics and alerting
- Notes:
  - added durable `CertificateOrder`, `CertificateOrderEvent`, and `CertificateArtifactVersion` models so certificate workflows now persist their lifecycle, retry/backoff history, and artifact-version metadata
  - ACME issuance, uploaded certificates, and self-signed certificates now create order records and transition through explicit lifecycle states instead of relying only on ephemeral logs and the final `Certificate` row
  - failed ACME issuance now records per-order retry scheduling, and operators can inspect or manually retry orders through the new `GET /certificates/orders`, `GET /certificates/orders/:id`, and `POST /certificates/orders/:id/retry` APIs
  - order read APIs intentionally omit raw PEM payloads even though artifact history is now persisted, keeping lifecycle observability separate from private-key export flows

## Session 17 — Rework cluster certificate distribution and activation

- Status: done
- Objective: separate issuance from activation and track per-node rollout state
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524200000_session17_certificate_distribution_activation/migration.sql`
  - `src/distributed-lock/cluster-operations.service.ts`
  - `src/certificate/certificate-order.service.ts`
  - `src/certificate/dto/certificate-order.dto.ts`
  - `src/certificate/certificate.service.ts`
  - `src/certificate/certificate.controller.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session15/domain-validation-and-safe-process.test.js`
  - `test/session16/certificate-order-state-machine.test.js`
  - `test/session17/certificate-distribution-and-rollback.test.js`
- Tests added/updated:
  - added `test/session17/certificate-distribution-and-rollback.test.js` to verify failed rollout retries reuse stored artifacts and rollback reactivates the prior successful artifact version
  - updated the Session 15 and Session 16 certificate harnesses so they cover the new activation-time certificate validation and NGINX reload steps
  - ran `npm run prisma:generate`, `npm run typecheck`, the focused Session 15-17 certificate suites, the full `npm test` suite, and `npm run build` successfully after landing the new rollout flow
- Risks:
  - cluster artifact activation now waits for node ACKs, but peer transport is still authenticated HTTP rather than mTLS-backed service identity
  - artifact rollout state is durable, but rollback and retry visibility is still routed through certificate-order detail plus the cluster-operation journal; richer operator-focused cluster/certificate views remain future work for Session 22
  - activation failure recovery currently relies on retrying the stored artifact and on the existing active certificate row for safe rollback; broader fault-injection proof remains planned for Session 27
- Follow-up sessions:
  - Session 18 — harden the ACME strategy for clustered production
  - Session 22 — add cluster operations and node-status admin APIs
  - Session 25 — expand metrics and alerting
  - Session 27 — add chaos and fault-injection validation
- Notes:
  - issuance, upload, and self-signed generation now create durable certificate artifacts first and only update the live `Certificate` row after the artifact has been ACKed across the cluster
  - certificate artifacts now persist rollout metadata (`isCurrent`, `distributionStatus`, `distributionOperationId`, `distributionCompletedAt`) and order detail responses surface the latest distribution ACK summary
  - failed activation retries now reuse the existing artifact instead of reissuing certificate material, reducing unnecessary issuance churn and preserving rollback targets
  - added admin rollback support that reactivates the prior successful artifact version through the same cluster operation + ACK path used for forward activation

## Session 18 — Harden the ACME strategy for clustered production

- Status: done
- Objective: make challenge handling explicit, durable, and cluster-safe
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260524213000_session18_acme_strategy_hardening/migration.sql`
  - `Dockerfile`
  - `src/certificate/acme-strategy.ts`
  - `src/certificate/acme.service.ts`
  - `src/certificate/acme.controller.ts`
  - `src/certificate/certificate.controller.ts`
  - `src/certificate/certificate.service.ts`
  - `src/certificate/dto/acme-challenge.dto.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session15/domain-validation-and-safe-process.test.js`
  - `test/session18/acme-strategy-hardening.test.js`
- Tests added/updated:
  - added `test/session18/acme-strategy-hardening.test.js` to verify Nest-managed ACME strategy resolution, production-hardened HTTP-01 behavior, explicit wildcard/DNS rejection, challenge inspection delegation, and challenge-serving lifecycle behavior
  - updated the Session 15 wildcard regression so it now asserts wildcard ACME requests are rejected because the hardened flow must not require DNS TXT changes
  - updated the Session 16 and Session 17 harnesses for the new in-app ACME service dependency and re-ran the focused Session 3 / 15 / 16 / 17 / 18 suites locally after the refactor
- Risks:
  - the validated Session 18 flow is intentionally limited to non-wildcard certificates so clustered issuance stays production-safe without operator DNS TXT changes
  - built-in challenge inspection now focuses on shared HTTP-01 publication / cleanup / validation state; richer per-order observability and operator workflows remain future work
  - private keys and artifact history are still stored plaintext until Session 19 lands encryption-at-rest
- Follow-up sessions:
  - Session 19 — encrypt private key material at rest
  - Session 20 — harden backup, export, import, and restore flows
  - Session 22 — add cluster operations and node-status admin APIs
  - Session 25 — expand metrics and alerting
  - Session 29 — reconcile README, architecture docs, and runbooks with reality
- Notes:
  - replaced the prior shell-hook/certbot orchestration path with a Nest-managed `AcmeService` built on `acme-client`, so the hardened HTTP-01 challenge lifecycle now stays inside the application
  - the built-in HTTP-01 flow stores publication, cleanup, expiry, and finalization state in `AcmeChallenge`, and operators can inspect recent challenge rows through `GET /certificates/challenges`
  - wildcard orders are now rejected explicitly because the production-hardened Session 18 scope requires cluster-safe issuance without any DNS TXT record changes
  - the runtime now persists the ACME account key under `ACME_ACCOUNT_PRIVATE_KEY_PATH` instead of depending on external certbot account state and hook scripts

---

## Phase 6 — Secrets, backups, and data protection

## Session 19 — Encrypt private key material at rest

- Status: done
- Objective: protect private keys in storage with application-layer encryption
- Files touched:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260526202000_session19_private_key_encryption/migration.sql`
  - `src/certificate/private-key-encryption.service.ts`
  - `src/certificate/certificate.module.ts`
  - `src/certificate/certificate-order.service.ts`
  - `src/certificate/certificate.service.ts`
  - `src/certificate/certificate-backup.service.ts`
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session19/private-key-encryption-at-rest.test.js`
- Tests added/updated:
  - added `test/session19/private-key-encryption-at-rest.test.js` to verify legacy-plaintext backfill, key-version re-encryption, encrypted artifact/certificate storage, and decrypted export behavior
  - ran the focused Session 19 regression with the repository's Node test runner and `ts-node/register/transpile-only`
  - ran `npm run typecheck` after wiring the new encryption service through certificate issuance, activation, sync, and backup flows
- Risks:
  - backup ZIP files and explicit certificate-export responses still contain decrypted PEM material today; Session 20 remains responsible for encrypting artifacts and adding integrity validation around backup/restore flows
  - the shipped provider abstraction currently implements only the local master-key envelope backend, so operator-facing Vault/KMS/HSM integrations and rotation APIs remain future work for Session 23
  - production deployments must now supply `PRIVATE_KEY_ENCRYPTION_MASTER_KEY`; the development/test fallback should not be used for hardened environments
- Follow-up sessions:
  - Session 20 — harden backup, export, import, and restore flows
  - Session 23 — add security administration APIs
  - Session 29 — reconcile README, architecture docs, and runbooks with reality
- Notes:
  - certificate private keys are now envelope-encrypted before persistence in both `Certificate` and `CertificateArtifactVersion`, with per-record `keyEncryption` metadata that stores scheme/provider/key-version details for future rotation
  - startup now migrates legacy plaintext private keys already present in the database and re-encrypts stored material when `PRIVATE_KEY_ENCRYPTION_KEY_VERSION` changes
  - certificate sync, activation, backup, import, and export paths now decrypt private keys only at the moment they are needed instead of assuming the database returns plaintext PEMs

## Session 20 — Harden backup, export, import, and restore flows

- Status: done
- Objective: make backup and recovery flows encrypted, validated, and authorized
- Files touched:
  - `.env.example`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `src/certificate/certificate-backup.service.ts`
  - `src/certificate/backup.controller.ts`
  - `src/certificate/dto/import-certificates.dto.ts`
  - `test/session8/rbac-authorization.test.js`
  - `test/session9/audit-logging.test.js`
  - `test/session19/private-key-encryption-at-rest.test.js`
  - `test/session20/backup-hardening.test.js`
- Tests added/updated:
  - added `test/session20/backup-hardening.test.js` to verify encrypted backup creation, signed-manifest verification, tamper rejection, server-side restore, and mismatched-key import rejection
  - updated the Session 8 RBAC regression so raw certificate export now requires `platform-admin` while `security-admin` retains encrypted backup/import/restore access
  - updated the Session 9 audit regression so denied raw certificate export attempts are recorded as audited authorization failures
  - updated the Session 19 private-key regression fixtures to use valid certificate material now that Session 20 import validation rejects malformed placeholder PEMs
  - ran the focused Session 8/9/19/20 regression suites plus `npm run typecheck`, `npm test`, and `npm run build` after landing the backup hardening changes
- Risks:
  - the current backup envelope uses a locally configured symmetric key and HMAC signature; external KMS/Vault/HSM-backed backup-key custody and rotation workflows remain future work for Session 23
  - restore currently recreates active certificate rows but does not yet rebuild higher-level order/artifact history from older backups, so operators should still treat backup restore as certificate-state recovery rather than full workflow replay
  - legacy plaintext `.zip` backups remain downloadable for backward compatibility, but the hardened verify/restore flow intentionally refuses to trust or import them
- Follow-up sessions:
  - Session 23 — add security administration APIs
  - Session 27 — add chaos and fault-injection validation
  - Session 29 — reconcile README, architecture docs, and runbooks with reality
- Notes:
  - backups are now written as encrypted `.lyttlebackup` artifacts with a signed manifest and per-entry SHA-256 checksums instead of plaintext ZIP archives
  - added `POST /certificates/backup/:filename/verify` and `POST /certificates/backup/:filename/restore` so operators can verify and restore encrypted backups server-side without manual plaintext extraction
  - direct import now validates PEM structure, key/certificate matching, SAN/CN domain coverage, and validity-window consistency before accepting certificate material
  - raw `GET /certificates/backup/export/:id` remains available as a break-glass flow but is now restricted to `platform-admin` and continues to be audited explicitly

---

## Phase 7 — Operational API expansion

## Session 21 — Add proxy management API

- Status: done
- Objective: manage proxy config through authenticated API endpoints instead of direct DB mutation
- Files touched:
  - `src/app.module.ts`
  - `src/proxy/proxy.module.ts`
  - `src/proxy/proxy.controller.ts`
  - `src/proxy/proxy.service.ts`
  - `src/proxy/dto/create-proxy-entry.dto.ts`
  - `src/proxy/dto/update-proxy-entry.dto.ts`
  - `README.md`
  - `ARCHITECTURE_DECISIONS.md`
  - `IMPLEMENTATION_STATUS.md`
  - `test/session21/proxy-management-api.test.js`
- Tests added/updated:
  - added `test/session21/proxy-management-api.test.js` to verify authenticated proxy CRUD access rules, validation-first create/update behavior, duplicate-domain rejection, stored/draft validation endpoints, and upstream-resolution diagnostics
  - validated the focused Session 21 regression locally together with repository type-check/build verification after wiring the new module into `AppModule`
- Risks:
  - proxy changes now surface a `reloadRequired` desired-state hook, but they still rely on operators or later orchestration to trigger the existing cluster reload flow explicitly
  - proxy ownership conflict checks currently protect direct and wildcard-overlap domain collisions, but broader rollout-policy/versioning semantics remain future work for Session 22 and Session 25
- Follow-up sessions:
  - Session 22 — add cluster operations and node-status admin APIs
  - Session 24 — replace ad hoc logging with structured operational and audit logging
  - Session 25 — expand metrics and alerting
  - Session 26 — add automated test harness and baseline coverage
- Notes:
  - added `GET /proxies`, `GET /proxies/:id`, `POST /proxies`, `PATCH /proxies/:id`, and `DELETE /proxies/:id` with explicit RBAC (`viewer` for reads, `platform-admin` for config mutations)
  - added `POST /proxies/validate`, `POST /proxies/:id/validate`, and `POST /proxies/:id/test-upstream` so operators can validate proxy payloads and inspect upstream reachability before rollout
  - proxy writes now validate domains, upstream target shape, guarded custom NGINX fragments, and conflicting domain ownership before persistence, reducing the chance of invalid config entering the desired state store
  - mutating responses now include a lightweight `configChange` hint that points operators to `/cluster/reload` until later sessions add fuller desired-state versioning and rollout APIs

## Session 22 — Add cluster operations and node-status admin APIs

- Status: not started
- Objective: expose cluster coordination state through operator-facing APIs
- Files touched: none yet
- Tests added/updated: none yet
- Risks: operators cannot yet inspect convergence or operation state through the API
- Follow-up sessions: Session 24, Session 25, Session 26
- Notes: async operation response contracts remain to be defined

## Session 23 — Add security administration APIs

- Status: not started
- Objective: support operational security maintenance safely and audibly
- Files touched: none yet
- Tests added/updated: none yet
- Risks: key rotation and security maintenance flows are not yet explicit
- Follow-up sessions: Session 29
- Notes: break-glass documentation should land here or alongside it

---

## Phase 8 — Logging, metrics, and SRE readiness

## Session 24 — Replace ad hoc logging with structured operational and audit logging

- Status: not started
- Objective: make logs machine-parseable, traceable, and safe for centralized collection
- Files touched: none yet
- Tests added/updated: none yet
- Risks: current logging is not production-grade and may expose sensitive data
- Follow-up sessions: Session 25, Session 28
- Notes: request IDs and redaction remain open

## Session 25 — Expand metrics and alerting

- Status: not started
- Objective: add observability for leases, config apply, cert orders, backups, and DB health
- Files touched: none yet
- Tests added/updated: none yet
- Risks: major failure modes are still under-instrumented
- Follow-up sessions: Session 27, Session 29
- Notes: should align with the health endpoint redesign

---

## Phase 9 — Test harness and release gates

## Session 26 — Add automated test harness and baseline coverage

- Status: not started
- Objective: create unit, integration, and e2e test foundations for critical flows
- Files touched: none yet
- Tests added/updated: none yet
- Risks: the repository still lacks automated regression protection
- Follow-up sessions: Session 27, Session 28
- Notes: this session will replace the current `test` placeholder with a real harness

## Session 27 — Add chaos and fault-injection validation

- Status: not started
- Objective: prove recovery and coordination claims with reproducible failure tests
- Files touched: none yet
- Tests added/updated: none yet
- Risks: auto-recovery claims remain unproven without fault-injection coverage
- Follow-up sessions: Session 30
- Notes: should cover DB outage, leader crash, NGINX crash, bad config, and node comms failure

## Session 28 — Upgrade CI/CD and release gating

- Status: not started
- Objective: block insecure or broken releases from shipping
- Files touched: none yet
- Tests added/updated: none yet
- Risks: current CI only builds and pushes an image
- Follow-up sessions: Session 30
- Notes: lint, typecheck, tests, vulnerability scans, and image gating remain open

---

## Phase 10 — Documentation and final validation

## Session 29 — Reconcile README, architecture docs, and runbooks with reality

- Status: not started
- Objective: make operator-facing documentation accurate and practical
- Files touched: none yet
- Tests added/updated: none yet
- Risks: docs still overstate readiness in several areas
- Follow-up sessions: Session 30
- Notes: runbooks for leader failure, rollback, restore, issuance failure, and credential rotation remain open

## Session 30 — Final production-readiness validation pass

- Status: not started
- Objective: reconcile the assessment, roadmap, and shipped implementation into a final go-live checklist
- Files touched: none yet
- Tests added/updated: none yet
- Risks: production-readiness cannot be claimed until every assessment item is accounted for
- Follow-up sessions: none
- Notes: final checklist and deferment register remain to be created
