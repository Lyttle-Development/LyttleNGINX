# Security break-glass runbook

Last updated: 2026-05-28

## Purpose

This runbook documents the emergency-only flows that intentionally bypass the safer default paths.

Current break-glass scope in Session 23:

- `GET /certificates/backup/export/:id` — returns decrypted certificate PEM + private key material
- manual legacy `API_KEY` overlap rotation while bearer-token migration is still in progress

These actions are high-risk because they can expose secrets outside the normal encrypted-at-rest and encrypted-backup workflows.

---

## Before you start

1. confirm that a safer workflow will not solve the problem:
   - prefer `POST /certificates/backup/:filename/verify`
   - prefer `POST /certificates/backup/:filename/restore`
   - prefer bearer tokens over long-lived API keys
2. make sure the caller has the right role:
   - decrypted certificate export requires `platform-admin`
   - security review endpoints require at least `security-admin`
3. record the business justification, ticket/incident number, and expected rollback/cleanup window
4. notify the on-call/security owner if decrypted key material will leave the runtime boundary

---

## Break-glass certificate export

### When to use it

Use raw certificate export only when encrypted backup restore or normal certificate activation cannot meet the recovery need, for example:

- emergency restoration of a third-party device that requires direct PEM upload
- immediate temporary handoff of certificate material to a separate recovery environment
- forensic comparison of a certificate/key pair during an incident

### Procedure

1. authenticate as a `platform-admin`
2. fetch current posture first:
   - `GET /security/status`
   - `GET /security/access-review`
3. export the specific certificate only:
   - `GET /certificates/backup/export/:id`
4. store the output in the smallest possible trusted boundary
5. complete the recovery task
6. securely delete any temporary exported files from operator workstations and jump hosts
7. review `GET /audit` for the export event and confirm the correlation ID, actor, and target certificate match the incident record
8. if the private key may have been exposed beyond the intended trust boundary, revoke/replace the certificate and rotate any related credentials

### Post-action checklist

- [ ] exported files deleted from temporary locations
- [ ] audit event reviewed
- [ ] incident/ticket updated with correlation ID
- [ ] follow-up certificate rotation scheduled if exposure is uncertain

---

## Legacy API-key rotation during bearer-token migration

### Goal

Minimize overlap time while keeping the admin surface reachable during rollout.

### Procedure

1. authenticate as `platform-admin`
2. call `POST /security/rotate/api-key` with:
   - `nextApiKey`
   - optional `retireApiKeyId`
   - optional `issueBridgeToken: true`
3. review the returned fingerprint, validation result, and recommended steps
4. update the injected `API_KEY` secret/config outside the app so it contains both old and new keys during the overlap window
5. redeploy all nodes
6. validate the new key against:
   - `GET /auth/status`
   - `GET /security/status`
7. migrate any remaining automation to bearer tokens where possible
8. remove retired keys from the injected secret/config and redeploy again
9. review `GET /audit` for the rotation-planning action and any unexpected auth failures during the overlap window

### Important constraints

- the application does **not** hot-reload API keys
- the planning endpoint does **not** store the new key
- a bearer-token bridge depends on `AUTH_JWT_SECRET` being configured

---

## Internal certificate rotation status

`POST /security/rotate/internal-certs` exists as a forward-looking contract only.

Current state in Session 23:

- inter-node traffic is still authenticated HTTP
- mTLS node certificates are not active yet
- the endpoint returns the prerequisites for the future PKI rotation workflow instead of rotating anything today

Use the endpoint to confirm the current gap and to preserve a stable admin contract for later mTLS work.

---

## Related endpoints

- `GET /security/status`
- `GET /security/policy`
- `GET /security/secrets/health`
- `GET /security/access-review`
- `GET /audit`
- `POST /certificates/backup/:filename/verify`
- `POST /certificates/backup/:filename/restore`

## Related runbooks

- `docs/runbooks/credential-rotation.md`
- `docs/runbooks/restore-from-encrypted-backup.md`

