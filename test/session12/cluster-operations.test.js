require('reflect-metadata');

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ClusterOperationsService,
} = require('../../src/distributed-lock/cluster-operations.service');

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
    metadata:
      overrides.metadata ??
      {
        controlPlane: {
          baseUrl: `http://${overrides.hostname ?? overrides.instanceId ?? 'node-a'}.internal:3000`,
          address: `${overrides.hostname ?? overrides.instanceId ?? 'node-a'}.internal`,
          port: 3000,
          protocol: 'http',
        },
      },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createPrismaMock() {
  const state = {
    operationSequence: 0,
    ackSequence: 0,
    operations: [],
    acknowledgements: [],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getOperation(operationId) {
    return state.operations.find((operation) => operation.id === operationId) ?? null;
  }

  function getAcknowledgements(operationId) {
    return state.acknowledgements.filter((ack) => ack.operationId === operationId);
  }

  return {
    state,
    clusterOperation: {
      async create({ data }) {
        const now = new Date();
        state.operationSequence += 1;
        const operation = {
          id: `operation-${state.operationSequence}`,
          operationType: data.operationType,
          scope: data.scope ?? 'cluster',
          status: data.status ?? 'pending',
          initiatorNodeId: data.initiatorNodeId ?? null,
          initiatorHostname: data.initiatorHostname ?? null,
          initiatorActorId: data.initiatorActorId ?? null,
          initiatorActorType: data.initiatorActorType ?? null,
          initiatorActorDisplayName: data.initiatorActorDisplayName ?? null,
          correlationId: data.correlationId ?? null,
          requestPath: data.requestPath ?? null,
          targetNodeCount: data.targetNodeCount ?? 0,
          completedNodeCount: data.completedNodeCount ?? 0,
          successfulNodeCount: data.successfulNodeCount ?? 0,
          failedNodeCount: data.failedNodeCount ?? 0,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null,
          lastError: data.lastError ?? null,
          metadata: data.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        };

        state.operations.push(operation);

        for (const ackData of data.acknowledgements?.create ?? []) {
          state.ackSequence += 1;
          state.acknowledgements.push({
            id: `ack-${state.ackSequence}`,
            operationId: operation.id,
            nodeInstanceId: ackData.nodeInstanceId,
            nodeHostname: ackData.nodeHostname ?? null,
            endpointUrl: ackData.endpointUrl ?? null,
            status: ackData.status ?? 'pending',
            responseStatus: ackData.responseStatus ?? null,
            errorMessage: ackData.errorMessage ?? null,
            startedAt: ackData.startedAt ?? null,
            ackedAt: ackData.ackedAt ?? null,
            details: ackData.details ?? null,
            createdAt: now,
            updatedAt: now,
          });
        }

        return clone(operation);
      },
      async update({ where, data }) {
        const operation = getOperation(where.id);
        if (!operation) {
          throw new Error(`Operation not found: ${where.id}`);
        }

        Object.assign(operation, data, { updatedAt: new Date() });
        return clone(operation);
      },
      async findUniqueOrThrow({ where }) {
        const operation = getOperation(where.id);
        if (!operation) {
          throw new Error(`Operation not found: ${where.id}`);
        }
        return clone(operation);
      },
      async findUnique({ where, include }) {
        const operation = getOperation(where.id);
        if (!operation) {
          return null;
        }

        if (!include?.acknowledgements) {
          return clone(operation);
        }

        const acknowledgements = getAcknowledgements(where.id)
          .slice()
          .sort((left, right) =>
            `${left.nodeHostname ?? ''}:${left.nodeInstanceId}`.localeCompare(
              `${right.nodeHostname ?? ''}:${right.nodeInstanceId}`,
            ),
          );

        return {
          ...clone(operation),
          acknowledgements: clone(acknowledgements),
        };
      },
      async findMany({ take } = {}) {
        return state.operations
          .slice()
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, take ?? state.operations.length)
          .map(clone);
      },
    },
    clusterOperationAck: {
      async update({ where, data }) {
        const ack = state.acknowledgements.find(
          (entry) =>
            entry.operationId === where.operationId_nodeInstanceId.operationId &&
            entry.nodeInstanceId === where.operationId_nodeInstanceId.nodeInstanceId,
        );

        if (!ack) {
          throw new Error(
            `Acknowledgement not found for ${where.operationId_nodeInstanceId.operationId}/${where.operationId_nodeInstanceId.nodeInstanceId}`,
          );
        }

        Object.assign(ack, data, { updatedAt: new Date() });
        return clone(ack);
      },
      async findMany({ where, select } = {}) {
        const acknowledgements = state.acknowledgements.filter((ack) => {
          if (!where?.operationId) {
            return true;
          }
          return ack.operationId === where.operationId;
        });

        if (!select) {
          return acknowledgements.map(clone);
        }

        return acknowledgements.map((ack) => {
          const selected = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              selected[key] = ack[key];
            }
          }
          return selected;
        });
      },
    },
  };
}

