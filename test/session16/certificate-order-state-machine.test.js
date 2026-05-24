require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const certificateServicePath = path.join(
  repoRoot,
  'src/certificate/certificate.service.ts',
);
const certificateOrderServicePath = path.join(
  repoRoot,
  'src/certificate/certificate-order.service.ts',
);
const domainUtilsPath = path.join(repoRoot, 'src/utils/domain-utils.ts');

const originalAdminEmail = process.env.ADMIN_EMAIL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalExecFile = childProcess.execFile;

function resetModules() {
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(certificateOrderServicePath)];
  delete require.cache[require.resolve(domainUtilsPath)];
}

function installExecFileStub(handler) {
  childProcess.execFile = (command, args, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const stdin = {
      end() {},
    };

    Promise.resolve()
      .then(() => handler({ command, args, options }))
      .then((result) => callback?.(null, result?.stdout ?? '', result?.stderr ?? ''))
      .catch((error) => callback?.(error, '', error?.stderr ?? ''));

    return { stdin };
  };
}

function restoreExecFile() {
  childProcess.execFile = originalExecFile;
}

function clone(value) {
  return structuredClone(value);
}

function applyDataPatch(record, data) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, 'increment')
    ) {
      record[key] = (record[key] ?? 0) + value.increment;
      continue;
    }

    record[key] = value;
  }
}

