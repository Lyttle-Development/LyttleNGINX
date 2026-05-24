require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const Module = require('node:module');
const request = require('supertest');
const { APP_GUARD, APP_INTERCEPTOR } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');
const {
  AuthorizationGuard,
} = require('../../src/auth/guards/authorization.guard');
const { AuditInterceptor } = require('../../src/audit/audit.interceptor');
const { AuditController } = require('../../src/audit/audit.controller');
const { AuditService } = require('../../src/audit/audit.service');

class CertificateService {}
class ClusterHeartbeatService {}
class DistributedLockService {}
class ReloaderService {}

const originalLoad = Module._load;
const moduleStubs = new Map([
  ['./certificate.service', { CertificateService }],
  ['./cluster-heartbeat.service', { ClusterHeartbeatService }],
  ['./distributed-lock.service', { DistributedLockService }],
  ['./reloader/reloader.service', { ReloaderService }],
  ['../reloader/reloader.service', { ReloaderService }],
]);

Module._load = function loadWithStubs(requestName, parent, isMain) {
  if (moduleStubs.has(requestName)) {
    return moduleStubs.get(requestName);
  }

  return originalLoad.call(this, requestName, parent, isMain);
};

const {
  CertificateController,
} = require('../../src/certificate/certificate.controller');
const {
  ClusterController,
} = require('../../src/distributed-lock/cluster.controller');

Module._load = originalLoad;

