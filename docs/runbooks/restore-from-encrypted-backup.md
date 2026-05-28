# Restore from encrypted backup

Last updated: 2026-05-28

Use this runbook to restore certificate state from a hardened `.lyttlebackup` artifact.

## Scope

This runbook covers the shipped Session 20 restore flow:

- encrypted backup artifact
- signed manifest verification
- server-side restore

It does **not** cover legacy plaintext `.zip` backup restore as a supported recovery path.

## Required access

- `security-admin`

## Before you start

1. Confirm you are restoring the correct environment.
2. Record the incident/change ID.
3. Prefer restoring from the newest verified `.lyttlebackup` artifact.
4. If you only need one certificate and not a full restore, assess whether direct import or a normal certificate re-issuance is safer.

## Step 1: Inspect available backups

```bash
curl -s http://localhost:3000/certificates/backup \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

Choose the artifact you intend to restore.

## Step 2: Verify the backup before restore

Always verify before restore.

```bash
curl -s -X POST \
  http://localhost:3000/certificates/backup/<filename>.lyttlebackup/verify \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

Do not continue if verification reports signature, checksum, or decryption failures.

## Step 3: Run the restore

```bash
curl -s -X POST \
  http://localhost:3000/certificates/backup/<filename>.lyttlebackup/restore \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

Expected outcome:

- the application validates the encrypted artifact server-side
- certificate rows are recreated from the verified payload
- the response identifies the restored records or reports why restore was rejected

## Step 4: Validate the restored state

After restore, confirm the cluster can see the expected certificate inventory.

```bash
curl -s http://localhost:3000/certificates \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/health/deep | jq

curl -s http://localhost:3000/cluster/status \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

If the restore was part of a larger recovery event, also inspect:

```bash
curl -s http://localhost:3000/cluster/operations \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

## Step 5: Reconcile runtime state if needed

Restore rebuilds database-backed certificate state, but you may still need to drive the runtime to converge.

Depending on the incident, the follow-up may be:

- a certificate sync
- a cluster reload
- a certificate artifact activation or rollback

Current operator-facing examples:

```bash
curl -s -X POST http://localhost:3000/certificates/sync \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq

curl -s -X POST http://localhost:3000/cluster/reload \
  -H "Authorization: Bearer $OPERATOR_TOKEN" | jq
```

## If restore fails

Check the following first:

- the artifact really ends with `.lyttlebackup`
- `BACKUP_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY_VERSION` match the artifact generation era
- the backup file exists and is readable on the node handling the request
- the artifact verification endpoint reports success before restore is attempted

If verification fails, stop and investigate the artifact or key mismatch instead of retrying restore blindly.

## Important current limitations

- older plaintext `.zip` backups remain legacy artifacts and are not trusted by the hardened verify/restore flow
- restore focuses on certificate-state recovery; it does not fully reconstruct all historical order/artifact workflow detail from older backups
- raw PEM export remains a separate break-glass workflow and should not be used as the default restore path

## Related procedures

- break-glass export → `docs/runbooks/security-break-glass.md`
- config rollback after restore → `docs/runbooks/nginx-config-rollback.md`
- credential rotation after a suspected key exposure → `docs/runbooks/credential-rotation.md`