async function waitForOperationToSettle(service, operationId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = await service.getOperation(operationId);
    if (operation && !['pending', 'running'].includes(operation.status)) {
      return operation;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Operation ${operationId} did not settle in time`);
}

describe('Session 12 cluster operations and per-node acknowledgements', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
  });

  it('tracks successful local and remote acknowledgements for a cluster-wide reload operation', async () => {
    process.env.API_KEY = 'session12-peer-key';
    const fetchCalls = [];
    global.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return new Response(JSON.stringify({ status: 'succeeded' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const prisma = createPrismaMock();
    const service = new ClusterOperationsService(
      prisma,
      {
        async getActiveNodes() {
          return [
            createNode({ instanceId: 'node-a', hostname: 'node-a' }),
            createNode({ instanceId: 'node-b', hostname: 'node-b' }),
          ];
        },
      },
      {
        getInstanceId() {
          return 'node-a';
        },
      },
    );

    let localExecutions = 0;
    const accepted = await service.enqueueBroadcastOperation({
      operationType: 'cluster.reload',
      remotePath: '/cluster/reload',
      remoteQuery: { broadcast: 'false' },
      initiatedBy: {
        correlationId: 'corr-123',
        requestPath: '/cluster/reload?broadcast=true',
      },
      localAction: async () => {
        localExecutions += 1;
        return { ok: true };
      },
    });

    const operation = await waitForOperationToSettle(
      service,
      accepted.operationId,
    );
    const operationsList = await service.listOperations();

    assert.ok(['pending', 'running'].includes(accepted.status));
    assert.equal(localExecutions, 1);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/cluster\/reload\?broadcast=false&operationId=/);
    assert.equal(fetchCalls[0].options.headers['X-API-Key'], 'session12-peer-key');

    assert.equal(operation.status, 'succeeded');
    assert.equal(operation.targetNodeCount, 2);
    assert.equal(operation.successfulNodeCount, 2);
    assert.equal(operation.failedNodeCount, 0);
    assert.equal(operation.acknowledgements.length, 2);
    assert.deepEqual(
      operation.acknowledgements.map((ack) => ack.status),
      ['succeeded', 'succeeded'],
    );
    assert.equal(operationsList.count, 1);
    assert.equal(operationsList.operations[0].operationId, accepted.operationId);
  });

  it('records remote acknowledgement failures when peer authentication is unavailable', async () => {
    delete process.env.API_KEY;
    global.fetch = async () => {
      throw new Error('fetch should not be called when API_KEY is missing');
    };

    const prisma = createPrismaMock();
    const service = new ClusterOperationsService(
      prisma,
      {
        async getActiveNodes() {
          return [
            createNode({ instanceId: 'node-a', hostname: 'node-a' }),
            createNode({ instanceId: 'node-b', hostname: 'node-b' }),
          ];
        },
      },
      {
        getInstanceId() {
          return 'node-a';
        },
      },
    );

    const accepted = await service.enqueueBroadcastOperation({
      operationType: 'certificate.sync',
      remotePath: '/certificates/sync',
      localAction: async () => ({ success: true }),
    });

    const operation = await waitForOperationToSettle(
      service,
      accepted.operationId,
    );
    const remoteAck = operation.acknowledgements.find(
      (ack) => ack.nodeInstanceId === 'node-b',
    );

    assert.equal(operation.status, 'partially_failed');
    assert.equal(operation.successfulNodeCount, 1);
    assert.equal(operation.failedNodeCount, 1);
    assert.equal(remoteAck?.status, 'failed');
    assert.match(remoteAck?.errorMessage ?? '', /No API key is configured/);
  });
});

