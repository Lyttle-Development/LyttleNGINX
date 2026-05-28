# Architecture Decisions Log

Last updated: 2026-05-28

This file records the repository-level architecture and delivery decisions that define the current implementation. It replaces the older session-based tracking style with a current-state ADR summary.

## How to use this log

- add a new ADR entry when a decision changes architecture, verification policy, or operator expectations
- prefer updating the current decision summary instead of preserving roadmap-era milestones
- mark superseded decisions explicitly instead of allowing contradictory guidance to accumulate

---

## Decision index

| ID | Title | Status | Date |
| --- | --- | --- | --- |
| ADR-001 | Production-readiness documentation is anchored in current-state docs | accepted | 2026-05-28 |
| ADR-002 | Repository verification is a required release gate | accepted | 2026-05-28 |
| ADR-003 | Deployment expectations remain mode-specific | accepted | 2026-05-28 |
| ADR-004 | Secret material stays out of git and should be injected at runtime | accepted | 2026-05-28 |
| ADR-005 | The control plane is authenticated by default | accepted | 2026-05-28 |
| ADR-006 | Cluster leadership is lease-based and cluster mutations are ACK-tracked | accepted | 2026-05-28 |
| ADR-007 | NGINX rollout is staged, validated, and rollback-aware | accepted | 2026-05-28 |
| ADR-008 | Certificate lifecycle state is durable and rollback-aware | accepted | 2026-05-28 |
| ADR-009 | Built-in ACME support is limited to shared HTTP-01 for non-wildcard issuance | accepted | 2026-05-28 |
| ADR-010 | Private keys and backup artifacts are protected at rest | accepted | 2026-05-28 |
| ADR-011 | Operator visibility relies on structured logs, audit events, health drilldowns, and metrics | accepted | 2026-05-28 |
| ADR-012 | Tests are organized by suite depth and are part of both CI and Docker build verification | accepted | 2026-05-28 |

---

## ADR-001 — Production-readiness documentation is anchored in current-state docs

- Status: accepted
- Date: 2026-05-28

### Decision

Treat the following documents as the canonical description of the shipped system:

1. `README.md`
2. `docs/architecture/current-architecture.md`
3. `FINAL_PRODUCTION_CHECKLIST.md`
4. `PRODUCTION_DEFERMENT_REGISTER.md`
5. `ARCHITECTURE_DECISIONS.md`
6. the operator runbooks under `docs/runbooks/`

Historical implementation-plan and progress-tracker files are no longer part of the active documentation set.

### Consequences

- current docs must describe what is actually shipped
- roadmap-era wording should not be used as the source of truth
- release claims must stay aligned with the checklist and deferment register

---

## ADR-002 — Repository verification is a required release gate

- Status: accepted
- Date: 2026-05-28

### Decision

The required repository verification contract is:

- `npm run prisma:generate`
- `npm run lint:ci`
- `npm run typecheck`
- `npm run test:coverage:ci`
- `npm run build`
- `npm run audit:prod`

This contract is represented by `npm run verify:ci` and must succeed in CI and during the Docker builder stage.

### Consequences

- a Docker image build should fail if the repository verification contract fails
- release publication depends on the same gate set used for CI
- automated tests are part of the default release definition, not an optional extra

---

## ADR-003 — Deployment expectations remain mode-specific

- Status: accepted
- Date: 2026-05-28

### Decision

The project documents three explicit operating modes:

1. local development
2. single-node Compose for evaluation and non-HA use
3. Docker Swarm global mode for controlled clustered rollout

### Consequences

- documentation must distinguish evaluation workflows from hardened rollout guidance
- Compose examples should not be described as the preferred production posture
- Swarm rollout guidance must remain coupled to the checklist and deferment register

---

## ADR-004 — Secret material stays out of git and should be injected at runtime

- Status: accepted
- Date: 2026-05-28

### Decision

- `.env.example` is the only tracked env template
- live env overrides, certificate material, and backup artifacts must remain untracked
- production secrets should be injected through Swarm secrets or an external secret manager

### Consequences

