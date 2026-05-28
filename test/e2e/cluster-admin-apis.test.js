require('reflect-metadata');

process.env.ADMIN_EMAIL ??= 'cluster-admin@example.com';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const request = require('supertest');
const { APP_GUARD } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');
const {
  AuthorizationGuard,
} = require('../../src/auth/guards/authorization.guard');
const {
  ClusterController,
} = require('../../src/distributed-lock/cluster.controller');
const {
  ClusterHeartbeatService,
} = require('../../src/distributed-lock/cluster-heartbeat.service');
const {
  ClusterOperationsService,
} = require('../../src/distributed-lock/cluster-operations.service');
const {
  DistributedLockService,
} = require('../../src/distributed-lock/distributed-lock.service');
const { PrismaService } = require('../../src/prisma/prisma.service');
const { ReloaderService } = require('../../src/reloader/reloader.service');

function signHs256Token(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function buildAdminToken(role) {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Token(
    {
      sub: `${role}-user`,
      iss: 'lyttle-nginx.test',
      aud: 'lyttle-nginx-admin',
      iat: now,
      nbf: now,
      exp: now + 300,
      actor_type: 'admin',
      roles: [role],
      scope: 'admin:full cluster:read',
      name: `${role}-user`,
    },
    'cluster-admin-super-secret',
  );
}

function createNode(overrides = {}) {
  const now = new Date('2026-05-26T12:00:00Z');
  return {
    id: overrides.id ?? `node-record-${overrides.instanceId ?? 'node-a'}`,
    hostname: overrides.hostname ?? overrides.instanceId ?? 'node-a',
    instanceId: overrides.instanceId ?? 'node-a',
    ipAddress: overrides.ipAddress ?? '10.0.0.10',
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
  };
}

function createOperation({
  operationId,
  operationType,
  status,
  nodeInstanceId,
  nodeHostname,
  ackStatus,
  ackedAt,
  details,
  createdAt,
}) {
  return {
    operationId,
    operationType,
    scope: 'cluster',
    status,
    targetNodeCount: 1,
    completedNodeCount: ackStatus === 'pending' ? 0 : 1,
    successfulNodeCount: ackStatus === 'succeeded' ? 1 : 0,
    failedNodeCount: ackStatus === 'failed' ? 1 : 0,
    initiatorNodeId: 'node-a',
    initiatorHostname: 'node-a',
    correlationId: `corr-${operationId}`,
    requestPath: `/${operationType.replace('.', '/')}`,
    createdAt,
    startedAt: createdAt,
    completedAt: ackStatus === 'pending' ? null : ackedAt,
    lastError: ackStatus === 'failed' ? 'operation failed' : null,
    operationStatusPath: `/cluster/operations/${operationId}`,
    links: {
      self: `/cluster/operations/${operationId}`,
    },
    statusSummary: {
      pendingNodeCount: ackStatus === 'pending' ? 1 : 0,
      completionRatio: ackStatus === 'pending' ? 0 : 1,
      isTerminal: ackStatus !== 'pending',
      isSuccessful: ackStatus === 'succeeded',
    },
    nodeAcknowledgement: {
      nodeInstanceId,
      nodeHostname,
      endpointUrl: `http://${nodeHostname}.internal:3000/internal`,
      status: ackStatus,
      responseStatus: ackStatus === 'failed' ? 500 : 200,
      errorMessage: ackStatus === 'failed' ? 'operation failed' : null,
      startedAt: createdAt,
      ackedAt,
      details: details ?? null,
    },
  };
}

describe('cluster operations and node-status admin APIs', () => {
  const originalEnv = {
    API_KEY: process.env.API_KEY,
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
  };

  let app;
  let httpServer;
  let nodes;
  let operations;
  let certificates;

  const prismaMock = {
    clusterNode: {
      async findMany() {
        return [...nodes];
      },
      async findFirst({ where }) {
        const candidates = where?.OR ?? [];
        return (
          nodes.find((node) =>
            candidates.some(
              (candidate) =>
                candidate.id === node.id ||
                candidate.instanceId === node.instanceId ||
                candidate.hostname === node.hostname,
            ),
          ) ?? null
        );
      },
    },
    certificate: {
      async count() {
        return certificates.length;
      },
      async findMany() {
        return [...certificates].sort(
          (left, right) => left.expiresAt.getTime() - right.expiresAt.getTime(),
        );
      },
    },
  };

  const clusterHeartbeatMock = {
    async getActiveNodes() {
      return nodes.filter((node) => node.status === 'active');
    },
    async getClusterStats() {
      const active = nodes.filter((node) => node.status === 'active').length;
      const stale = nodes.filter((node) => node.status === 'stale').length;
      const inactive = nodes.filter((node) => node.status === 'inactive').length;
      return {
        total: nodes.length,
        active,
        stale,
        inactive,
        leaders: nodes.filter((node) => node.isLeader),
        leaderCount: nodes.filter((node) => node.isLeader).length,
        hasMultipleLeaders: false,
        leadershipIssues: [],
        leaderLeaseGeneration: 7,
        leaderLeaseOwnerNodeId: 'node-a',
      };
    },
    async getLeaderNode() {
      return nodes.find((node) => node.instanceId === 'node-a') ?? null;
    },
    async getLeaderLeaseState() {
      const ownerNode = nodes.find((node) => node.instanceId === 'node-a') ?? null;
      return {
        lease: {
          leaseName: 'cluster:leader',
          ownerNodeId: 'node-a',
          ownerHostname: 'node-a',
          generation: 7,
          fencingToken: 7,
          ttlSeconds: 30,
          acquiredAt: new Date('2026-05-26T11:58:00Z'),
          renewedAt: new Date('2026-05-26T11:59:30Z'),
          expiresAt: new Date('2026-05-26T12:00:00Z'),
          isExpired: false,
          isHeldByThisInstance: true,
        },
        hasActiveLease: true,
        ownerNode,
        activeLeaderNode: ownerNode,
        issues: [],
      };
    },
    async manualCleanup() {
      return { success: true };
    },
    async manualEnforceLeader() {
      return { success: true };
    },
    async ensureLeaderExists() {
      return undefined;
    },
    async tryBecomeLeader() {
      return true;
    },
  };

  const clusterOperationsMock = {
    async listOperations(options = {}) {
      const normalized = typeof options === 'number' ? { limit: options } : options;
      const operationTypes = [
        ...(normalized.operationTypes ?? []),
        ...(normalized.operationType ? [normalized.operationType] : []),
      ].filter(Boolean);

      let filtered = [...operations];

      if (normalized.status) {
        filtered = filtered.filter((operation) => operation.status === normalized.status);
      }
      if (operationTypes.length > 0) {
        filtered = filtered.filter((operation) =>
          operationTypes.includes(operation.operationType),
        );
      }
      if (normalized.targetNodeId) {
        filtered = filtered.filter(
          (operation) =>
            operation.nodeAcknowledgement?.nodeInstanceId === normalized.targetNodeId,
        );
      }

      const limit = normalized.limit ?? 20;
      filtered = filtered.slice(0, limit);

      return {
        count: filtered.length,
        filters: {
          limit,
          status: normalized.status ?? null,
          operationTypes,
          targetNodeId: normalized.targetNodeId ?? null,
        },
        operations: filtered,
      };
    },
    async getOperation(operationId) {
      return operations.find((operation) => operation.operationId === operationId) ?? null;
    },
    async enqueueBroadcastOperation() {
      throw new Error('not used in cluster admin API tests');
    },
  };

  const distributedLockMock = {
    getInstanceId() {
      return 'node-a';
    },
    getLeaderLockStatus() {
      return {
        isLeader: true,
        heldForMs: 1000,
        instanceId: 'node-a',
        ownerNodeId: 'node-a',
        generation: 7,
        fencingToken: 7,
        expiresAt: new Date('2026-05-26T12:00:00Z'),
      };
    },
    async getLeaderLeaseSnapshot() {
      return {
        leaseName: 'cluster:leader',
        ownerNodeId: 'node-a',
        ownerHostname: 'node-a',
        generation: 7,
        ttlSeconds: 30,
        acquiredAt: new Date('2026-05-26T11:58:00Z'),
        renewedAt: new Date('2026-05-26T11:59:30Z'),
        expiresAt: new Date('2026-05-26T12:00:00Z'),
        isExpired: false,
        isHeldByThisInstance: true,
        fencingToken: 7,
      };
    },
  };

  const reloaderMock = {
    async reloadConfig() {
      return { ok: true };
    },
    async getRuntimeReleaseStatus() {
      return {
        runtimeDir: '/etc/nginx/runtime',
        releasesDir: '/etc/nginx/runtime/releases',
        currentReleaseId: '2026-05-26T12-00-00-000Z-ssl-activation',
        currentReleasePath:
          '/etc/nginx/runtime/releases/2026-05-26T12-00-00-000Z-ssl-activation',
        currentRelease: {
          releaseId: '2026-05-26T12-00-00-000Z-ssl-activation',
          status: 'active',
        },
        lastKnownGoodReleaseId: '2026-05-26T12-00-00-000Z-ssl-activation',
        lastKnownGoodPath:
          '/etc/nginx/runtime/releases/2026-05-26T12-00-00-000Z-ssl-activation',
        lastKnownGoodRelease: {
          releaseId: '2026-05-26T12-00-00-000Z-ssl-activation',
          status: 'active',
        },
      };
    },
  };

  before(async () => {
    process.env.API_KEY = 'cluster-admin-legacy-key';
    process.env.AUTH_JWT_SECRET = 'cluster-admin-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';

    nodes = [
      createNode({ instanceId: 'node-a', hostname: 'node-a', isLeader: true }),
      createNode({
        id: 'node-record-node-b',
        instanceId: 'node-b',
        hostname: 'node-b',
        status: 'stale',
        isLeader: false,
        ipAddress: '10.0.0.11',
      }),
    ];

    operations = [
      createOperation({
        operationId: 'operation-reload-a',
        operationType: 'cluster.reload',
        status: 'succeeded',
        nodeInstanceId: 'node-a',
        nodeHostname: 'node-a',
        ackStatus: 'succeeded',
        createdAt: new Date('2026-05-26T12:00:00Z'),
        ackedAt: new Date('2026-05-26T12:00:05Z'),
        details: { currentReleaseId: '2026-05-26T12-00-00-000Z-ssl-activation' },
      }),
      createOperation({
        operationId: 'operation-sync-a',
        operationType: 'certificate.sync',
        status: 'succeeded',
        nodeInstanceId: 'node-a',
        nodeHostname: 'node-a',
        ackStatus: 'succeeded',
        createdAt: new Date('2026-05-26T12:05:00Z'),
        ackedAt: new Date('2026-05-26T12:05:02Z'),
        details: { syncedCount: 2 },
      }),
      createOperation({
        operationId: 'operation-activate-a',
        operationType: 'certificate.activate',
        status: 'succeeded',
        nodeInstanceId: 'node-a',
        nodeHostname: 'node-a',
        ackStatus: 'succeeded',
        createdAt: new Date('2026-05-26T12:10:00Z'),
        ackedAt: new Date('2026-05-26T12:10:04Z'),
        details: { artifactId: 'artifact-1', artifactVersion: 3 },
      }),
      createOperation({
        operationId: 'operation-reload-b',
        operationType: 'cluster.reload',
        status: 'failed',
        nodeInstanceId: 'node-b',
        nodeHostname: 'node-b',
        ackStatus: 'failed',
        createdAt: new Date('2026-05-26T12:15:00Z'),
        ackedAt: new Date('2026-05-26T12:15:03Z'),
        details: { error: 'nginx -t failed' },
      }),
    ];

    certificates = [
      {
        id: 'cert-1',
        domains: 'api.example.com;www.api.example.com',
        expiresAt: new Date('2026-06-30T00:00:00Z'),
        issuedAt: new Date('2026-05-01T00:00:00Z'),
        lastUsedAt: new Date('2026-05-26T11:55:00Z'),
      },
      {
        id: 'cert-2',
        domains: 'admin.example.com',
        expiresAt: new Date('2026-05-28T00:00:00Z'),
        issuedAt: new Date('2026-04-30T00:00:00Z'),
        lastUsedAt: new Date('2026-05-26T11:56:00Z'),
      },
    ];

    const moduleRef = await Test.createTestingModule({
      controllers: [ClusterController],
      providers: [
        AuthService,
        {
          provide: APP_GUARD,
          useClass: ApiKeyGuard,
        },
        {
          provide: APP_GUARD,
          useClass: AuthorizationGuard,
        },
        {
          provide: ClusterHeartbeatService,
          useValue: clusterHeartbeatMock,
        },
        {
          provide: ClusterOperationsService,
          useValue: clusterOperationsMock,
        },
        {
          provide: DistributedLockService,
          useValue: distributedLockMock,
        },
        {
          provide: ReloaderService,
          useValue: reloaderMock,
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  after(async () => {
    await app?.close();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('lets viewers inspect the aggregated cluster status overview', async () => {
    const viewerToken = buildAdminToken('viewer');

    const response = await request(httpServer)
      .get('/cluster/status')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.cluster.total, 2);
    assert.equal(response.body.cluster.active, 1);
    assert.equal(response.body.nodes.count, 1);
    assert.equal(response.body.operations.count, 4);
    assert.equal(response.body.leader.status, 'healthy');
    assert.equal(response.body.links.operations, '/cluster/operations');
  });

  it('supports inactive-node listing and node-filtered operation inspection', async () => {
    const viewerToken = buildAdminToken('viewer');

    const nodesResponse = await request(httpServer)
      .get('/cluster/nodes?includeInactive=true')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(nodesResponse.body.count, 2);
    assert.equal(nodesResponse.body.includeInactive, true);
    assert.deepEqual(
      nodesResponse.body.nodes.map((node) => node.instanceId),
      ['node-a', 'node-b'],
    );

    const operationsResponse = await request(httpServer)
      .get('/cluster/operations?nodeId=node-a&type=cluster.reload')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(operationsResponse.body.count, 1);
    assert.equal(operationsResponse.body.filters.requestedNodeId, 'node-a');
    assert.equal(operationsResponse.body.filters.resolvedNodeId, 'node-a');
    assert.equal(
      operationsResponse.body.operations[0].nodeAcknowledgement.nodeInstanceId,
      'node-a',
    );
  });

  it('returns detailed local config and certificate state for a node', async () => {
    const viewerToken = buildAdminToken('viewer');

    const nodeResponse = await request(httpServer)
      .get('/cluster/nodes/node-a')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(nodeResponse.body.found, true);
    assert.equal(nodeResponse.body.node.instanceId, 'node-a');
    assert.equal(nodeResponse.body.config.runtime.currentReleaseId, '2026-05-26T12-00-00-000Z-ssl-activation');
    assert.equal(nodeResponse.body.certificates.activeCertificates.count, 2);
    assert.equal(nodeResponse.body.certificates.latestActivation.operationType, 'certificate.activate');
    assert.equal(nodeResponse.body.operations.count, 3);

    const configResponse = await request(httpServer)
      .get('/cluster/nodes/node-a/config')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(configResponse.body.config.latestReload.operationId, 'operation-reload-a');
    assert.equal(configResponse.body.config.runtime.currentRelease.status, 'active');

    const certificateResponse = await request(httpServer)
      .get('/cluster/nodes/node-a/certificates')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(certificateResponse.body.certificates.latestSync.operationType, 'certificate.sync');
    assert.equal(certificateResponse.body.certificates.activeCertificates.certificates.length, 2);
    assert.equal(
      certificateResponse.body.certificates.activeCertificates.certificates[0].status,
      'expiring_soon',
    );
  });

  it('returns a stable not-found contract for unknown nodes', async () => {
    const viewerToken = buildAdminToken('viewer');

    const response = await request(httpServer)
      .get('/cluster/nodes/missing-node')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    assert.equal(response.body.found, false);
    assert.match(response.body.message, /not found/i);
  });
});

