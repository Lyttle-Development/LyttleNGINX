require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Module = require('node:module');
const fsPromises = require('node:fs/promises');
const { Test } = require('@nestjs/testing');

class PrismaService {}

const originalLoad = Module._load;
Module._load = function loadWithPrismaStub(request, parent, isMain) {
  if (request === '../prisma/prisma.service') {
    return { PrismaService };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { HealthController } = require('../../src/health/health.controller');
const { HealthService } = require('../../src/health/health.service');

Module._load = originalLoad;

const originalAccess = fsPromises.access;
const originalReadFile = fsPromises.readFile;
const originalKill = process.kill;
const originalConfigMaxAge = process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS;
const originalCertSyncMaxAge = process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS;

function stubHealthyNginx(pid = 4242) {
  fsPromises.access = async () => undefined;
  fsPromises.readFile = async () => `${pid}\n`;
  process.kill = (targetPid, signal) => {
    assert.equal(targetPid, pid);
    assert.equal(signal, 0);
    return true;
  };
}

function restoreProcessAndFs() {
  fsPromises.access = originalAccess;
  fsPromises.readFile = originalReadFile;
  process.kill = originalKill;
}

describe('Session 4 health service semantics', () => {
  before(() => {
    process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS = '60000';
    process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS = '60000';
  });

  after(() => {
    restoreProcessAndFs();

    if (originalConfigMaxAge === undefined) {
      delete process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS;
    } else {
      process.env.HEALTH_CONFIG_APPLY_MAX_AGE_MS = originalConfigMaxAge;
    }

    if (originalCertSyncMaxAge === undefined) {
      delete process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS;
    } else {
      process.env.HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS = originalCertSyncMaxAge;
    }
  });

  it('keeps startup and readiness unhealthy until initialization milestones succeed', async () => {
    stubHealthyNginx();

    const prisma = {
      $queryRawUnsafe: async () => [{ '?column?': 1 }],
    };
    const service = new HealthService(prisma);

    const liveReport = await service.live();
    assert.equal(liveReport.status, 'ok');
    assert.equal(liveReport.probe, 'liveness');

    const startupReport = await service.startup();
    assert.equal(startupReport.status, 'starting');
    assert.deepEqual(
      startupReport.checks.map((check) => check.name),
      ['config_apply', 'certificate_sync'],
    );

    const readyReport = await service.ready();
    assert.equal(readyReport.status, 'error');
    assert.equal(
      readyReport.checks.find((check) => check.name === 'database').status,
      'ok',
    );
    assert.equal(
      readyReport.checks.find((check) => check.name === 'nginx_master').status,
      'ok',
    );
    assert.equal(
      readyReport.checks.find((check) => check.name === 'config_apply').status,
      'error',
    );
    assert.equal(
      readyReport.checks.find((check) => check.name === 'certificate_sync').status,
      'error',
    );
  });

  it('reports startup and readiness healthy after successful config apply and certificate sync', async () => {
    stubHealthyNginx(5252);

    const prisma = {
      $queryRawUnsafe: async () => [{ '?column?': 1 }],
    };
    const service = new HealthService(prisma);

    service.recordConfigApplySuccess('reload completed');
    service.recordCertificateSyncSuccess('sync completed');

    const startupReport = await service.startup();
    assert.equal(startupReport.status, 'ok');

    const readyReport = await service.ready();
    assert.equal(readyReport.status, 'ok');
    assert.equal(
      readyReport.checks.find((check) => check.name === 'config_apply').status,
      'ok',
    );
    assert.equal(
      readyReport.checks.find((check) => check.name === 'certificate_sync').status,
      'ok',
    );
  });

  it('fails readiness when the latest successful state is superseded by a failed attempt', async () => {
    stubHealthyNginx(6262);

    const prisma = {
      $queryRawUnsafe: async () => [{ '?column?': 1 }],
    };
    const service = new HealthService(prisma);

    service.recordConfigApplySuccess('reload completed');
    service.recordCertificateSyncSuccess('sync completed');
    service.recordCertificateSyncFailure('sync job failed on latest attempt');

    const startupReport = await service.startup();
    assert.equal(startupReport.status, 'ok');

    const readyReport = await service.ready();
    assert.equal(readyReport.status, 'error');
    assert.match(
      readyReport.checks.find((check) => check.name === 'certificate_sync').details,
      /latest attempt failed/i,
    );
  });
});

describe('Session 4 health controller probes', () => {
  let app;
  let httpServer;
  let startupStatus = 'starting';
  let readyStatus = 'error';

  const healthServiceMock = {
    live: async () => ({ status: 'ok', probe: 'liveness' }),
    startup: async () => ({ status: startupStatus, probe: 'startup' }),
    ready: async () => ({ status: readyStatus, probe: 'readiness' }),
  };

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthServiceMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  after(async () => {
    await app?.close();
  });

  it('keeps the liveness endpoint and legacy alias on HTTP 200', async () => {
    await request(httpServer)
      .get('/health/live')
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.status, 'ok');
        assert.equal(body.probe, 'liveness');
      });

    await request(httpServer)
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.status, 'ok');
        assert.equal(body.probe, 'liveness');
      });
  });

  it('returns 503 for startup and readiness while the node is not yet safe to receive traffic', async () => {
    startupStatus = 'starting';
    readyStatus = 'error';

    await request(httpServer)
      .get('/health/startup')
      .expect(503)
      .expect(({ body }) => assert.equal(body.status, 'starting'));

    await request(httpServer)
      .get('/health/ready')
      .expect(503)
      .expect(({ body }) => assert.equal(body.status, 'error'));

    await request(httpServer)
      .get('/ready')
      .expect(503)
      .expect(({ body }) => assert.equal(body.status, 'error'));
  });

  it('returns 200 from startup and readiness once dependencies are healthy', async () => {
    startupStatus = 'ok';
    readyStatus = 'ok';

    await request(httpServer)
      .get('/health/startup')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));

    await request(httpServer)
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));

    await request(httpServer)
      .get('/ready')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));
  });
});

