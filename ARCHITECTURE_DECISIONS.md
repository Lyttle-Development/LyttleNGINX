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