function createPrismaMock() {
  const state = {
    certificateSequence: 0,
    orderSequence: 0,
    eventSequence: 0,
    artifactSequence: 0,
    certificates: [],
    orders: [],
    events: [],
    artifacts: [],
  };

  function getCertificateById(id) {
    return state.certificates.find((certificate) => certificate.id === id) ?? null;
  }

  function getOrderById(id) {
    return state.orders.find((order) => order.id === id) ?? null;
  }

  function matchesCertificateWhere(certificate, where = {}) {
    if (where.id && certificate.id !== where.id) {
      return false;
    }
    if (where.domainsHash && certificate.domainsHash !== where.domainsHash) {
      return false;
    }
    if (where.isOrphaned !== undefined && certificate.isOrphaned !== where.isOrphaned) {
      return false;
    }
    if (where.domains?.contains && !certificate.domains.includes(where.domains.contains)) {
      return false;
    }
    if (where.expiresAt?.gt && !(certificate.expiresAt > where.expiresAt.gt)) {
      return false;
    }
    if (where.issuedAt?.gte && !(certificate.issuedAt >= where.issuedAt.gte)) {
      return false;
    }
    if (where.retryAfter?.lte && !(certificate.retryAfter && certificate.retryAfter <= where.retryAfter.lte)) {
      return false;
    }
    if (where.status && certificate.status !== where.status) {
      return false;
    }
    return true;
  }

  function matchesOrderWhere(order, where = {}) {
    if (where.id && order.id !== where.id) {
      return false;
    }
    if (where.domainsHash && order.domainsHash !== where.domainsHash) {
      return false;
    }
    if (where.sourceType && order.sourceType !== where.sourceType) {
      return false;
    }
    if (typeof where.status === 'string' && order.status !== where.status) {
      return false;
    }
    if (where.status?.in && !where.status.in.includes(order.status)) {
      return false;
    }
    if (where.nextRetryAt?.lte && !(order.nextRetryAt && order.nextRetryAt <= where.nextRetryAt.lte)) {
      return false;
    }
    return true;
  }

  return {
    state,
    certificate: {
      async create({ data }) {
        state.certificateSequence += 1;
        const now = new Date();
        const certificate = {
          id: `cert-${state.certificateSequence}`,
          status: data.status ?? 'active',
          failureReason: data.failureReason ?? null,
          retryAfter: data.retryAfter ?? null,
          failureCount: data.failureCount ?? 0,
          issuedByNode: data.issuedByNode ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          ...data,
        };
        state.certificates.push(certificate);
        return clone(certificate);
      },
      async findFirst({ where, orderBy } = {}) {
        const results = state.certificates.filter((certificate) =>
          matchesCertificateWhere(certificate, where),
        );
        if (orderBy?.expiresAt === 'desc') {
          results.sort((left, right) => right.expiresAt - left.expiresAt);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where }) {
        const certificate = where.id
          ? getCertificateById(where.id)
          : state.certificates.find(
              (entry) => entry.domainsHash === where.domainsHash,
            ) ?? null;
        return certificate ? clone(certificate) : null;
      },
      async update({ where, data }) {
        const certificate = where.id
          ? getCertificateById(where.id)
          : state.certificates.find(
              (entry) => entry.domainsHash === where.domainsHash,
            ) ?? null;
        if (!certificate) {
          throw new Error(`Certificate not found for update: ${JSON.stringify(where)}`);
        }
        applyDataPatch(certificate, data);
        certificate.updatedAt = new Date();
        return clone(certificate);
      },
      async upsert({ where, update, create }) {
        const existing = state.certificates.find(
          (certificate) => certificate.domainsHash === where.domainsHash,
        );
        if (existing) {
          applyDataPatch(existing, update);
          existing.updatedAt = new Date();
          return clone(existing);
        }
        return this.create({ data: create });
      },
      async findMany({ where, orderBy } = {}) {
        const results = state.certificates.filter((certificate) =>
          matchesCertificateWhere(certificate, where),
        );
        if (orderBy?.expiresAt === 'asc') {
          results.sort((left, right) => left.expiresAt - right.expiresAt);
        }
        return results.map(clone);
      },
      async count({ where } = {}) {
        return state.certificates.filter((certificate) =>
          matchesCertificateWhere(certificate, where),
        ).length;
      },
      async delete() {
        return undefined;
      },
    },
    certificateOrder: {
      async create({ data }) {
        state.orderSequence += 1;
        const now = new Date();
        const order = {
          id: `order-${state.orderSequence}`,
          sourceType: data.sourceType ?? 'acme',
          status: data.status ?? 'requested',
          attemptCount: data.attemptCount ?? 1,
          retryCount: data.retryCount ?? 0,
          nextRetryAt: data.nextRetryAt ?? null,
          lastError: data.lastError ?? null,
          requestedByNode: data.requestedByNode ?? null,
          certificateId: data.certificateId ?? null,
          requestedAt: data.requestedAt ?? now,
          startedAt: data.startedAt ?? null,
          challengePublishedAt: data.challengePublishedAt ?? null,
          validatingAt: data.validatingAt ?? null,
          issuedAt: data.issuedAt ?? null,
          distributingAt: data.distributingAt ?? null,
          activatedAt: data.activatedAt ?? null,
          failedAt: data.failedAt ?? null,
          revokedAt: data.revokedAt ?? null,
          completedAt: data.completedAt ?? null,
          metadata: data.metadata ?? null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.orders.push(order);
        return clone(order);
      },
      async findFirst({ where, orderBy } = {}) {
        const results = state.orders.filter((order) => matchesOrderWhere(order, where));
        if (orderBy?.createdAt === 'desc') {
          results.sort((left, right) => right.createdAt - left.createdAt);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where, include } = {}) {
        const order = getOrderById(where.id);
        if (!order) {
          return null;
        }
        if (!include) {
          return clone(order);
        }
        const record = clone(order);
        if (include.events) {
          record.events = state.events
            .filter((event) => event.orderId === order.id)
            .sort((left, right) => right.occurredAt - left.occurredAt)
            .map(clone);
        }
        if (include.artifacts) {
          record.artifacts = state.artifacts
            .filter((artifact) => artifact.orderId === order.id)
            .sort((left, right) => right.version - left.version)
            .map(clone);
        }
        return record;
      },
      async update({ where, data }) {
        const order = getOrderById(where.id);
        if (!order) {
          throw new Error(`Certificate order not found: ${where.id}`);
        }
        applyDataPatch(order, data);
        order.updatedAt = new Date();
        return clone(order);
      },
      async findMany({ where, take } = {}) {
        return state.orders
          .filter((order) => matchesOrderWhere(order, where))
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, take ?? state.orders.length)
          .map(clone);
      },
    },
    certificateOrderEvent: {
      async create({ data }) {
        state.eventSequence += 1;
        const event = {
          id: `event-${state.eventSequence}`,
          ...data,
          details: data.details ?? null,
          occurredAt: data.occurredAt ?? new Date(),
        };
        state.events.push(event);
        return clone(event);
      },
    },
    certificateArtifactVersion: {
      async findFirst({ where, orderBy } = {}) {
        const results = state.artifacts.filter((artifact) => {
          if (where?.domainsHash && artifact.domainsHash !== where.domainsHash) {
            return false;
          }
          return true;
        });
        if (orderBy?.version === 'desc') {
          results.sort((left, right) => right.version - left.version);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async create({ data }) {
        state.artifactSequence += 1;
        const artifact = {
          id: `artifact-${state.artifactSequence}`,
          createdAt: new Date(),
          activatedAt: data.activatedAt ?? null,
          metadata: data.metadata ?? null,
          ...data,
        };
        state.artifacts.push(artifact);
        return clone(artifact);
      },
    },
    proxyEntry: {
      async findMany() {
        return [];
      },
    },
  };
}

function createHarness() {
  process.env.ADMIN_EMAIL = 'session16@example.test';
  resetModules();
  const { CertificateOrderService } = require(certificateOrderServicePath);
  const { CertificateService } = require(certificateServicePath);

  const prisma = createPrismaMock();
  const alertService = {
    sendAlert: async () => undefined,
  };
  const orderService = new CertificateOrderService(prisma);
  const clusterOperations = {
    enqueueBroadcastOperation: async () => ({ operationId: 'op-1' }),
  };
  const distributedLock = {
    getInstanceId: () => 'node-1',
    withLock: async (_name, fn) => fn(),
    acquireLeaderLock: async () => false,
    releaseLeaderLock: async () => undefined,
    releaseAllLocks: async () => undefined,
    isLeader: async () => false,
  };
  const healthService = {
    recordCertificateSyncFailure() {},
    recordCertificateSyncSuccess() {},
  };
  const service = new CertificateService(
    prisma,
    alertService,
    orderService,
    clusterOperations,
    distributedLock,
    healthService,
    null,
  );

  service.writeCertToFs = () => undefined;

  return { prisma, service, orderService };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'session16@example.test';
  delete process.env.NODE_ENV;
  restoreExecFile();
  resetModules();
});

afterEach(() => {
  restoreExecFile();
  resetModules();

  if (originalAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL;
  } else {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe('Session 16 certificate order state machine', () => {
  it('records self-signed certificate workflows as durable orders with artifact history', async () => {
    installExecFileStub(async ({ command, args }) => {
      assert.equal(command, 'openssl');

      if (args[0] === 'genrsa') {
        fs.writeFileSync(
          args[2],
          '-----BEGIN PRIVATE KEY-----\nunit-test\n-----END PRIVATE KEY-----\n',
        );
        return { stdout: '' };
      }

      if (args[0] === 'req') {
        const outIndex = args.indexOf('-out');
        fs.writeFileSync(
          args[outIndex + 1],
          '-----BEGIN CERTIFICATE-----\nunit-test\n-----END CERTIFICATE-----\n',
        );
        return { stdout: '' };
      }

      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    const { service, orderService } = createHarness();
    const record = await service.generateSelfSignedCertificate(['Example.com']);
    const orders = await orderService.listOrders();
    const detail = await orderService.getOrder(orders.orders[0].id);

    assert.equal(record.domains, 'example.com');
    assert.equal(orders.count, 1);
    assert.equal(orders.orders[0].status, 'activated');
    assert.equal(orders.orders[0].sourceType, 'self-signed');
    assert.equal(detail.artifacts.length, 1);
    assert.equal(detail.artifacts[0].certificateId, record.id);
    assert.equal(detail.artifacts[0].version, 1);
    assert.equal(detail.artifacts[0].sourceType, 'self-signed');
    assert.equal(Object.hasOwn(detail.artifacts[0], 'keyPem'), false);
    assert.equal(detail.events.length, 5);
    assert.equal(
      detail.events.filter((event) => event.eventType === 'state-transition')
        .length,
      3,
    );
    assert.equal(
      detail.events.some((event) => event.eventType === 'artifact-created'),
      true,
    );
    assert.equal(
      detail.events.some((event) => event.eventType === 'created'),
      true,
    );
    assert.deepEqual(
      detail.events
        .filter((event) => event.toStatus)
        .map((event) => event.toStatus)
        .sort(),
      ['activated', 'distributing', 'issued', 'requested'].sort(),
    );
  });

  it('persists failure history and resumes the same ACME order on manual retry', async () => {
    process.env.DATABASE_URL = 'not-a-postgresql-url';
    const { service, orderService, prisma } = createHarness();
    const { hashDomains } = require(domainUtilsPath);
    const domains = ['example.com'];
    const domainsHash = hashDomains(domains, { allowWildcard: true });

    await assert.rejects(
      () => service.ensureCertificate(domains),
      /Could not parse DATABASE_URL/,
    );

    const firstList = await orderService.listOrders();
    const failedOrder = await orderService.getOrder(firstList.orders[0].id);

    assert.equal(failedOrder.status, 'failed');
    assert.equal(failedOrder.retryCount, 0);
    assert.equal(failedOrder.attemptCount, 1);
    assert.ok(failedOrder.nextRetryAt instanceof Date);
    assert.match(failedOrder.lastError ?? '', /Could not parse DATABASE_URL/);
    assert.equal(
      failedOrder.events.some((event) => event.eventType === 'retry-scheduled'),
      true,
    );

    const futureExpiry = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    prisma.state.certificates.push({
      id: 'cert-existing',
      domains: 'example.com',
      domainsHash,
      certPem: '-----BEGIN CERTIFICATE-----\nexisting\n-----END CERTIFICATE-----\n',
      keyPem: '-----BEGIN PRIVATE KEY-----\nexisting\n-----END PRIVATE KEY-----\n',
      expiresAt: futureExpiry,
      issuedAt: new Date(),
      lastUsedAt: new Date(),
      isOrphaned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
      failureReason: null,
      retryAfter: null,
      failureCount: 0,
      issuedByNode: 'node-2',
    });

    const retriedOrder = await service.retryCertificateOrder(failedOrder.id);

    assert.equal(retriedOrder.id, failedOrder.id);
    assert.equal(retriedOrder.status, 'activated');
    assert.equal(retriedOrder.retryCount, 1);
    assert.equal(retriedOrder.attemptCount, 2);
    assert.equal(retriedOrder.certificateId, 'cert-existing');
    assert.equal(retriedOrder.lastError, null);
    assert.equal(
      retriedOrder.events.some((event) => event.eventType === 'retry-requested'),
      true,
    );
    assert.equal(
      retriedOrder.events.some(
        (event) =>
          event.toStatus === 'activated' &&
          /Reused existing valid certificate/i.test(event.message ?? ''),
      ),
      true,
    );
  });
});

