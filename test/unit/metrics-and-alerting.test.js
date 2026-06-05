require('reflect-metadata');

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');

const { HealthController } = require('../../src/health/health.controller');
const { HealthService } = require('../../src/health/health.service');
const { MetricsService } = require('../../src/metrics/metrics.service');

function isoDate(offsetMs = 0) {
  return new Date(Date.now() + offsetMs);
}

describe('metrics expansion', () => {
  const originalBackupDir = process.env.BACKUP_DIR;
  const originalOperationStale = process.env.METRICS_CLUSTER_OPERATION_STALE_MAX_AGE_MS;
  const originalOrderStale = process.env.METRICS_CERTIFICATE_ORDER_STALE_MAX_AGE_MS;
  const originalBackupMaxAge = process.env.METRICS_BACKUP_MAX_AGE_MS;
  const originalFailureWindow = process.env.METRICS_CLUSTER_OPERATION_FAILURE_WINDOW_MS;

  let backupDir;

  before(() => {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyttle-metrics-'));
    process.env.BACKUP_DIR = backupDir;
    process.env.METRICS_CLUSTER_OPERATION_STALE_MAX_AGE_MS = '600000';
    process.env.METRICS_CERTIFICATE_ORDER_STALE_MAX_AGE_MS = '1800000';
    process.env.METRICS_BACKUP_MAX_AGE_MS = '86400000';
    process.env.METRICS_CLUSTER_OPERATION_FAILURE_WINDOW_MS = '3600000';

    fs.writeFileSync(
      path.join(backupDir, 'certificates-backup-2026-05-28-00-00-00.lyttlebackup'),
      'encrypted-backup-payload',
      'utf8',
    );
  });

  after(() => {
    fs.rmSync(backupDir, { recursive: true, force: true });

    if (originalBackupDir === undefined) {
      delete process.env.BACKUP_DIR;
    } else {
      process.env.BACKUP_DIR = originalBackupDir;
    }

    if (originalOperationStale === undefined) {
      delete process.env.METRICS_CLUSTER_OPERATION_STALE_MAX_AGE_MS;
    } else {
      process.env.METRICS_CLUSTER_OPERATION_STALE_MAX_AGE_MS = originalOperationStale;
    }

    if (originalOrderStale === undefined) {
      delete process.env.METRICS_CERTIFICATE_ORDER_STALE_MAX_AGE_MS;
    } else {
      process.env.METRICS_CERTIFICATE_ORDER_STALE_MAX_AGE_MS = originalOrderStale;
    }

    if (originalBackupMaxAge === undefined) {
      delete process.env.METRICS_BACKUP_MAX_AGE_MS;
    } else {
      process.env.METRICS_BACKUP_MAX_AGE_MS = originalBackupMaxAge;
    }

    if (originalFailureWindow === undefined) {
      delete process.env.METRICS_CLUSTER_OPERATION_FAILURE_WINDOW_MS;
    } else {
      process.env.METRICS_CLUSTER_OPERATION_FAILURE_WINDOW_MS = originalFailureWindow;
    }
  });

  it('aggregates lease, operation, order, backup, and dependency metrics into JSON and Prometheus formats', async () => {
    const prisma = {
      certificate: {
        findMany: async () => [
          {
            expiresAt: isoDate(45 * 24 * 60 * 60 * 1000),
          },
          {
            expiresAt: isoDate(-2 * 24 * 60 * 60 * 1000),
          },
        ],
      },
      proxyEntry: {
        findMany: async () => [
          { ssl: true, type: 'PROXY' },
          { ssl: false, type: 'REDIRECT' },
        ],
      },
      clusterLease: {
        findMany: async () => [
          {
            leaseName: 'cluster:leader',
            ownerNodeId: 'node-a',
            ownerHostname: 'node-a-host',
            generation: 4,
            ttlSeconds: 30,
            expiresAt: isoDate(20 * 1000),
          },
          {
            leaseName: 'cluster:stale',
            ownerNodeId: 'node-old',
            ownerHostname: 'node-old-host',
            generation: 1,
            ttlSeconds: 30,
            expiresAt: isoDate(-60 * 1000),
          },
        ],
      },
      clusterOperation: {
        findMany: async () => [
          {
            status: 'pending',
            operationType: 'config.reload',
            createdAt: isoDate(-20 * 60 * 1000),
          },
          {
            status: 'failed',
            operationType: 'certificate.activate',
            createdAt: isoDate(-10 * 60 * 1000),
          },
          {
            status: 'succeeded',
            operationType: 'config.reload',
            createdAt: isoDate(-2 * 60 * 1000),
          },
        ],
      },
      clusterOperationAck: {
        findMany: async () => [
          { status: 'succeeded' },
          { status: 'failed' },
          { status: 'pending' },
        ],
      },
      certificateOrder: {
        findMany: async () => [
          {
            status: 'requested',
            updatedAt: isoDate(-40 * 60 * 1000),
            nextRetryAt: null,
          },
          {
            status: 'failed',
            updatedAt: isoDate(-5 * 60 * 1000),
            nextRetryAt: isoDate(5 * 60 * 1000),
          },
          {
            status: 'validating',
            updatedAt: isoDate(-5 * 60 * 1000),
            nextRetryAt: isoDate(-1 * 60 * 1000),
          },
        ],
      },
    };

    const healthService = {
      dependencies: async () => ({
        status: 'error',
        summary: {
          total: 4,
          ok: 2,
          error: 2,
        },
        thresholds: {
          configApplyMaxAgeMs: 900000,
          certificateSyncMaxAgeMs: 900000,
        },
        checks: [
          {
            name: 'database',
            status: 'ok',
            latencyMs: 12,
          },
          {
            name: 'nginx_master',
            status: 'error',
          },
          {
            name: 'config_apply',
            status: 'ok',
          },
          {
            name: 'certificate_sync',
            status: 'error',
          },
        ],
      }),
      getOperationalDependencyState: () => ({
        configApply: {
          status: 'ok',
          ageMs: 30_000,
          maxAgeMs: 900_000,
          lastSuccessAt: isoDate(-30_000).toISOString(),
          lastAttemptAt: isoDate(-20_000).toISOString(),
          lastError: null,
        },
        certificateSync: {
          status: 'error',
          ageMs: 1_000_000,
          maxAgeMs: 900_000,
          lastSuccessAt: isoDate(-1_000_000).toISOString(),
          lastAttemptAt: isoDate(-5_000).toISOString(),
          lastError: 'peer sync failed',
        },
      }),
    };

    const service = new MetricsService(prisma, healthService);
    const metrics = await service.getAllMetrics();

    assert.equal(metrics.collection.errors.length, 0);
    assert.equal(metrics.certificates.total, 2);
    assert.equal(metrics.certificates.valid, 1);
    assert.equal(metrics.certificates.expired, 1);
    assert.equal(metrics.proxies.withSsl, 1);
    assert.equal(metrics.leases.total, 2);
    assert.equal(metrics.leases.active, 1);
    assert.equal(metrics.leases.leader.generation, 4);
    assert.equal(metrics.clusterOperations.active.total, 1);
    assert.equal(metrics.clusterOperations.active.stale, 1);
    assert.equal(metrics.clusterOperations.recentFailures.total, 1);
    assert.equal(metrics.certificateOrders.active, 2);
    assert.equal(metrics.certificateOrders.stale, 1);
    assert.equal(metrics.certificateOrders.retryScheduled, 1);
    assert.equal(metrics.certificateOrders.retryDue, 1);
    assert.equal(metrics.backups.total, 1);
    assert.equal(metrics.backups.freshnessStatus, 1);
    assert.equal(metrics.health.database.status, 'ok');
    assert.equal(metrics.health.nginxMaster.status, 'error');
    assert.equal(metrics.health.operations.certificateSync.lastError, 'peer sync failed');

    const prometheus = service.formatPrometheusMetrics(metrics);
    assert.match(prometheus, /lyttle_cluster_leader_lease_generation 4/);
    assert.match(prometheus, /lyttle_health_dependency_status\{name="nginx_master"\} 0/);
    assert.match(prometheus, /lyttle_db_query_duration_ms 12/);
    assert.match(prometheus, /lyttle_cluster_operations_total\{status="failed"\} 1/);
    assert.match(prometheus, /lyttle_certificate_orders_total\{status="requested"\} 1/);
    assert.match(prometheus, /lyttle_backup_freshness_status 1/);
    assert.match(prometheus, /lyttle_metrics_collection_status\{section="health"\} 1/);
  });

  it('returns section-level collection failures instead of crashing the entire metrics scrape', async () => {
    const prisma = {
      certificate: { findMany: async () => [] },
      proxyEntry: { findMany: async () => [] },
      clusterLease: { findMany: async () => [] },
      clusterOperation: {
        findMany: async () => {
          throw new Error('cluster journal unavailable');
        },
      },
      clusterOperationAck: { findMany: async () => [] },
      certificateOrder: { findMany: async () => [] },
    };

    const healthService = {
      dependencies: async () => ({
        status: 'ok',
        summary: { total: 0, ok: 0, error: 0 },
        thresholds: {
          configApplyMaxAgeMs: 900000,
          certificateSyncMaxAgeMs: 900000,
        },
        checks: [],
      }),
      getOperationalDependencyState: () => ({
        configApply: {
          status: 'ok',
          ageMs: 0,
          maxAgeMs: 900000,
          lastSuccessAt: null,
          lastAttemptAt: null,
          lastError: null,
        },
        certificateSync: {
          status: 'ok',
          ageMs: 0,
          maxAgeMs: 900000,
          lastSuccessAt: null,
          lastAttemptAt: null,
          lastError: null,
        },
      }),
    };

    const service = new MetricsService(prisma, healthService);
    const metrics = await service.getAllMetrics();

    assert.equal(metrics.collection.sections.clusterOperations, 'error');
    assert.equal(metrics.collection.errors.length, 1);
    assert.match(metrics.collection.errors[0].message, /cluster journal unavailable/);

    const prometheus = service.formatPrometheusMetrics(metrics);
    assert.match(
      prometheus,
      /lyttle_metrics_collection_status\{section="clusterOperations"\} 0/,
    );
  });
});

