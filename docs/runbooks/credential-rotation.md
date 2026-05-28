# Credential rotation runbook

Last updated: 2026-05-28

This runbook documents the operator-facing credential and encryption-key rotation procedures that are actually implemented today.

## Current rotation surface

Implemented today:

- legacy `API_KEY` overlap planning
- bearer-token bridge issuance from `POST /auth/token`
- private-key encryption re-encryption via `POST /security/rotate/private-key-encryption`
- backup key rotation through configuration change plus new artifact creation

Not fully implemented yet:

- internal node certificate rotation for mTLS

## Required access

- `platform-admin` for API-key planning
- `security-admin` for private-key re-encryption and secret posture review

## 1. Legacy API key rotation

The application still supports legacy API keys as a migration bridge.
The current rotation model is **manual secret update + redeploy**, not in-process hot reload.

### Plan the overlap window

```bash
curl -s -X POST http://localhost:3000/security/rotate/api-key \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nextApiKey": "<new-key>",
    "issueBridgeToken": true
  }' | jq
```

This endpoint:

- validates the proposed key
- returns safe fingerprint/ID information
- optionally issues a short-lived bearer-token bridge when `AUTH_JWT_SECRET` is configured
- does **not** store the new key for you

### Execute the rotation

1. update the external secret/config source so both old and new keys are available during the overlap window
2. redeploy all nodes
3. validate the new key
4. remove the retired key from the secret/config source
5. redeploy again

Validation commands:

```bash
curl -s http://localhost:3000/auth/status -H "X-API-Key: <new-key>" | jq
curl -s http://localhost:3000/security/status -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq
```

## 2. Bearer-token bridge during migration

If `AUTH_JWT_SECRET` is configured, you can exchange a legacy API-key-authenticated session for a short-lived bearer token:

```bash
curl -s -X POST http://localhost:3000/auth/token \
  -H "X-API-Key: <current-key>" | jq
```

Use this to reduce dependence on long-lived API keys while the remaining clients migrate.

## 3. Private-key master-key rotation

This rotates the application-layer encryption version used for stored certificate private keys.

### Preparation

1. update the injected runtime secrets/config so the new values are available:
   - `PRIVATE_KEY_ENCRYPTION_MASTER_KEY`
   - `PRIVATE_KEY_ENCRYPTION_KEY_VERSION`
2. redeploy the application so the new target key version is active

### Run the re-encryption pass

```bash
curl -s -X POST http://localhost:3000/security/rotate/private-key-encryption \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetKeyVersion": "v2"
  }' | jq
```

### Validate afterward

- inspect `GET /security/status`
- inspect `GET /security/secrets/health`
- create and verify a fresh backup artifact

```bash
curl -s http://localhost:3000/security/status \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq

curl -s http://localhost:3000/security/secrets/health \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

## 4. Backup encryption key rotation

Backup artifact protection is configuration-driven.
There is no separate in-app migration endpoint for historical backup files.

### Current procedure

1. update:
   - `BACKUP_ENCRYPTION_KEY`
   - `BACKUP_ENCRYPTION_KEY_VERSION`
2. redeploy the application
3. create fresh encrypted backups under the new version
4. verify the new artifacts
5. retire older artifacts according to your retention policy

Example follow-up:

```bash
curl -s -X POST http://localhost:3000/certificates/backup \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq

curl -s -X POST http://localhost:3000/certificates/backup/<new-file>.lyttlebackup/verify \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

## 5. Internal certificate rotation status

`POST /security/rotate/internal-certs` is currently a forward-looking contract only.

Current reality:

- inter-node traffic is still authenticated HTTP
- mTLS node certificates are not yet active
- the endpoint exists to document prerequisites and preserve a future admin contract

You can inspect that status with:

```bash
curl -s -X POST http://localhost:3000/security/rotate/internal-certs \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

## Post-rotation checks

After any credential or key rotation:

- validate `GET /auth/status` or the affected security endpoint with the new credential
- inspect `GET /security/status`
- review `GET /audit` for the rotation-planning or rotation action
- confirm no unexpected authorization failures appear in structured logs

## Important limitations

- API keys are not hot-reloaded by the application
- backup-envelope key rotation does not retroactively rewrite older artifacts
- internal mTLS certificate rotation is not yet implemented
- final production-readiness sign-off is still pending Session 30

## Related procedures

- break-glass handling → `docs/runbooks/security-break-glass.md`
- encrypted restore → `docs/runbooks/restore-from-encrypted-backup.md`
- architecture/current boundaries → `docs/architecture/current-architecture.md`