function signHs256Token(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function buildAdminToken(role, subject = `${role}-user`) {
  const now = Math.floor(Date.now() / 1000);
  return signHs256Token(
    {
      sub: subject,
      iss: 'lyttle-nginx.test',
      aud: 'lyttle-nginx-admin',
      iat: now,
      nbf: now,
      exp: now + 300,
      actor_type: 'admin',
      roles: [role],
      scope: 'admin:full',
      name: subject,
    },
    'session9-super-secret',
  );
}

function createAuditServiceMock() {
  return {
    events: [],
    async recordEvent(event) {
      this.events.push({
        id: `event-${this.events.length + 1}`,
        occurredAt: new Date().toISOString(),
        ...event,
      });
    },
    async listEvents(options) {
      return this.events
        .slice()
        .reverse()
        .filter((event) => {
          if (options.action && !event.action.includes(options.action)) {
            return false;
          }
          if (
            options.actorSubject &&
            event.actor?.subject &&
            !event.actor.subject.includes(options.actorSubject)
          ) {
            return false;
          }
          if (
            options.correlationId &&
            event.correlationId !== options.correlationId
          ) {
            return false;
          }
          if (options.outcome && event.outcome !== options.outcome) {
            return false;
          }
          return true;
        })
        .slice(0, options.limit);
    },
  };
}

function flushAuditWrites() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Session 9 audit logging', () => {
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
  let auditServiceMock;

  const certificateServiceMock = {
    async listCertificates() {
      return [];
    },
    async getCertificateInfo(id) {
      return { id, domains: ['example.com'] };
    },
    async uploadCertificate(dto) {
      if (dto.domains.includes('broken.example.com')) {
        throw new Error('certificate upload failed');
      }

      return {
        id: 'cert-uploaded-1',
        domains: dto.domains,
      };
    },
    async generateSelfSignedCertificate(domains) {
      return { id: 'cert-self-signed-1', domains };
    },
    async renewCertificateById(id) {
      return { id, renewed: true };
    },
    async renewAllCertificates() {
      return undefined;
    },
    async deleteCertificate() {
      return undefined;
    },
    async validateDomainForCertificate(domain) {
      return { domain, valid: true };
    },
    async checkAllCertificatesOcspSupport() {
      return { supported: true };
    },
    async syncCertificates() {
      return { synced: true };
    },
  };

  const clusterHeartbeatServiceMock = {
    async getActiveNodes() {
      return [];
    },
    async getClusterStats() {
      return { total: 0, active: 0, leaders: [] };
    },
    async getLeaderNode() {
      return null;
    },
    async manualCleanup() {
      return { cleaned: 0 };
    },
    async manualEnforceLeader() {
      return { enforced: true };
    },
    async ensureLeaderExists() {
      return undefined;
    },
    async tryBecomeLeader() {
      return true;
    },
  };

  const distributedLockServiceMock = {
    getInstanceId() {
      return 'node-1';
    },
    getLeaderLockStatus() {
      return {
        isLeader: true,
        instanceId: 'node-1',
        heldForMs: 1000,
      };
    },
  };

  const reloaderServiceMock = {
    async reloadConfig() {
      return { ok: true };
    },
  };

  before(async () => {
    process.env.API_KEY = 'session9-legacy-key';
    process.env.AUTH_JWT_SECRET = 'session9-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';
    process.env.AUTH_DEFAULT_ADMIN_ROLES = 'platform-admin';
    process.env.AUTH_DEFAULT_ADMIN_SCOPES = 'admin:full';

    auditServiceMock = createAuditServiceMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController, CertificateController, ClusterController],
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
          provide: APP_INTERCEPTOR,
          useClass: AuditInterceptor,
        },
        {
          provide: AuditService,
          useValue: auditServiceMock,
        },
        {
          provide: CertificateService,
          useValue: certificateServiceMock,
        },
        {
          provide: ClusterHeartbeatService,
          useValue: clusterHeartbeatServiceMock,
        },
        {
          provide: DistributedLockService,
          useValue: distributedLockServiceMock,
        },
        {
          provide: ReloaderService,
          useValue: reloaderServiceMock,
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

  it('records successful mutating certificate actions with actor, target, and correlation id', async () => {
    const securityAdminToken = buildAdminToken('security-admin');

    const response = await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({
        domains: ['example.com', 'www.example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(201);

    await flushAuditWrites();

    const uploadEvent = auditServiceMock.events.at(-1);
    assert.equal(uploadEvent.action, 'certificate.upload');
    assert.equal(uploadEvent.outcome, 'success');
    assert.equal(uploadEvent.responseStatus, 201);
    assert.equal(uploadEvent.actor.subject, 'security-admin-user');
    assert.equal(uploadEvent.target.type, 'certificate');
    assert.equal(uploadEvent.target.id, 'cert-uploaded-1');
    assert.equal(uploadEvent.target.label, 'example.com,www.example.com');
    assert.match(uploadEvent.correlationId, /.+/);
    assert.equal(
      response.headers['x-correlation-id'],
      uploadEvent.correlationId,
    );
  });

  it('records controller-level failures for protected mutating routes', async () => {
    const securityAdminToken = buildAdminToken(
      'security-admin',
      'security-admin-b',
    );

    await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({
        domains: ['broken.example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(400);

    await flushAuditWrites();

    const failureEvent = auditServiceMock.events.at(-1);
    assert.equal(failureEvent.action, 'certificate.upload');
    assert.equal(failureEvent.outcome, 'failure');
    assert.equal(failureEvent.responseStatus, 400);
    assert.match(failureEvent.errorMessage, /failed/i);
    assert.equal(failureEvent.actor.subject, 'security-admin-b');
  });

  it('records denied privileged attempts before controller execution', async () => {
    const operatorToken = buildAdminToken('operator');

    await request(httpServer)
      .get('/cluster/admin/become-leader')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await flushAuditWrites();

    const deniedEvent = auditServiceMock.events.at(-1);
    assert.equal(deniedEvent.action, 'cluster.become-leader');
    assert.equal(deniedEvent.outcome, 'denied');
    assert.equal(deniedEvent.responseStatus, 403);
    assert.equal(deniedEvent.actor.subject, 'operator-user');
    assert.match(deniedEvent.errorMessage, /insufficient permissions/i);
  });

  it('records unauthenticated protected mutations as denied audit events', async () => {
    await request(httpServer)
      .post('/certificates/upload')
      .send({
        domains: ['unauth.example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(401);

    await flushAuditWrites();

    const deniedEvent = auditServiceMock.events.at(-1);
    assert.equal(deniedEvent.action, 'certificate.upload');
    assert.equal(deniedEvent.outcome, 'denied');
    assert.equal(deniedEvent.responseStatus, 401);
    assert.equal(deniedEvent.actor, undefined);
    assert.match(deniedEvent.errorMessage, /credentials are required/i);
  });

  it('exposes recent audit events through the security-admin review endpoint', async () => {
    const securityAdminToken = buildAdminToken(
      'security-admin',
      'auditor-user',
    );

    const response = await request(httpServer)
      .get('/audit?limit=2&action=certificate.upload')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(200);

    assert.equal(response.body.count, 2);
    assert.equal(response.body.events.length, 2);
    assert.equal(response.body.events[0].action, 'certificate.upload');
    assert.equal(response.body.events[1].action, 'certificate.upload');
  });
});
