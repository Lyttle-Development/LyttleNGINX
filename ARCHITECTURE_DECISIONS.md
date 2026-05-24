# Architecture Decisions Log

Last updated: 2026-05-24

This file records repository-level architectural and delivery decisions so future implementation sessions can build on explicit, reviewable choices.

## How to use this log

- add a new ADR-style entry when a decision changes architecture, delivery shape, verification policy, or operator expectations
- link each decision to the session that introduced it
- mark superseded decisions explicitly instead of deleting history

---

## Decision index

| ID | Title | Status | Session | Date |
| --- | --- | --- | --- | --- |
| ADR-001 | Production-readiness source of truth | accepted | Session 1 | 2026-05-24 |
| ADR-002 | Session-based delivery model | accepted | Session 1 | 2026-05-24 |
| ADR-003 | Standard repository verification contract | accepted | Session 1 | 2026-05-24 |
| ADR-004 | Deployment mode expectations | accepted | Session 1 | 2026-05-24 |
| ADR-005 | Secret material stays out of git | accepted | Session 2 | 2026-05-24 |
| ADR-006 | Authenticated-by-default control-plane API | accepted | Session 3 | 2026-05-24 |
| ADR-007 | Explicit probe endpoints with dependency-aware readiness | accepted | Session 4 | 2026-05-24 |

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