- examples use placeholders only
- docs must keep runtime secret injection explicit
- future secret-provider integration must preserve the rule that secrets do not live in git

---

## ADR-005 — The control plane is authenticated by default

- Status: accepted
- Date: 2026-05-28

### Decision

Admin and internal control-plane routes require authentication unless explicitly marked public. The supported mechanisms remain:

- bearer tokens
- API keys
- internal-node identities

The public allowlist is intentionally narrow and limited to health, metrics, and ACME challenge routes.

### Consequences

- new endpoints should default to protected
- RBAC and audit policy apply across the administrative surface
- public access must remain intentional and documented

---

## ADR-006 — Cluster leadership is lease-based and cluster mutations are ACK-tracked

- Status: accepted
- Date: 2026-05-28

### Decision

- leader ownership is derived from persisted lease state
- cluster-wide mutations are recorded as operations with per-node acknowledgements
- operator visibility is exposed through cluster status, lease, operations, and node-detail APIs

### Consequences

- cluster behavior is observable beyond local-node success responses
- split-brain mitigation depends on lease ownership rather than stale DB leader flags
- inter-node transport hardening remains a separate deferred concern

---

## ADR-007 — NGINX rollout is staged, validated, and rollback-aware

- Status: accepted
- Date: 2026-05-28

### Decision

- config generation produces staged releases
- staged config is validated before activation
- activation swaps runtime pointers atomically
- reload failure triggers rollback to the last-known-good release
- custom NGINX fragments are restricted by allowlisted guardrails

### Consequences

- runtime config rollout is safer than direct in-place mutation
- a dedicated manual rollback API is still deferred
- operator runbooks must document rollback and recovery workflows clearly

---

## ADR-008 — Certificate lifecycle state is durable and rollback-aware

- Status: accepted
- Date: 2026-05-28

### Decision

- certificate orders are durable
- artifact versions are tracked explicitly
- artifact activation is coordinated across the cluster with ACKs
- rollback to a prior artifact version is supported

### Consequences

- certificate workflows survive retries and partial failures more cleanly than file-only flows
- cluster activation state is inspectable
- broader disaster recovery remains partly external to the repository

---

## ADR-009 — Built-in ACME support is limited to shared HTTP-01 for non-wildcard issuance

- Status: accepted
- Date: 2026-05-28

### Decision

The built-in ACME flow supports shared HTTP-01 challenge handling only. Wildcard and DNS-01 issuance are intentionally not part of the shipped design.

### Consequences

- operators needing wildcard issuance must use another strategy such as import/upload workflows
- ACME behavior stays aligned with the current cluster-safe implementation
- docs and validation messages must state this limit explicitly

---

## ADR-010 — Private keys and backup artifacts are protected at rest

- Status: accepted
- Date: 2026-05-28

### Decision

- stored TLS private keys use application-layer envelope encryption metadata
- backup artifacts are encrypted and signed
- raw PEM export remains a break-glass path only

### Consequences

- production secret handling is stronger than plaintext storage
- external KMS, Vault, or HSM integration remains deferred
- restore guidance must emphasize encrypted backup workflows over raw export

---

## ADR-011 — Operator visibility relies on structured logs, audit events, health drilldowns, and metrics

- Status: accepted
- Date: 2026-05-28

### Decision

The primary observability surfaces are:

- structured operational logs
- persisted audit events
- health, dependency, and deep diagnostics endpoints
- Prometheus and JSON metrics

### Consequences

- incident response should start from documented operator APIs rather than direct database inspection where possible
- log redaction and audit persistence remain part of the default operational model
- external monitoring and alert routing are still environment responsibilities

---

## ADR-012 — Tests are organized by suite depth and are part of both CI and Docker build verification

- Status: accepted
- Date: 2026-05-28

### Decision

- tests are classified into `unit`, `integration`, `e2e`, and `chaos`
- the harness fails if discovered tests are unclassified or missing
- CI uses the coverage-gated full suite
- the Docker builder stage runs the same verification contract before producing the runtime image

### Consequences

- test intent is clearer than the old milestone-based layout
- release confidence depends on both repository verification and container build verification
- newly added tests must be intentionally classified and maintained
