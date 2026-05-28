require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { APP_GUARD, APP_INTERCEPTOR } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');
const {
  AuthorizationGuard,
} = require('../../src/auth/guards/authorization.guard');
const { AuditInterceptor } = require('../../src/audit/audit.interceptor');
const { AuditService } = require('../../src/audit/audit.service');
const {
  PrivateKeyEncryptionService,
} = require('../../src/certificate/private-key-encryption.service');
const { PrismaService } = require('../../src/prisma/prisma.service');
const { SecurityController } = require('../../src/security/security.controller');
const { SecurityService } = require('../../src/security/security.service');

const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgKxTl2EOJ4qdIDZSD
gHgdj3PXIYhR1gU9hxnOndxEC6ahRANCAATdYQav8MryIyIfh4NV0/1gC+78Kt6J
cq9RgigzG5fsmKUx2zhRf9pjHUH5HDlxbwJTWuLScZaT0PQKiKW1I31A
-----END PRIVATE KEY-----
`;

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
      scope: 'admin:full security:admin',
      name: subject,
    },
    'security-admin-super-secret',
  );
}

function clone(value) {
  return structuredClone(value);
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
  };
}

function flushAuditWrites() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('security administration APIs', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    API_KEY: process.env.API_KEY,
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
    AUTH_DEFAULT_ADMIN_ROLES: process.env.AUTH_DEFAULT_ADMIN_ROLES,
    AUTH_DEFAULT_ADMIN_SCOPES: process.env.AUTH_DEFAULT_ADMIN_SCOPES,
    PRIVATE_KEY_ENCRYPTION_PROVIDER: process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER,
    PRIVATE_KEY_ENCRYPTION_MASTER_KEY:
      process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY,
    PRIVATE_KEY_ENCRYPTION_KEY_VERSION:
      process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION,
    BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY,
    BACKUP_ENCRYPTION_KEY_VERSION: process.env.BACKUP_ENCRYPTION_KEY_VERSION,
    ACME_ACCOUNT_PRIVATE_KEY_PATH: process.env.ACME_ACCOUNT_PRIVATE_KEY_PATH,
    CLUSTER_CONTROL_PROTOCOL: process.env.CLUSTER_CONTROL_PROTOCOL,
  };

  let app;
  let httpServer;
  let acmeTempDir;
  let auditServiceMock;
  let prismaState;

  before(async () => {
    acmeTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyttlenginx-security-admin-'));
    const acmeAccountPath = path.join(acmeTempDir, 'account.pem');
    fs.writeFileSync(acmeAccountPath, 'test-account-key', 'utf8');

    process.env.NODE_ENV = 'test';
    process.env.API_KEY = 'security-admin-existing-admin-key';
    process.env.AUTH_JWT_SECRET = 'security-admin-super-secret';
    process.env.AUTH_JWT_ISSUER = 'lyttle-nginx.test';
    process.env.AUTH_JWT_AUDIENCE = 'lyttle-nginx-admin';
    process.env.AUTH_DEFAULT_ADMIN_ROLES = 'platform-admin';
    process.env.AUTH_DEFAULT_ADMIN_SCOPES = 'admin:full security:admin';
    process.env.PRIVATE_KEY_ENCRYPTION_PROVIDER = 'local';
    process.env.PRIVATE_KEY_ENCRYPTION_MASTER_KEY =
      'security-admin-private-key-master-key';
    process.env.PRIVATE_KEY_ENCRYPTION_KEY_VERSION = 'security-admin-v2';
    process.env.BACKUP_ENCRYPTION_KEY = 'security-admin-backup-key';
    process.env.BACKUP_ENCRYPTION_KEY_VERSION = 'security-admin-backup-v1';
    process.env.ACME_ACCOUNT_PRIVATE_KEY_PATH = acmeAccountPath;
    process.env.CLUSTER_CONTROL_PROTOCOL = 'http';

    prismaState = {
      certificates: [
        {
          id: 'cert-1',
          keyPem: KEY_PEM,
          keyEncryption: null,
          domainsHash: 'domains-hash-cert-1',
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          keyPem: KEY_PEM,
          keyEncryption: null,
          domainsHash: 'domains-hash-cert-1',
          version: 1,
        },
      ],
    };

    const prismaMock = {
      certificate: {
        async findMany() {
          return prismaState.certificates.map(clone);
        },
        async update({ where, data }) {
          const index = prismaState.certificates.findIndex(
            (certificate) => certificate.id === where.id,
          );
          prismaState.certificates[index] = {
            ...prismaState.certificates[index],
            ...data,
          };
          return clone(prismaState.certificates[index]);
        },
      },
      certificateArtifactVersion: {
        async findMany() {
          return prismaState.artifacts.map(clone);
        },
        async update({ where, data }) {
          const index = prismaState.artifacts.findIndex(
            (artifact) => artifact.id === where.id,
          );
          prismaState.artifacts[index] = {
            ...prismaState.artifacts[index],
            ...data,
          };
          return clone(prismaState.artifacts[index]);
        },
      },
    };

    auditServiceMock = createAuditServiceMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [SecurityController],
      providers: [
        AuthService,
        SecurityService,
        PrivateKeyEncryptionService,
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
    fs.rmSync(acmeTempDir, { recursive: true, force: true });

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('lets security-admin review security posture, policy, and access capabilities', async () => {
    const securityAdminToken = buildAdminToken('security-admin');

    const statusResponse = await request(httpServer)
      .get('/security/status')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(200);

    assert.equal(statusResponse.body.auth.apiKeyConfigured, true);
    assert.equal(statusResponse.body.auth.apiKeyCount, 1);
    assert.equal(statusResponse.body.secrets.status, 'ok');
    assert.equal(statusResponse.body.privateKeyEncryption.keyVersion, 'security-admin-v2');
    assert.equal(statusResponse.body.interNodeSecurity.mtlsEnabled, false);
    assert.equal(
      statusResponse.body.breakGlass.rawCertificateExport.requiredRole,
      'platform-admin',
    );

    const policyResponse = await request(httpServer)
      .get('/security/policy')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(200);

    assert.equal(policyResponse.body.rotationFlows.length, 3);
    assert.equal(policyResponse.body.breakGlassFlows[0].endpoint, 'GET /certificates/backup/export/:id');

    const accessReviewResponse = await request(httpServer)
      .get('/security/access-review')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .expect(200);

    assert.equal(accessReviewResponse.body.actor.subject, 'security-admin-user');
    assert.equal(accessReviewResponse.body.accessibleCapabilities.rotatePrivateKeyEncryption, true);
    assert.equal(accessReviewResponse.body.accessibleCapabilities.planApiKeyRotation, false);
  });

  it('lets platform-admin plan API key rotation and request a bridge bearer token', async () => {
    const platformAdminToken = buildAdminToken('platform-admin', 'platform-admin-a');

    const response = await request(httpServer)
      .post('/security/rotate/api-key')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        nextApiKey: 'NextRotationKey-SecurityAdmin-!A9xYz321',
        retireApiKeyId: 'missing-api-key-id',
        issueBridgeToken: true,
        reason: 'quarterly credential rotation',
      })
      .expect(200);

    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.strategy, 'manual-overlap-env-rotation');
    assert.equal(response.body.current.configuredKeyCount, 1);
    assert.equal(response.body.candidate.valid, true);
    assert.equal(response.body.candidate.maskedPreview, 'Next…z321');
    assert.equal(response.body.migrationBridge.issued, true);
    assert.match(response.body.migrationBridge.token.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(
      response.body.current.retireTarget.requestedApiKeyId,
      'missing-api-key-id',
    );
    assert.equal(response.body.current.retireTarget.found, false);
  });

  it('re-encrypts stored private keys on demand and exposes the deferred internal-cert rotation hook', async () => {
    const securityAdminToken = buildAdminToken('security-admin', 'security-admin-b');
    const platformAdminToken = buildAdminToken('platform-admin', 'platform-admin-b');

    const dryRunResponse = await request(httpServer)
      .post('/security/rotate/private-key-encryption')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({
        confirmKeyVersion: 'security-admin-v2',
        dryRun: true,
        reason: 'preflight',
      })
      .expect(200);

    assert.equal(dryRunResponse.body.status, 'dry-run');
    assert.equal(dryRunResponse.body.provider.keyVersion, 'security-admin-v2');

    const rotateResponse = await request(httpServer)
      .post('/security/rotate/private-key-encryption')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({
        confirmKeyVersion: 'security-admin-v2',
        reason: 'activate rotated master key version',
      })
      .expect(200);

    assert.equal(rotateResponse.body.status, 'completed');
    assert.equal(rotateResponse.body.certificatesUpdated, 1);
    assert.equal(rotateResponse.body.artifactsUpdated, 1);
    assert.doesNotMatch(prismaState.certificates[0].keyPem, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(prismaState.artifacts[0].keyPem, /BEGIN PRIVATE KEY/);

    const internalCertResponse = await request(httpServer)
      .post('/security/rotate/internal-certs')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        reason: 'prepare future node PKI rotation contract',
        maintenanceWindow: '2026-05-28T23:00:00Z/2026-05-29T00:00:00Z',
      })
      .expect(200);

    assert.equal(internalCertResponse.body.supported, false);
    assert.equal(internalCertResponse.body.status, 'not-configured');
    assert.equal(internalCertResponse.body.currentTransport.mtlsEnabled, false);
    assert.equal(internalCertResponse.body.futureContract.endpoint, 'POST /security/rotate/internal-certs');
  });

  it('denies lower-privilege actors and audits both successful and denied security administration calls', async () => {
    const operatorToken = buildAdminToken('operator', 'operator-user');
    const securityAdminToken = buildAdminToken('security-admin', 'security-admin-c');

    await request(httpServer)
      .get('/security/status')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);

    await flushAuditWrites();

    const deniedEvent = auditServiceMock.events.at(-1);
    assert.equal(deniedEvent.action, 'security.status.review');
    assert.equal(deniedEvent.outcome, 'denied');
    assert.equal(deniedEvent.responseStatus, 403);
    assert.equal(deniedEvent.actor.subject, 'operator-user');

    await request(httpServer)
      .post('/security/rotate/private-key-encryption')
      .set('Authorization', `Bearer ${securityAdminToken}`)
      .send({ confirmKeyVersion: 'security-admin-v2' })
      .expect(200);

    await flushAuditWrites();

    const successEvent = auditServiceMock.events.at(-1);
    assert.equal(successEvent.action, 'security.private-key-encryption.rotate');
    assert.equal(successEvent.outcome, 'success');
    assert.equal(successEvent.actor.subject, 'security-admin-c');
  });
});

