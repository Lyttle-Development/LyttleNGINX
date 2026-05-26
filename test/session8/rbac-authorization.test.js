require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const Module = require('node:module');
const request = require('supertest');
const { APP_GUARD } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthController } = require('../../src/auth/auth.controller');
const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');
const {
  AuthorizationGuard,
} = require('../../src/auth/guards/authorization.guard');

class CertificateService {}
class TlsConfigService {}
class CertificateBackupService {}
class ClusterHeartbeatService {}
class ClusterOperationsService {}
class DistributedLockService {}
class ReloaderService {}
class LogsService {}

const originalLoad = Module._load;
const moduleStubs = new Map([
  ['./certificate.service', { CertificateService }],
  ['./certificate-backup.service', { CertificateBackupService }],
  ['./tls-config.service', { TlsConfigService }],
  ['./cluster-heartbeat.service', { ClusterHeartbeatService }],
  ['./cluster-operations.service', { ClusterOperationsService }],
  ['./distributed-lock.service', { DistributedLockService }],
  ['./reloader/reloader.service', { ReloaderService }],
  ['../reloader/reloader.service', { ReloaderService }],
  ['./logs.service', { LogsService }],
]);

Module._load = function loadWithStubs(requestName, parent, isMain) {
  if (moduleStubs.has(requestName)) {
    return moduleStubs.get(requestName);
  }

  return originalLoad.call(this, requestName, parent, isMain);
};

const { AppController } = require('../../src/app.controller');
const { CertificateController } = require('../../src/certificate/certificate.controller');
const { BackupController } = require('../../src/certificate/backup.controller');
const { TlsController } = require('../../src/certificate/tls.controller');
const { ClusterController } = require('../../src/distributed-lock/cluster.controller');
const { LogsController } = require('../../src/logs/logs.controller');

Module._load = originalLoad;

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
      scope: 'admin:full',
      name: `${role}-user`,
    },
    'session8-super-secret',
  );
}

function buildInternalNodeToken() {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Token(
    {
      sub: 'node-a',
      iss: 'lyttle-nginx.test',
      aud: 'lyttle-nginx-admin',
      iat: now,
      nbf: now,
      exp: now + 300,
      actor_type: 'internal-node',
      node_id: 'node-a',
      scope: 'cluster:internal node:sync',
      name: 'swarm-node-a',
    },
    'session8-super-secret',
  );
}

