# NGINX config rollback runbook

Last updated: 2026-05-28

Use this runbook when a config rollout fails or when a newly activated config must be backed out.

## Important reality check

The current implementation has **automatic rollback on failed activation**, but it does **not** yet expose a dedicated API to roll back to an arbitrary prior NGINX release.

That means recovery currently depends on which failure mode you are in:

1. **Activation failed**
   - the runtime should automatically roll back to `last-known-good`
2. **Activation succeeded, but the new desired state is operationally wrong**
   - revert the desired state through the relevant API or data change
   - then trigger a fresh reload/cluster reload

This runbook documents the real workflow, not an unimplemented manual-rollback API.

## Step 1: Determine what failed

Inspect the cluster operation and node config view first.

```bash
curl -s http://localhost:3000/cluster/operations \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/cluster/nodes/<node-id>/config \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/health/deep | jq
```

Look for:

- failed `cluster.reload` operations
- the latest reload ACK payload for the node
- current vs last-known-good runtime metadata on the local node
- readiness failures caused by config apply or NGINX health

## Case A: Reload failed during activation

Expected current behavior:

- the staged release was validated before activation
- if `nginx -s reload` failed after activation, the service attempted rollback automatically
- `last-known-good` should still point at the prior release

### Recovery steps

1. confirm the failed operation is no longer progressing
2. confirm the node health has returned or that the rollback left the node in a safe state
3. inspect the underlying config change that triggered the rollout
4. correct the desired state before attempting another reload

Validation commands:

```bash
curl -s http://localhost:3000/cluster/nodes/<node-id>/config \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/cluster/status \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

## Case B: Config activated successfully, but the change is bad

Examples:

- wrong upstream target
- incorrect redirect behavior
- unexpected header behavior from a custom allowed fragment
- a domain or certificate mapping that is logically wrong even though syntax is valid

### Recovery steps

1. identify the source of the desired-state change
2. revert that source using the appropriate workflow
3. trigger a fresh reload after the desired state is corrected

Typical rollback sources:

- proxy change → revert via `PATCH /proxies/:id` or `DELETE /proxies/:id`
- certificate activation issue → use `POST /certificates/:id/rollback`
- emergency certificate sync issue → restore or re-activate the correct artifact, then reload if needed

Example commands:

```bash
curl -s -X POST http://localhost:3000/certificates/<certificate-id>/rollback \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq

curl -s -X POST http://localhost:3000/cluster/reload \
  -H "Authorization: Bearer $OPERATOR_TOKEN" | jq
```

## Case C: Emergency local rollback with shell access

Prefer the API-driven desired-state revert path above.

If the node is unhealthy and an operator has container/shell access, the current runtime layout exposes:

- `/etc/nginx/runtime/current`
- `/etc/nginx/runtime/last-known-good`
- per-release metadata files under `/etc/nginx/runtime/releases/<release-id>/lyttle-nginx-release.json`

Use that only as a break-glass local repair path when the API surface cannot restore service quickly enough. If you do it:

1. capture the current and target release IDs
2. record the incident/change number
3. restore service first
4. reconcile the desired state in the control plane afterward so the next reload does not reapply the bad config

## Post-rollback validation

After recovery:

```bash
curl -s http://localhost:3000/health/ready | jq
curl -s http://localhost:3000/cluster/status -H "Authorization: Bearer $VIEWER_TOKEN" | jq
curl -s http://localhost:3000/cluster/operations -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

Confirm:

- readiness is healthy again
- no `cluster.reload` operation is left stuck or failing repeatedly
- the node config view shows the expected current runtime state
- the reverted desired state matches what you intend to keep

## Current limitations to remember

- there is no first-class API yet for “roll back to release X”
- automatic rollback covers failed reload activation, not every logically bad config change
- desired-state rollback may require both a source correction and a new reload operation

## Related procedures

- proxy change validation → see `README.md`
- encrypted restore → `docs/runbooks/restore-from-encrypted-backup.md`
- certificate issuance or activation failure → `docs/runbooks/certificate-issuance-failure.md`

