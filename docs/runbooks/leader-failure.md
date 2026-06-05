# Leader failure runbook

Last updated: 2026-05-28

Use this runbook when alerts or operators detect that the cluster leader is missing, stale, or inconsistent.

## When to use it

Typical triggers:

- `lyttle_cluster_leader_present == 0`
- `lyttle_cluster_leader_lease_expired == 1`
- `GET /cluster/status` reports no healthy leader
- cluster-wide reload or certificate activation operations stop progressing
- `GET /cluster/leader/status` reports lease drift or leader inconsistency issues

## Required access

- `viewer` to inspect health, lease, nodes, and operations
- `platform-admin` to use the manual leader repair endpoints

## Before making changes

1. Confirm the problem is not just a database outage.
2. Avoid making multiple competing manual leader changes from different nodes at the same time.
3. Record the incident ID and the node you are working from.

## Step 1: Check dependency health first

Run these checks from any reachable node:

```bash
curl -s http://localhost:3000/health/ready | jq
curl -s http://localhost:3000/health/dependencies | jq
curl -s http://localhost:3000/cluster/status -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/lease -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/leader/status -H "Authorization: Bearer $JWT" | jq
```

If PostgreSQL is unhealthy, fix database connectivity first. Lease repair is unlikely to succeed while the database is unavailable.

## Step 2: Identify the failure mode

Use `GET /cluster/leader/status` and `GET /cluster/nodes?includeInactive=true` to classify the issue.

```bash
curl -s "http://localhost:3000/cluster/nodes?includeInactive=true" -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/leader/status -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/operations -H "Authorization: Bearer $JWT" | jq
```

Common cases:

### Case A — No active lease

Symptoms:

- `status: "no-leader"`
- no `lease.ownerNodeId`
- cluster operations are not advancing

Recommended action:

- use `GET /cluster/admin/ensure-leader`

### Case B — Lease exists, but owner node is stale or missing

Symptoms:

- `lease.ownerNodeId` is present
- `leaseOwnerRecord` is missing or inactive
- `issues` includes lease/owner mismatch conditions

Recommended action:

- verify the owner node is actually gone or unhealthy
- then use `GET /cluster/admin/ensure-leader`
- if stale node records are hanging around, run `GET /cluster/admin/cleanup`

### Case C — Lease and DB annotations disagree

Symptoms:

- lease exists
- `dbLeader` or `allLeadersInDb` does not match the lease owner
- `issues` shows `LEASE_DB_MISMATCH`

Recommended action:

- use `GET /cluster/admin/enforce-leader`

### Case D — You need the local node to attempt leadership

Symptoms:

- there is no healthy leader
- you are intentionally repairing from a specific node

Recommended action:

- use `GET /cluster/admin/become-leader`
- only do this from one chosen repair node

## Step 3: Apply the minimum repair action

### Ensure a leader exists

```bash
curl -s http://localhost:3000/cluster/admin/ensure-leader \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq
```

### Clean up stale nodes

```bash
curl -s http://localhost:3000/cluster/admin/cleanup \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq
```

### Reconcile leader flags to the active lease

```bash
curl -s http://localhost:3000/cluster/admin/enforce-leader \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq
```

### Ask the current node to try becoming leader

```bash
curl -s http://localhost:3000/cluster/admin/become-leader \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" | jq
```

## Step 4: Validate recovery

After the repair action:

```bash
curl -s http://localhost:3000/cluster/leader/status -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/status -H "Authorization: Bearer $JWT" | jq
curl -s http://localhost:3000/cluster/operations -H "Authorization: Bearer $JWT" | jq
```

Recovery is considered successful when:

- `GET /cluster/leader/status` reports `status: "healthy"`
- the lease owner is active and matches the DB-visible leader state
- new cluster operations advance normally
- readiness is healthy on the relevant nodes

## Step 5: Post-incident checks

- review `GET /audit` for the manual repair actions
- capture the lease generation/fencing token after recovery
- check recent structured logs for the failing node and the new leader
- confirm no certificate activation or reload operation is left stuck

## Important current limitations

- internal node transport is still authenticated HTTP rather than mTLS
- the system still uses a combined Node + NGINX container model

## Escalate when

Escalate beyond normal operator repair if any of the following are true:

- PostgreSQL remains unhealthy
- `ensure-leader` repeatedly fails after dependency health is restored
- leader lease generation changes rapidly in a loop
- cluster operations continue to stall after leader recovery
- multiple nodes appear to believe they are leader even after `enforce-leader`