describe('Session 8 RBAC authorization policies', () => {
  const originalEnv = {
    API_KEY: process.env.API_KEY,
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
    AUTH_DEFAULT_ADMIN_ROLES: process.env.AUTH_DEFAULT_ADMIN_ROLES,
    AUTH_DEFAULT_ADMIN_SCOPES: process.env.AUTH_DEFAULT_ADMIN_SCOPES,
  };

  let app;
  let httpServer;

  const certificateServiceMock = {
    listCertificates: async () => [],
    getCertificateInfo: async (id) => ({ id, domains: ['example.com'] }),
    uploadCertificate: async (dto) => ({ id: 'cert-1', domains: dto.domains }),
    generateSelfSignedCertificate: async (domains) => ({ id: 'cert-2', domains }),
    renewCertificateById: async (id) => ({ id, renewed: true }),
    renewAllCertificates: async () => undefined,
    deleteCertificate: async () => undefined,
    validateDomainForCertificate: async (domain) => ({ domain, valid: true }),
    checkAllCertificatesOcspSupport: async () => ({ supported: true }),
    syncCertificates: async () => ({ synced: true }),
  };

  const tlsConfigServiceMock = {
    getRecommendedTlsConfig: async (domain) => ({ domain, config: 'recommended' }),
    testTlsConnection: async (domain) => ({ domain, ok: true }),
    generateDhParams: async () => undefined,
    dhParamsExist: () => true,
    getCertificateInfo: async () => ({ subject: 'CN=example.com' }),
    validateCertificateChain: async () => ({ valid: true }),
  };

  const backupServiceMock = {
    createBackup: async () => ({ filename: 'backup.zip' }),
    listBackups: async () => [],
    getBackupStream: async () => undefined,
    deleteBackup: async () => undefined,
    importCertificates: async () => ({ imported: 0 }),
    exportCertificate: async (id) => ({ id, exported: true }),
  };

  const clusterHeartbeatServiceMock = {
    getActiveNodes: async () => [
      {
        id: 'node-1',
        hostname: 'node-1',
        instanceId: 'node-1',
        ipAddress: '10.0.0.1',
        controlPlaneAddress: 'node-1.internal',
        controlPlanePort: 3000,
        controlPlaneProtocol: 'http',
        isLeader: true,
        status: 'active',
        lastHeartbeat: new Date('2026-05-24T00:00:00Z').toISOString(),
        version: '0.0.1',
        metadata: {},
      },
    ],
    getClusterStats: async () => ({
      total: 1,
      active: 1,
      leaders: [
        {
          hostname: 'node-1',
          instanceId: 'node-1',
          ipAddress: '10.0.0.1',
          controlPlaneAddress: 'node-1.internal',
          controlPlanePort: 3000,
          controlPlaneProtocol: 'http',
          status: 'active',
          lastHeartbeat: new Date('2026-05-24T00:00:00Z').toISOString(),
          metadata: {},
        },
      ],
    }),
    getLeaderNode: async () => ({
      id: 'node-1',
      hostname: 'node-1',
      instanceId: 'node-1',
      ipAddress: '10.0.0.1',
      controlPlaneAddress: 'node-1.internal',
      controlPlanePort: 3000,
      controlPlaneProtocol: 'http',
      status: 'active',
      lastHeartbeat: new Date('2026-05-24T00:00:00Z').toISOString(),
      version: '0.0.1',
      metadata: {},
    }),
    manualCleanup: async () => ({ cleaned: 0 }),
    manualEnforceLeader: async () => ({ enforced: true }),
    ensureLeaderExists: async () => undefined,
    tryBecomeLeader: async () => true,
  };

  const distributedLockServiceMock = {
    getInstanceId: () => 'node-1',
    getLeaderLockStatus: () => ({
      isLeader: true,
      instanceId: 'node-1',
      heldForMs: 1000,
    }),
  };

   const clusterOperationsServiceMock = {
    enqueueBroadcastOperation: async () => ({
      operationId: 'operation-1',
      status: 'pending',
      scope: 'cluster',
      operationType: 'cluster.reload',
      targetNodeCount: 1,
      completedNodeCount: 0,
      successfulNodeCount: 0,
      failedNodeCount: 0,
      createdAt: new Date('2026-05-24T00:00:00Z').toISOString(),
      startedAt: null,
      completedAt: null,
      correlationId: null,
      requestPath: '/cluster/reload',
      operationStatusPath: '/cluster/operations/operation-1',
    }),
    listOperations: async () => ({ count: 0, operations: [] }),
    getOperation: async () => null,
  };

  const reloaderServiceMock = {
    reloadConfig: async () => ({ ok: true }),
  };

  const logsServiceMock = {
    getLastLogs: (count) => Array.from({ length: count }, (_, index) => `log-${index + 1}`),
  };

  before(async () => {
    process.env.API_KEY = 'session8-legacy-key';
    process.env.AUTH_JWT_SECRET = 'session8-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';
    process.env.AUTH_DEFAULT_ADMIN_ROLES = 'platform-admin';
    process.env.AUTH_DEFAULT_ADMIN_SCOPES = 'admin:full cluster:read';

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AppController,
        AuthController,
        BackupController,
        CertificateController,
        TlsController,
        ClusterController,
        LogsController,
      ],
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
          provide: CertificateService,
          useValue: certificateServiceMock,
        },
        {
          provide: TlsConfigService,
          useValue: tlsConfigServiceMock,
        },
        {
          provide: CertificateBackupService,
          useValue: backupServiceMock,
        },
        {
          provide: ClusterHeartbeatService,
          useValue: clusterHeartbeatServiceMock,
        },
        {
          provide: ClusterOperationsService,
          useValue: clusterOperationsServiceMock,
        },
        {
          provide: DistributedLockService,
          useValue: distributedLockServiceMock,
        },
        {
          provide: ReloaderService,
          useValue: reloaderServiceMock,
        },
        {
          provide: LogsService,
          useValue: logsServiceMock,
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

  it('allows viewer reads but blocks operator and security-admin actions', async () => {
    const viewerToken = buildAdminToken('viewer');

    await request(httpServer)
      .get('/certificates')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body, []));

    await request(httpServer)
      .get('/cluster/nodes')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) => assert.equal(body.count, 1));

    await request(httpServer)
      .post('/reload')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        domains: ['example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(403);

    await request(httpServer)
      .get('/certificates/backup')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('allows operator actions but blocks security-admin and platform-admin endpoints', async () => {
    const operatorToken = buildAdminToken('operator');

    await request(httpServer)
      .post('/reload')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => assert.equal(body.success, true));

    await request(httpServer)
      .post('/certificates/renew-all')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => {
        assert.match(body.message, /initiated/i);
      });

    await request(httpServer)
      .get('/logs?count=2')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body.logs, ['log-1', 'log-2']));

    await request(httpServer)
      .get('/certificates/backup')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await request(httpServer)
      .get('/cluster/admin/become-leader')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('allows security-admin certificate and backup operations but blocks platform actions', async () => {
    const securityAdminToken = buildAdminToken('security-admin');

    await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({
        domains: ['example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(201)
      .expect(({ body }) => assert.deepEqual(body.domains, ['example.com']));

    await request(httpServer)
      .get('/certificates/backup')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body, []));

    await request(httpServer)
      .post('/tls/dhparam')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({ bits: 1024 })
      .expect(202)
      .expect(({ body }) => {
        assert.match(body.message, /started in background/i);
      });

    await request(httpServer)
      .get('/certificates/backup/export/cert-1')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(403);

    await request(httpServer)
      .post('/reload')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(403);

    await request(httpServer)
      .get('/cluster/admin/become-leader')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(403);
  });

  it('allows platform-admin to inherit viewer, operator, and security-admin permissions', async () => {
    const platformAdminToken = buildAdminToken('platform-admin');

    await request(httpServer)
      .get('/certificates')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    await request(httpServer)
      .post('/reload')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        domains: ['example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(201);

    await request(httpServer)
      .get('/certificates/backup')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    await request(httpServer)
      .get('/certificates/backup/export/cert-1')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);

    await request(httpServer)
      .get('/cluster/admin/become-leader')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200)
      .expect(({ body }) => assert.equal(body.success, true));

    await request(httpServer)
      .post('/certificates/sync')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200)
      .expect(({ body }) => assert.equal(body.synced, true));
  });

  it('allows internal-node identities on internal routes only', async () => {
    const internalNodeToken = buildInternalNodeToken();

    await request(httpServer)
      .get('/auth/me')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.identity.actorType, 'internal-node');
        assert.equal(body.identity.nodeId, 'node-a');
      });

    await request(httpServer)
      .post('/certificates/sync')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(200)
      .expect(({ body }) => assert.equal(body.synced, true));

    await request(httpServer)
      .get('/auth/info')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(403);

    await request(httpServer)
      .get('/certificates')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(403);

    await request(httpServer)
      .get('/cluster/admin/become-leader')
      .set('Authorization', `Bearer ${internalNodeToken}`)
      .expect(403);
  });

  it('keeps legacy API keys compatible and exposes the RBAC role catalog', async () => {
    await request(httpServer)
      .get('/auth/info')
      .set('X-API-Key', 'session8-legacy-key')
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(body.supportedRoles, [
          'viewer',
          'operator',
          'security-admin',
          'platform-admin',
          'internal-node',
        ]);
        assert.deepEqual(body.roleHierarchy['platform-admin'], [
          'viewer',
          'operator',
          'security-admin',
        ]);
        assert.deepEqual(body.defaultAdminRoles, ['platform-admin']);
        assert.deepEqual(body.defaultAdminScopes, ['admin:full cluster:read']);
      });

    await request(httpServer)
      .get('/cluster/admin/ensure-leader')
      .set('X-API-Key', 'session8-legacy-key')
      .expect(200)
      .expect(({ body }) => assert.equal(body.success, true));
  });
});

