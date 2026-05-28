# Final Production Checklist

_Date: 2026-05-28_

## Final disposition

The repository can be treated as ready for a **controlled production rollout of the documented current architecture** once:

1. the repository verification contract stays green,
2. the environment-specific go-live steps below are completed, and
3. the residual gaps in [`PRODUCTION_DEFERMENT_REGISTER.md`](PRODUCTION_DEFERMENT_REGISTER.md) are explicitly accepted.

This remains intentionally narrower than claiming full parity with the ideal long-term target architecture. The largest remaining boundary is that inter-node transport is still authenticated HTTP rather than mTLS.

## Validation evidence

- Toolchain used for repository verification:
  - Node.js `24.16.0`
  - npm `11.15.0`
- Required verification contract:
  - `npm run verify:ci`
- Contract scope:
  - Prisma client generation
  - ESLint CI gate
  - TypeScript typecheck
  - coverage-gated full test suite
  - production build
  - production dependency audit
  - Docker build enforcement through the builder-stage verification step

## Current implementation summary

### Done for the shipped scope

- admin and internal control-plane routes are authenticated by default
- RBAC and durable audit logging are in place
- health, readiness, dependency drilldowns, and structured operational logging are implemented
- lease-backed cluster leadership and per-node ACK-backed operation tracking are implemented
- staged NGINX config rollout with automatic rollback is implemented
- durable certificate orders, artifact history, cluster activation, and rollback are implemented
- shared HTTP-01 ACME challenge handling is implemented for non-wildcard certificates
- private keys are encrypted at rest in PostgreSQL
- encrypted and signed backup artifacts are supported
- unit, integration, e2e, and deterministic chaos suites are wired into the repository verification contract
- release gates cover lint, typecheck, tests, build, dependency audit, and container build/scan flow

### Still deferred or environment-owned

- inter-node mTLS and stronger request-signing/replay protection
- first-class secret-provider integration beyond environment-variable injection
- richer rate limiting and upstream abuse controls
- full PostgreSQL disaster recovery orchestration beyond certificate-state backup flows
- non-root / read-only / capability-reduced container hardening
- SBOM generation and signed provenance
- some broader aspirational admin API surface areas from the assessment

## Manual go-live checklist

The repository is only one part of production readiness. Complete these checks for the target environment.

### Platform and security prerequisites

- [ ] Place node-to-node traffic on a private, trusted control network and explicitly accept the lack of internal mTLS.
- [ ] Inject production secrets through Docker Swarm secrets or an external secret store; do not rely on checked-in placeholder values.
- [ ] Provide strong values for `AUTH_JWT_SECRET`, `API_KEY`, `PRIVATE_KEY_ENCRYPTION_MASTER_KEY`, and `BACKUP_ENCRYPTION_KEY`.
- [ ] Configure GitHub branch protections / required status checks so CI gates are also merge gates.
- [ ] Decide whether the current root-based container runtime posture is acceptable in your environment; if not, complete the remaining container hardening first.

### Data protection and recovery

- [ ] Provision PostgreSQL backups and recovery procedures outside the repository-level certificate backup flow.
- [ ] Validate at least one encrypted backup verify/restore drill with the exact production keys you will use.
- [ ] Define off-node retention and lifecycle policies for encrypted backup artifacts.
- [ ] Document who can execute break-glass certificate export and how that action will be reviewed afterward.

### Observability and operations

- [ ] Wire `GET /metrics` into Prometheus (or equivalent) and configure alert delivery based on `docs/runbooks/monitoring-alerts.md`.
- [ ] Confirm log shipping for structured stdout/stderr output and verify audit-log review procedures.
- [ ] Ensure runbooks are distributed to operators for leader failure, issuance failure, rollback, restore, credential rotation, monitoring alerts, and break-glass actions.
- [ ] Run a pre-go-live smoke test against `/health/live`, `/health/ready`, `/health/dependencies`, `/health/deep`, `/metrics/json`, `/cluster/status`, and `/security/status`.

### Release and change management

- [ ] Keep `npm run verify:ci` green on the exact release candidate commit.
- [ ] Ensure the Docker image build succeeds on the same release candidate commit.
- [ ] Record acceptance of every item in [`PRODUCTION_DEFERMENT_REGISTER.md`](PRODUCTION_DEFERMENT_REGISTER.md).
- [ ] Run a Swarm-environment dress rehearsal covering rolling update, node loss, certificate issuance retry, config rollback, and encrypted restore.
- [ ] Freeze high-risk config/API changes during the initial rollout window.

## Final sign-off statement

If the repository verification contract is green **and** every manual checklist item above is complete **and** the deferment register is explicitly accepted, this codebase can be treated as ready for a controlled production rollout of its current documented architecture.

If your environment requires full internal mTLS, non-root container runtime, richer disaster-recovery orchestration, or the broader aspirational API surface from the assessment, retire the relevant deferments before calling the rollout approved.

