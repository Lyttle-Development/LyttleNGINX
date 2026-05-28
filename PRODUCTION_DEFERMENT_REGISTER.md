# Production Deferment Register

_Date: 2026-05-28_

This register captures residual gaps that Session 30 intentionally leaves visible instead of silently absorbing into a broad "production-ready" label.

A rollout owner should review every item here and explicitly decide whether the current compensating controls are acceptable for the target environment.

| ID | Area | Assessment linkage | Current state | Compensating controls / why rollout can still be acceptable | Recommended follow-up |
| --- | --- | --- | --- | --- | --- |
| `D-001` | Internal node transport hardening | `1.3`, `2.1`, `7` | Node-to-node traffic is still authenticated HTTP, not mTLS. | Internal-node identities, RBAC, explicit control-plane addressing, per-node ACKs, audit trails, and the expectation of a private control network reduce exposure. | Implement per-node certificates or equivalent mutual-authenticated transport with replay protection and rotation workflows. |
| `D-002` | Target architecture split | `5.1` | NestJS and NGINX still share one container and failure domain. | The container supervisor is fail-fast, chaos-tested, and restart-friendly, which is materially safer than the original baseline. | Split control-plane and dataplane responsibilities into separate services or agents. |
| `D-003` | Secret ingestion model | `2.1`, `3.4`, `7` | Runtime secrets are still environment-variable driven inside the app. | Documentation now clearly requires Swarm secrets or an external secret manager for production injection, and security posture endpoints expose missing-secret conditions. | Add first-class `*_FILE` / secret-provider integration and reduce direct env exposure in runtime code. |
| `D-004` | Manual rollback ergonomics | `1.6`, `6.3` | Automatic rollback exists for failed activation, but there is no dedicated manual config-rollback API. | Operators can revert desired state and trigger a new reload; runbooks now document the process. | Add explicit desired-state versioning, diff, commit, and rollback APIs. |
| `D-005` | Rate limiting and front-door abuse controls | `2.6`, `7` | Rate limiting remains a baseline global throttler rather than a production-tuned per-surface policy. | Authenticated-by-default admin APIs, RBAC, and the expectation of upstream ingress/WAF controls reduce immediate exposure. | Make rate limits environment-driven and per-route, and document required upstream WAF/account-based controls. |
| `D-006` | Disaster-recovery breadth | `2.3`, `6.7` | The repo hardens certificate backup/verify/restore, but it does not orchestrate full PostgreSQL PITR, off-site retention, or cluster-wide restore jobs. | Encrypted/signed certificate backups and restore runbooks materially improve certificate-state recovery, while broader DB DR can still be handled by the database/platform layer. | Add database-backup orchestration, restore planning/execution APIs, and cluster reconciliation workflows if in-repo DR is required. |
| `D-007` | Docker runtime hardening | `3.4`, `7` | The image is still not fully hardened for non-root/read-only-fs/cap-drop operation, and NGINX log files remain broadly writable. | Multi-stage builds, pinned base image, explicit healthchecks, and the fail-fast entrypoint reduce part of the original packaging risk. | Move to non-root where feasible, tighten filesystem permissions, and document capability/seccomp/apparmor expectations. |
| `D-008` | External key custody | `2.2`, `2.3` | Key encryption and backup encryption currently rely on locally configured master keys rather than KMS/Vault/HSM-backed providers. | Envelope encryption, key-version metadata, and re-encryption flows now exist, which is significantly stronger than plaintext storage. | Add operator-facing integrations for external key custody and rotation. |
| `D-009` | Supply-chain attestations | `3.1`, `4.1` | CI performs production dependency audit and container scanning, but SBOM generation/provenance signing is not yet shipped. | The release workflow already blocks publication on lint, typecheck, tests, build, audit, and scan success. | Add SBOM generation and signed provenance to the release workflow. |
| `D-010` | GitHub policy enforcement outside the repo | `3.1` | Required-status-check / branch-protection enforcement depends on repository settings, not code alone. | The workflow is structured so publication only occurs after gates pass; the remaining step is repository policy configuration. | Enable branch protections and require the CI gates for merges to protected branches. |
| `D-011` | Recommended API surface breadth | `6.1`-`6.9` | The shipped admin API is practical but narrower than the aspirational assessment list (for example drain/maintenance, service-account lifecycle, config-draft workflows, event streams, and restore-job APIs). | Current operators still have authenticated access to the core shipped workflows: cluster visibility, proxy CRUD, certificate/order operations, backups, audit, logs, metrics, and security posture/rotation endpoints. | Expand the API only if the operating model genuinely needs those workflows as first-class contracts. |

## Acceptance guidance

A rollout owner should explicitly answer these questions before sign-off:

1. Is a private, trusted control network sufficient while `D-001` remains open?
2. Is the current container hardening posture in `D-007` acceptable for the deployment environment?
3. Are platform-native DB backups and secret-management controls strong enough to compensate for `D-003`, `D-006`, and `D-008`?
4. Are upstream ingress/WAF controls in place to compensate for `D-005`?
5. Is the narrower shipped API in `D-011` enough for the operators who will run this system?

If any answer is "no", retire the relevant deferment before calling the rollout approved.

