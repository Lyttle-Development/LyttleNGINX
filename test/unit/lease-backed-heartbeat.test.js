require('reflect-metadata');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ClusterHeartbeatService,
} = require('../../src/distributed-lock/cluster-heartbeat.service');

function createNode(overrides = {}) {
  const now = new Date();

  return {
    id: overrides.id ?? `id-${overrides.instanceId ?? 'node-a'}`,
    hostname: overrides.hostname ?? overrides.instanceId ?? 'node-a',
    instanceId: overrides.instanceId ?? 'node-a',
    ipAddress: overrides.ipAddress ?? '10.0.0.1',
    isLeader: overrides.isLeader ?? false,
    lastHeartbeat: overrides.lastHeartbeat ?? now,
    version: overrides.version ?? '0.0.1',
    status: overrides.status ?? 'active',
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createLease({
  ownerNodeId,
  generation = 1,
  ttlSeconds = 30,
  expiresAt,
} = {}) {
  const now = new Date();
  const effectiveExpiresAt =
    expiresAt ?? new Date(now.getTime() + ttlSeconds * 1000);

  return {
    leaseName: 'cluster:leader',
    ownerNodeId: ownerNodeId ?? null,
    ownerHostname: ownerNodeId ?? null,
    generation,
    ttlSeconds,
    acquiredAt: now,
    renewedAt: now,
    expiresAt: effectiveExpiresAt,
    isExpired:
      ownerNodeId == null || effectiveExpiresAt.getTime() <= now.getTime(),
    isHeldByThisInstance: false,
    fencingToken: generation,
  };
}

function createPrismaMock(initialNodes) {
  const state = {
    nodes: initialNodes.map((node) => ({ ...node })),
  };

  function matchesWhere(node, where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      const actual = node[key];

      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (Object.prototype.hasOwnProperty.call(expected, 'lt')) {
          return actual < expected.lt;
        }

        if (Object.prototype.hasOwnProperty.call(expected, 'not')) {
          return actual !== expected.not;
        }

        if (Object.prototype.hasOwnProperty.call(expected, 'in')) {
          return expected.in.includes(actual);
        }
      }

      return actual === expected;
    });
  }

  function sortNodes(nodes, orderBy) {
    if (!orderBy) {
      return nodes;
    }

    const [key, direction] = Object.entries(orderBy)[0];
    return nodes.slice().sort((left, right) => {
      const leftValue = left[key];
      const rightValue = right[key];

      if (leftValue < rightValue) {
        return direction === 'desc' ? 1 : -1;
      }

      if (leftValue > rightValue) {
        return direction === 'desc' ? -1 : 1;
      }

      return 0;
    });
  }

  function selectFields(node, select) {
    if (!select) {
      return { ...node };
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, include]) => include)
        .map(([key]) => [key, node[key]]),
    );
  }

  return {
    state,
    clusterNode: {
      async findMany({ where, orderBy, select } = {}) {
        const filtered = state.nodes.filter((node) => matchesWhere(node, where));
        return sortNodes(filtered, orderBy).map((node) => selectFields(node, select));
      },
      async findUnique({ where }) {
        const [key, value] = Object.entries(where)[0];
        const node = state.nodes.find((entry) => entry[key] === value);
        return node ? { ...node } : null;
      },
      async findFirst({ where, orderBy } = {}) {
        const filtered = state.nodes.filter((node) => matchesWhere(node, where));
        const [first] = sortNodes(filtered, orderBy);
        return first ? { ...first } : null;
      },
      async upsert({ where, create, update }) {
        const [key, value] = Object.entries(where)[0];
        const index = state.nodes.findIndex((node) => node[key] === value);

        if (index >= 0) {
          state.nodes[index] = {
            ...state.nodes[index],
            ...update,
            updatedAt: new Date(),
          };
          return { ...state.nodes[index] };
        }

        const node = {
          id: create.id ?? `id-${create.instanceId}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          isLeader: false,
          ...create,
        };
        state.nodes.push(node);
        return { ...node };
      },
      async update({ where, data }) {
        const [key, value] = Object.entries(where)[0];
        const index = state.nodes.findIndex((node) => node[key] === value);

        if (index < 0) {
          throw new Error(`Node not found for ${key}=${value}`);
        }

        state.nodes[index] = {
          ...state.nodes[index],
          ...data,
          updatedAt: new Date(),
        };

        return { ...state.nodes[index] };
      },
      async updateMany({ where, data }) {
        let count = 0;
        state.nodes = state.nodes.map((node) => {
          if (!matchesWhere(node, where)) {
            return node;
          }

          count += 1;
          return {
            ...node,
            ...data,
            updatedAt: new Date(),
          };
        });
        return { count };
      },
      async deleteMany({ where }) {
        const before = state.nodes.length;
        state.nodes = state.nodes.filter((node) => !matchesWhere(node, where));
        return { count: before - state.nodes.length };
      },
      async count({ where } = {}) {
        return state.nodes.filter((node) => matchesWhere(node, where)).length;
      },
    },
  };
}

function createDistributedLockMock({
  instanceId = 'node-a',
  lease = null,
  tryAcquire = false,
  acquire = false,
  localLockStatus,
} = {}) {
  let currentLease = lease;
  const calls = {
    tryAcquireLeaderLock: 0,
    acquireLeaderLock: 0,
    releaseLeaderLock: 0,
  };

  function snapshot() {
    if (!currentLease) {
      return null;
    }

    const now = new Date();
    const isExpired =
      !currentLease.ownerNodeId || currentLease.expiresAt.getTime() <= now.getTime();

    return {
      ...currentLease,
      isExpired,
      isHeldByThisInstance: currentLease.ownerNodeId === instanceId && !isExpired,
      fencingToken: currentLease.generation,
    };
  }

  function assignLeaseToInstance() {
    currentLease = createLease({
      ownerNodeId: instanceId,
      generation: currentLease?.generation ? currentLease.generation + 1 : 1,
    });
  }

  return {
    calls,
    getInstanceId() {
      return instanceId;
    },
    async isLeader() {
      const leaderLease = snapshot();
      return Boolean(
        leaderLease &&
          !leaderLease.isExpired &&
          leaderLease.ownerNodeId === instanceId,
      );
    },
    getLeaderLockStatus() {
      if (typeof localLockStatus === 'function') {
        return localLockStatus(snapshot());
      }

      const leaderLease = snapshot();
      return {
        isLeader: Boolean(
          leaderLease &&
            !leaderLease.isExpired &&
            leaderLease.ownerNodeId === instanceId,
        ),
        instanceId,
        ownerNodeId: leaderLease?.ownerNodeId ?? null,
        generation: leaderLease?.generation ?? null,
        fencingToken: leaderLease?.generation ?? null,
        expiresAt: leaderLease?.expiresAt ?? null,
        heldForMs: leaderLease ? 1000 : null,
      };
    },
    async getLeaderLeaseSnapshot() {
      return snapshot();
    },
    async tryAcquireLeaderLock() {
      calls.tryAcquireLeaderLock += 1;
      if (!tryAcquire) {
        return false;
      }

      assignLeaseToInstance();
      return true;
    },
    async acquireLeaderLock() {
      calls.acquireLeaderLock += 1;
      if (!acquire) {
        return false;
      }

      assignLeaseToInstance();
      return true;
    },
    async releaseLeaderLock() {
      calls.releaseLeaderLock += 1;
      if (!currentLease || currentLease.ownerNodeId !== instanceId) {
        return false;
      }

      currentLease = createLease({
        ownerNodeId: null,
        generation: currentLease.generation,
        expiresAt: new Date(Date.now() - 1000),
      });
      return true;
    },
  };
}

describe('lease-backed heartbeat and leader flows', () => {
  it('derives leader reads from the active lease instead of persisted isLeader flags', async () => {
    const prisma = createPrismaMock([
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: false }),
      createNode({ instanceId: 'node-b', hostname: 'node-b', isLeader: true }),
    ]);
    const distributedLock = createDistributedLockMock({
      instanceId: 'node-a',
      lease: createLease({ ownerNodeId: 'node-a', generation: 4 }),
    });
    const service = new ClusterHeartbeatService(prisma, distributedLock);

    const activeNodes = await service.getActiveNodes();
    const leader = await service.getLeaderNode();
    const stats = await service.getClusterStats();
    const activeNodeById = Object.fromEntries(
      activeNodes.map((node) => [node.instanceId, node]),
    );

    assert.equal(activeNodeById['node-a']?.isLeader, true);
    assert.equal(activeNodeById['node-b']?.isLeader, false);
    assert.equal(leader?.instanceId, 'node-a');
    assert.equal(stats.leaderCount, 1);
    assert.deepEqual(stats.leadershipIssues, []);
    assert.equal(stats.leaderLeaseGeneration, 4);
  });

  it('waits for lease expiry instead of forcing re-election when the lease owner is no longer active', async () => {
    const prisma = createPrismaMock([
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: false }),
      createNode({
        instanceId: 'node-b',
        hostname: 'node-b',
        status: 'stale',
        isLeader: true,
        lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000),
      }),
    ]);
    const distributedLock = createDistributedLockMock({
      instanceId: 'node-a',
      lease: createLease({ ownerNodeId: 'node-b', generation: 7 }),
      tryAcquire: true,
    });
    const service = new ClusterHeartbeatService(prisma, distributedLock);

    await service.ensureLeaderExists();

    assert.equal(distributedLock.calls.tryAcquireLeaderLock, 0);
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-a')?.isLeader,
      false,
    );
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-b')?.isLeader,
      false,
    );

    const stats = await service.getClusterStats();
    assert.equal(stats.leaderCount, 0);
    assert.deepEqual(stats.leadershipIssues, ['LEASE_OWNER_NOT_ACTIVE']);
  });

  it('elects leadership only by acquiring the leader lease and reconciles stale flags afterwards', async () => {
    const prisma = createPrismaMock([
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: false }),
      createNode({ instanceId: 'node-b', hostname: 'node-b', isLeader: true }),
    ]);
    const distributedLock = createDistributedLockMock({
      instanceId: 'node-a',
      lease: null,
      tryAcquire: true,
    });
    const service = new ClusterHeartbeatService(prisma, distributedLock);

    await service.ensureLeaderExists();

    assert.equal(distributedLock.calls.tryAcquireLeaderLock, 1);
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-a')?.isLeader,
      true,
    );
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-b')?.isLeader,
      false,
    );

    const leader = await service.getLeaderNode();
    assert.equal(leader?.instanceId, 'node-a');
  });

  it('marks stale nodes stale during cleanup while preserving lease authority until expiry', async () => {
    const prisma = createPrismaMock([
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: false }),
      createNode({
        instanceId: 'node-b',
        hostname: 'node-b',
        status: 'active',
        isLeader: true,
        lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000),
      }),
    ]);
    const distributedLock = createDistributedLockMock({
      instanceId: 'node-a',
      lease: createLease({ ownerNodeId: 'node-b', generation: 3 }),
      tryAcquire: true,
    });
    const service = new ClusterHeartbeatService(prisma, distributedLock);

    const result = await service.manualCleanup();

    assert.equal(result.success, true);
    assert.equal(
      prisma.state.nodes.find((node) => node.instanceId === 'node-b')?.status,
      'stale',
    );
    assert.equal(distributedLock.calls.tryAcquireLeaderLock, 0);

    const stats = await service.getClusterStats();
    assert.equal(stats.leaderCount, 0);
    assert.deepEqual(stats.leadershipIssues, ['LEASE_OWNER_NOT_ACTIVE']);
  });
});

