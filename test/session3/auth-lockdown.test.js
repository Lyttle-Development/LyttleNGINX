require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const request = require('supertest');
const { ValidationPipe } = require('@nestjs/common');
const { APP_GUARD } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');

const { AuthController } = require('../../src/auth/auth.controller');
const { AuthService } = require('../../src/auth/auth.service');
const { ApiKeyGuard } = require('../../src/auth/guards/api-key.guard');

class CertificateService {}
class TlsConfigService {}
class CertificateBackupService {}
class HealthService {}
class MetricsService {}
class PrismaService {}
class ReloaderService {}

const originalLoad = Module._load;
const moduleStubs = new Map([
  ['./certificate.service', { CertificateService }],
  ['./certificate-backup.service', { CertificateBackupService }],
  ['./tls-config.service', { TlsConfigService }],
  ['./health.service', { HealthService }],
  ['./metrics.service', { MetricsService }],
  ['../prisma/prisma.service', { PrismaService }],
  ['./reloader/reloader.service', { ReloaderService }],
]);

Module._load = function loadWithStubs(request, parent, isMain) {
  if (moduleStubs.has(request)) {
    return moduleStubs.get(request);
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { AppController } = require('../../src/app.controller');
const { AcmeController } = require('../../src/certificate/acme.controller');
const { BackupController } = require('../../src/certificate/backup.controller');
const { CertificateController } = require('../../src/certificate/certificate.controller');
const { TlsController } = require('../../src/certificate/tls.controller');
const { HealthController } = require('../../src/health/health.controller');
const { MetricsController } = require('../../src/metrics/metrics.controller');

Module._load = originalLoad;

const testApiKey = 'session3-test-key';
const originalApiKey = process.env.API_KEY;
const originalNodeEnv = process.env.NODE_ENV;

const certificateServiceMock = {
  listCertificates: async () => [],
  getCertificateInfo: async (id) => ({ id, domains: ['example.com'] }),
  uploadCertificate: async (dto) => ({
    id: 'cert-1',
    domains: dto.domains,
  }),
  generateSelfSignedCertificate: async (domains) => ({
    id: 'cert-2',
    domains,
  }),
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
  dhParamsExist: () => false,
  getCertificateInfo: async () => ({ subject: 'CN=example.com' }),
  validateCertificateChain: async () => ({ valid: true }),
};

const backupServiceMock = {
  createBackup: async () => ({ filename: 'backup.zip' }),
  listBackups: async () => [],
  getBackupStream: async () => undefined,
  deleteBackup: async () => undefined,
  importCertificates: async () => ({ imported: 0 }),
  exportCertificate: async (id) => ({ id }),
};

const reloaderServiceMock = {
  reloadConfig: async () => ({ ok: true }),
};

const healthServiceMock = {
  live: async () => ({ status: 'ok' }),
  ready: async () => ({ status: 'ok' }),
};

const metricsServiceMock = {
  getCertificateMetrics: async () => ({
    total: 0,
    valid: 0,
    expiringSoon: 0,
    expired: 0,
    avgDaysUntilExpiry: 0,
  }),
  getProxyMetrics: async () => ({
    total: 0,
    withSsl: 0,
    withoutSsl: 0,
    proxies: 0,
    redirects: 0,
  }),
  formatPrometheusMetrics: () => 'lyttle_certificates_total 0',
};

const prismaServiceMock = {
  acmeChallenge: {
    findUnique: async () => null,
    delete: async () => undefined,
  },
};

describe('Session 3 endpoint lockdown', () => {
  let app;
  let httpServer;

  before(async () => {
    process.env.API_KEY = testApiKey;
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AppController,
        AuthController,
        AcmeController,
        BackupController,
        CertificateController,
        TlsController,
        HealthController,
        MetricsController,
      ],
      providers: [
        AuthService,
        {
          provide: APP_GUARD,
          useClass: ApiKeyGuard,
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
          provide: ReloaderService,
          useValue: reloaderServiceMock,
        },
        {
          provide: HealthService,
          useValue: healthServiceMock,
        },
        {
          provide: MetricsService,
          useValue: metricsServiceMock,
        },
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
    httpServer = app.getHttpServer();
  });

  after(async () => {
    await app?.close();

    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('rejects unauthenticated mutating endpoints with 401', async () => {
    const cases = [
      {
        method: 'post',
        url: '/certificates/upload',
        body: {
          domains: ['example.com'],
          certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
          keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
        },
      },
      {
        method: 'post',
        url: '/certificates/generate-self-signed',
        body: { domains: ['example.com'] },
      },
      {
        method: 'post',
        url: '/certificates/sync',
      },
      {
        method: 'post',
        url: '/tls/dhparam',
        body: { bits: 1024 },
      },
      {
        method: 'post',
        url: '/reload',
      },
    ];

    for (const testCase of cases) {
      let req = request(httpServer)[testCase.method](testCase.url);
      if (testCase.body) {
        req = req.send(testCase.body);
      }

      await req.expect(401);
    }
  });

  it('keeps the explicit public allowlist reachable without authentication', async () => {
    await request(httpServer)
      .get('/health')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));

    await request(httpServer)
      .get('/ready')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));

    await request(httpServer)
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect((response) => {
        assert.match(response.text, /lyttle_certificates_total 0/);
      });

    await request(httpServer)
      .get('/metrics/json')
      .expect(200)
      .expect(({ body }) => assert.equal(body.certificates.total, 0));

    await request(httpServer)
      .get('/.well-known/acme-challenge/test-token')
      .expect(404);
  });

  it('protects non-public admin reads by default', async () => {
    await request(httpServer).get('/certificates').expect(401);
    await request(httpServer).get('/auth/info').expect(401);
  });

  it('rejects invalid API keys on protected endpoints', async () => {
    await request(httpServer)
      .post('/certificates/sync')
      .set('X-API-Key', 'wrong-key')
      .expect(401);

    await request(httpServer)
      .get('/certificates')
      .set('Authorization', 'ApiKey wrong-key')
      .expect(401);
  });

  it('allows authenticated admin requests to reach their handlers', async () => {
    await request(httpServer)
      .get('/certificates')
      .set('X-API-Key', testApiKey)
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body, []));

    await request(httpServer)
      .get('/auth/status')
      .set('X-API-Key', testApiKey)
      .expect(200)
      .expect(({ body }) => assert.equal(body.authenticated, true));

    await request(httpServer)
      .post('/certificates/upload')
      .set('Authorization', `ApiKey ${testApiKey}`)
      .send({
        domains: ['example.com'],
        certPem: '-----BEGIN CERTIFICATE-----\nMIIB\n',
        keyPem: '-----BEGIN PRIVATE KEY-----\nMIIB\n',
      })
      .expect(201)
      .expect(({ body }) => assert.deepEqual(body.domains, ['example.com']));

    await request(httpServer)
      .post('/tls/dhparam')
      .set('X-API-Key', testApiKey)
      .send({ bits: 1024 })
      .expect(202)
      .expect(({ body }) => {
        assert.match(body.message, /started in background/i);
      });
  });
});