describe('health drilldown endpoints', () => {
  let app;
  let httpServer;
  let dependencyStatus = 'error';
  let deepStatus = 'error';

  const healthServiceMock = {
    live: async () => ({ status: 'ok', probe: 'liveness' }),
    startup: async () => ({ status: 'ok', probe: 'startup' }),
    ready: async () => ({ status: 'ok', probe: 'readiness' }),
    dependencies: async () => ({
      status: dependencyStatus,
      probe: 'dependencies',
      summary: { total: 4, ok: dependencyStatus === 'ok' ? 4 : 2, error: dependencyStatus === 'ok' ? 0 : 2 },
      checks: [],
    }),
    deep: async () => ({
      status: deepStatus,
      probe: 'deep',
      live: { status: 'ok' },
      startup: { status: 'ok' },
      readiness: { status: deepStatus },
      dependencies: { status: dependencyStatus },
    }),
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

  it('returns HTTP 503 for unhealthy dependency and deep-health drilldowns', async () => {
    dependencyStatus = 'error';
    deepStatus = 'error';

    await request(httpServer)
      .get('/health/dependencies')
      .expect(503)
      .expect(({ body }) => assert.equal(body.status, 'error'));

    await request(httpServer)
      .get('/health/deep')
      .expect(503)
      .expect(({ body }) => assert.equal(body.status, 'error'));
  });

  it('returns HTTP 200 once dependency and deep-health drilldowns are healthy', async () => {
    dependencyStatus = 'ok';
    deepStatus = 'ok';

    await request(httpServer)
      .get('/health/dependencies')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));

    await request(httpServer)
      .get('/health/deep')
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, 'ok'));
  });
});

