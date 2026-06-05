# Certificate issuance failure runbook

Last updated: 2026-05-28

Use this runbook when certificate issuance, retry, distribution, or activation fails.

## Current scope

The shipped certificate workflow supports:

- durable certificate orders
- shared PostgreSQL-backed ACME HTTP-01 challenge publication
- cluster ACK-backed artifact activation
- rollback to the prior artifact version

Important current constraint:

- the built-in hardened ACME flow is **HTTP-01 only**
- wildcard issuance is intentionally rejected by the shipped implementation

## Step 1: Identify the failing order or certificate

Start with the order and challenge views.

```bash
curl -s http://localhost:3000/certificates/orders \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/certificates/challenges \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/certificates \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

If the incident is tied to a particular order:

```bash
curl -s http://localhost:3000/certificates/orders/<order-id> \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

## Step 2: Classify the failure mode

### Case A — Validation rejected before ACME ran

Examples:

- malformed domain
- unsupported wildcard domain
- local/non-FQDN value

Typical signal:

- the order is `failed` early
- the error message references domain normalization or wildcard support

Action:

- correct the requested domains
- do not keep retrying the same invalid order input

### Case B — HTTP-01 challenge publication or reachability failed

Typical signal:

- the order is stuck or failed around `challenge-published` / `validating`
- `GET /certificates/challenges` shows failed or stale challenge records

Action:

1. confirm the challenge route is reachable from the public edge
2. confirm the relevant node health is good
3. confirm the shared challenge record exists
4. retry the order after fixing reachability

Useful checks:

```bash
curl -s http://localhost:3000/health/dependencies | jq
curl -s http://localhost:3000/cluster/status -H "Authorization: Bearer $VIEWER_TOKEN" | jq
curl -s http://localhost:3000/certificates/challenges -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

### Case C — Issuance succeeded, but cluster activation failed

Typical signal:

- the order reached `issued` or `distributing`
- a linked cluster operation has failed ACKs
- the old active artifact remains in place

Action:

```bash
curl -s http://localhost:3000/cluster/operations \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

Inspect the relevant operation and per-node ACKs, then decide whether to:

- retry the order if the artifact still needs activation
- repair the failing node and re-run activation
- roll back the certificate if an incorrect artifact became active on some nodes

### Case D — Dependency outage blocked the workflow

Typical signal:

- readiness or dependency health is bad
- logs show database, NGINX, or certificate-sync freshness issues

Action:

- stabilize the dependency first
- then retry the order or rerun the activation flow

## Step 3: Use the least-destructive recovery action

### Retry a failed order

```bash
curl -s -X POST http://localhost:3000/certificates/orders/<order-id>/retry \
  -H "Authorization: Bearer $OPERATOR_TOKEN" | jq
```

Use retry when:

- the order input is still valid
- the failure was environmental or transient
- you want to preserve the order history rather than creating a fresh workflow immediately

### Roll back the active certificate

If the wrong certificate artifact became active and you need to restore the prior good version:

```bash
curl -s -X POST http://localhost:3000/certificates/<certificate-id>/rollback \
  -H "Authorization: Bearer $SECURITY_ADMIN_TOKEN" | jq
```

### Re-check cluster convergence

```bash
curl -s http://localhost:3000/cluster/operations \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/cluster/nodes/<node-id>/certificates \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

## Step 4: Validate recovery

Recovery is successful when:

- the order has moved out of `failed` / stale state as expected
- challenge state is no longer stuck
- the target certificate is active where expected
- cluster ACKs are healthy
- readiness and dependency health are good again

Useful final checks:

```bash
curl -s http://localhost:3000/certificates/orders/<order-id> \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq

curl -s http://localhost:3000/health/deep | jq

curl -s http://localhost:3000/cluster/status \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq
```

## Common mistakes to avoid

- retrying wildcard ACME orders even though wildcard issuance is intentionally unsupported
- retrying while PostgreSQL or NGINX health is still broken
- assuming local issuance success means the cluster activation succeeded
- using raw certificate export as a normal recovery path instead of the built-in order, rollback, and backup workflows

## Escalate when

Escalate beyond routine retry when:

- the same order fails repeatedly after challenge reachability is confirmed
- multiple nodes report certificate activation ACK failures
- the old active artifact cannot be restored cleanly
- challenge records are present but public challenge traffic never reaches any healthy node

## Related procedures

- leader repair → `docs/runbooks/leader-failure.md`
- config rollback → `docs/runbooks/nginx-config-rollback.md`
- encrypted restore → `docs/runbooks/restore-from-encrypted-backup.md`
- break-glass export → `docs/runbooks/security-break-glass.md`

