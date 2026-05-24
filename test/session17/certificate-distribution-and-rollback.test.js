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

const originalAdminEmail = process.env.ADMIN_EMAIL;
const originalExecFile = childProcess.execFile;

function resetModules() {
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(certificateOrderServicePath)];
}

function installExecFileStub(handler) {
  const calls = [];

  childProcess.execFile = (command, args, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    calls.push({ command, args: [...args], options: { ...options } });

    Promise.resolve()
      .then(() => handler({ command, args, options, calls }))
      .then((result) => callback?.(null, result?.stdout ?? '', result?.stderr ?? ''))
      .catch((error) => callback?.(error, '', error?.stderr ?? ''));

    return {
      stdin: {
        end() {},
      },
    };
  };

  return calls;
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

function createPrismaMock(clusterState) {
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

  function getCertificate(where) {
    if (where.id) {
      return state.certificates.find((entry) => entry.id === where.id) ?? null;
    }

    if (where.domainsHash) {
      return (
        state.certificates.find((entry) => entry.domainsHash === where.domainsHash) ??
        null
      );
    }

    return null;
  }

  function getOrderById(id) {
    return state.orders.find((entry) => entry.id === id) ?? null;
  }

  function matchesArtifactWhere(artifact, where = {}) {
    if (typeof where.id === 'string' && artifact.id !== where.id) {
      return false;
    }
    if (where.orderId && artifact.orderId !== where.orderId) {
      return false;
    }
    if (where.domainsHash && artifact.domainsHash !== where.domainsHash) {
      return false;
    }
    if (where.isCurrent !== undefined && artifact.isCurrent !== where.isCurrent) {
      return false;
    }
    if (where.version?.lt !== undefined && !(artifact.version < where.version.lt)) {
      return false;
    }
    if (where.activatedAt?.not === null && artifact.activatedAt === null) {
      return false;
    }
    if (where.id?.not && artifact.id === where.id.not) {
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
          createdAt: now,
          updatedAt: now,
          failureReason: data.failureReason ?? null,
          retryAfter: data.retryAfter ?? null,
          failureCount: data.failureCount ?? 0,
          issuedByNode: data.issuedByNode ?? null,
          ...data,
        };
        state.certificates.push(certificate);
        return clone(certificate);
      },
      async findFirst() {
        return null;
      },
      async findUnique({ where }) {
        const certificate = getCertificate(where);
        return certificate ? clone(certificate) : null;
      },
      async update({ where, data }) {
        const certificate = getCertificate(where);
        if (!certificate) {
          throw new Error(`Certificate not found for update: ${JSON.stringify(where)}`);
        }
        applyDataPatch(certificate, data);
        certificate.updatedAt = new Date();
        return clone(certificate);
      },
      async findMany() {
        return state.certificates.map(clone);
      },
      async count() {
        return 0;
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
        const results = state.orders.filter((order) => {
          if (where?.domainsHash && order.domainsHash !== where.domainsHash) {
            return false;
          }
          if (typeof where?.status === 'string' && order.status !== where.status) {
            return false;
          }
          if (where?.status?.in && !where.status.in.includes(order.status)) {
            return false;
          }
          if (where?.sourceType && order.sourceType !== where.sourceType) {
            return false;
          }
          if (where?.nextRetryAt?.lte && !(order.nextRetryAt && order.nextRetryAt <= where.nextRetryAt.lte)) {
            return false;
          }
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          results.sort((left, right) => right.createdAt - left.createdAt);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where, include, select } = {}) {
        const order = getOrderById(where.id);
        if (!order) {
          return null;
        }
        if (select) {
          const selected = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              selected[key] = order[key];
            }
          }
          return clone(selected);
        }
        if (!include) {
          return clone(order);
        }
        const record = clone(order);
        if (include.events) {
          record.events = state.events
            .filter((entry) => entry.orderId === order.id)
            .sort((left, right) => right.occurredAt - left.occurredAt)
            .map(clone);
        }
        if (include.artifacts) {
          record.artifacts = state.artifacts
            .filter((entry) => entry.orderId === order.id)
            .sort((left, right) => right.version - left.version)
            .map(clone);
        }
        return record;
      },
      async update({ where, data }) {
        const order = getOrderById(where.id);
        if (!order) {
          throw new Error(`Order not found for update: ${where.id}`);
        }
        applyDataPatch(order, data);
        order.updatedAt = new Date();
        return clone(order);
      },
      async findMany({ where, take } = {}) {
        return state.orders
          .filter((order) => {
            if (where?.sourceType && order.sourceType !== where.sourceType) {
              return false;
            }
            if (where?.status && order.status !== where.status) {
              return false;
            }
            if (where?.nextRetryAt?.lte && !(order.nextRetryAt && order.nextRetryAt <= where.nextRetryAt.lte)) {
              return false;
            }
            return true;
          })
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
          occurredAt: data.occurredAt ?? new Date(),
          details: data.details ?? null,
          ...data,
        };
        state.events.push(event);
        return clone(event);
      },
    },
    certificateArtifactVersion: {
      async findFirst({ where, orderBy } = {}) {
        const results = state.artifacts.filter((artifact) =>
          matchesArtifactWhere(artifact, where),
        );
        if (orderBy?.version === 'desc') {
          results.sort((left, right) => right.version - left.version);
        }
        return results[0] ? clone(results[0]) : null;
      },
      async findUnique({ where }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        return artifact ? clone(artifact) : null;
      },
      async create({ data }) {
        state.artifactSequence += 1;
        const artifact = {
          id: `artifact-${state.artifactSequence}`,
          createdAt: new Date(),
          activatedAt: data.activatedAt ?? null,
          isCurrent: data.isCurrent ?? false,
          distributionStatus: data.distributionStatus ?? null,
          distributionOperationId: data.distributionOperationId ?? null,
          distributionCompletedAt: data.distributionCompletedAt ?? null,
          metadata: data.metadata ?? null,
          ...data,
        };
        state.artifacts.push(artifact);
        return clone(artifact);
      },
      async update({ where, data }) {
        const artifact = state.artifacts.find((entry) => entry.id === where.id) ?? null;
        if (!artifact) {
          throw new Error(`Artifact not found for update: ${where.id}`);
        }
        applyDataPatch(artifact, data);
        return clone(artifact);
      },
      async updateMany({ where, data }) {
        const matches = state.artifacts.filter((artifact) =>
          matchesArtifactWhere(artifact, where),
        );
        for (const artifact of matches) {
          applyDataPatch(artifact, data);
        }
        return { count: matches.length };
      },
    },
    clusterOperation: {
      async findUnique({ where }) {
        const operation =
          clusterState.operations.find((entry) => entry.id === where.id) ?? null;
        return operation ? clone(operation) : null;
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
  process.env.ADMIN_EMAIL = 'session17@example.test';
  resetModules();
  const { CertificateOrderService } = require(certificateOrderServicePath);
  const { CertificateService } = require(certificateServicePath);

  const clusterState = {
    sequence: 0,
    mode: 'succeeded',
    operations: [],
  };
  const prisma = createPrismaMock(clusterState);
  const orderService = new CertificateOrderService(prisma);
  const alertService = {
    sendAlert: async () => undefined,
  };
  const clusterOperations = {
    async enqueueBroadcastOperation(options) {
      clusterState.sequence += 1;
      const operationId = `op-${clusterState.sequence}`;
      await options.localAction(operationId);
      const operation =
        clusterState.mode === 'succeeded'
          ? {
              id: operationId,
              status: 'succeeded',
              completedAt: new Date(),
              acknowledgements: [
                {
                  nodeInstanceId: 'node-1',
                  nodeHostname: 'node-1',
                  endpointUrl: null,
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
                {
                  nodeInstanceId: 'node-2',
                  nodeHostname: 'node-2',
                  endpointUrl: 'http://node-2.internal:3000/certificates/artifacts/activate',
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
              ],
            }
          : {
              id: operationId,
              status: 'partially_failed',
              completedAt: new Date(),
              acknowledgements: [
                {
                  nodeInstanceId: 'node-1',
                  nodeHostname: 'node-1',
                  endpointUrl: null,
                  status: 'succeeded',
                  responseStatus: 200,
                  errorMessage: null,
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'activated' },
                },
                {
                  nodeInstanceId: 'node-2',
                  nodeHostname: 'node-2',
                  endpointUrl: 'http://node-2.internal:3000/certificates/artifacts/activate',
                  status: 'failed',
                  responseStatus: 500,
                  errorMessage: 'node-2 failed activation',
                  startedAt: new Date(),
                  ackedAt: new Date(),
                  details: { status: 'failed' },
                },
              ],
            };
      clusterState.operations.push(operation);
      return { operationId };
    },
    async waitForOperationToSettle(operationId) {
      const operation =
        clusterState.operations.find((entry) => entry.id === operationId) ?? null;
      if (!operation) {
        throw new Error(`Unknown operation: ${operationId}`);
      }
      return clone(operation);
    },
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

  return { prisma, orderService, service, clusterState };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'session17@example.test';
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
});

describe('Session 17 cluster certificate distribution and activation', () => {
  it('retries failed distribution by reusing the stored artifact instead of reissuing certificate material', async () => {
    let certificateSequence = 0;
    const calls = installExecFileStub(async ({ command, args }) => {
      if (command === 'nginx') {
        return { stdout: '' };
      }

      assert.equal(command, 'openssl');

      if (args[0] === 'genrsa') {
        fs.writeFileSync(
          args[2],
          '-----BEGIN PRIVATE KEY-----\nunit-test\n-----END PRIVATE KEY-----\n',
        );
        return { stdout: '' };
      }

      if (args[0] === 'req') {
        certificateSequence += 1;
        const outIndex = args.indexOf('-out');
        fs.writeFileSync(
          args[outIndex + 1],
          `-----BEGIN CERTIFICATE-----\nversion-${certificateSequence}\n-----END CERTIFICATE-----\n`,
        );
        return { stdout: '' };
      }

      if (args[0] === 'x509' && args.includes('-pubkey')) {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'pkey') {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'x509' && args.includes('-enddate')) {
        return { stdout: 'notAfter=Jan  1 00:00:00 2035 GMT\n' };
      }

      if (args[0] === 'x509' && args.includes('-text')) {
        return {
          stdout: `Certificate Data\nX509v3 Subject Alternative Name:\n    DNS:example.com\n`,
        };
      }

      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    const { orderService, service, clusterState } = createHarness();
    clusterState.mode = 'partially_failed';
    service.writeCertToFs = () => undefined;

    await assert.rejects(
      () => service.generateSelfSignedCertificate(['Example.com']),
      /node-2 failed activation/,
    );

    const failedList = await orderService.listOrders();
    const failedOrder = await orderService.getOrder(failedList.orders[0].id);

    assert.equal(failedOrder.status, 'failed');
    assert.equal(failedOrder.artifacts.length, 1);
    assert.equal(failedOrder.artifacts[0].distributionStatus, 'partially_failed');
    assert.equal(failedOrder.latestDistribution?.acknowledgements.length, 2);
    assert.equal(certificateSequence, 1);

    clusterState.mode = 'succeeded';
    const retriedOrder = await service.retryCertificateOrder(failedOrder.id);

    assert.equal(retriedOrder.status, 'activated');
    assert.equal(retriedOrder.artifacts.length, 1);
    assert.equal(retriedOrder.artifacts[0].isCurrent, true);
    assert.equal(retriedOrder.artifacts[0].distributionStatus, 'succeeded');
    assert.equal(retriedOrder.latestDistribution?.status, 'succeeded');
    assert.equal(certificateSequence, 1);
    assert.equal(
      calls.filter((call) => call.command === 'openssl' && call.args[0] === 'req').length,
      1,
    );
  });

  it('supports rolling back to the prior activated artifact version', async () => {
    let certificateSequence = 0;
    installExecFileStub(async ({ command, args }) => {
      if (command === 'nginx') {
        return { stdout: '' };
      }

      assert.equal(command, 'openssl');

      if (args[0] === 'genrsa') {
        fs.writeFileSync(
          args[2],
          `-----BEGIN PRIVATE KEY-----\nkey-${certificateSequence + 1}\n-----END PRIVATE KEY-----\n`,
        );
        return { stdout: '' };
      }

      if (args[0] === 'req') {
        certificateSequence += 1;
        const outIndex = args.indexOf('-out');
        fs.writeFileSync(
          args[outIndex + 1],
          `-----BEGIN CERTIFICATE-----\nversion-${certificateSequence}\n-----END CERTIFICATE-----\n`,
        );
        return { stdout: '' };
      }

      if (args[0] === 'x509' && args.includes('-pubkey')) {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'pkey') {
        return { stdout: 'unit-test-public-key\n' };
      }

      if (args[0] === 'x509' && args.includes('-enddate')) {
        return { stdout: 'notAfter=Jan  1 00:00:00 2035 GMT\n' };
      }

      if (args[0] === 'x509' && args.includes('-text')) {
        return {
          stdout: `Certificate Data\nX509v3 Subject Alternative Name:\n    DNS:example.com\n`,
        };
      }

      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    const { prisma, orderService, service } = createHarness();
    service.writeCertToFs = () => undefined;

    const firstCertificate = await service.generateSelfSignedCertificate(['example.com']);
    const secondCertificate = await service.generateSelfSignedCertificate(['example.com']);
    const rolledBack = await service.rollbackCertificate(secondCertificate.id);
    const rollbackOrder = await orderService.getOrder(rolledBack.orderId);
    const currentArtifacts = prisma.state.artifacts.filter((artifact) => artifact.isCurrent);
    const certificateRecord = prisma.state.certificates[0];

    assert.equal(firstCertificate.id, secondCertificate.id);
    assert.equal(rolledBack.rollbackToVersion, 1);
    assert.equal(rollbackOrder.status, 'activated');
    assert.equal(rollbackOrder.latestDistribution?.status, 'succeeded');
    assert.equal(currentArtifacts.length, 1);
    assert.equal(currentArtifacts[0].version, 1);
    assert.match(certificateRecord.certPem, /version-1/);
  });
});

