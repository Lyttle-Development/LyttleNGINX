require('reflect-metadata');

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const acmeStrategyPath = path.join(
  repoRoot,
  'src/certificate/acme-strategy.ts',
);
const certificateServicePath = path.join(
  repoRoot,
  'src/certificate/certificate.service.ts',
);
const acmeControllerPath = path.join(
  repoRoot,
  'src/certificate/acme.controller.ts',
);

const originalAdminEmail = process.env.ADMIN_EMAIL;

function resetModules() {
  delete require.cache[require.resolve(acmeStrategyPath)];
  delete require.cache[require.resolve(certificateServicePath)];
  delete require.cache[require.resolve(acmeControllerPath)];
}

function createCertificateService(prisma) {
  process.env.ADMIN_EMAIL = 'session18@example.test';
  resetModules();
  const { CertificateService } = require(certificateServicePath);

  return new CertificateService(
    prisma,
    { sendAlert: async () => undefined },
    {
      listOrders: async () => ({ count: 0, orders: [] }),
      getOrder: async () => ({ id: 'order-1' }),
      getArtifact: async () => null,
      getCurrentArtifactForDomainsHash: async () => null,
      getRollbackArtifactForDomainsHash: async () => null,
      transitionOrder: async () => undefined,
      markFailure: async () => undefined,
      completeWithCertificate: async () => undefined,
      getOrCreateOrder: async () => ({ id: 'order-1', attemptCount: 1, metadata: null }),
      recordArtifact: async () => ({ id: 'artifact-1', version: 1 }),
      validateRetryableOrder: async () => ({ id: 'order-1', domains: 'example.com', sourceType: 'acme' }),
      resumeOrder: async () => undefined,
      getLatestArtifactForOrder: async () => null,
    },
    {
      enqueueBroadcastOperation: async () => ({ operationId: 'op-1' }),
      waitForOperationToSettle: async () => ({
        status: 'succeeded',
        completedAt: new Date(),
        acknowledgements: [],
      }),
    },
    {
      getInstanceId: () => 'node-1',
      withLock: async (_name, fn) => fn(),
      acquireLeaderLock: async () => false,
      releaseLeaderLock: async () => undefined,
      releaseAllLocks: async () => undefined,
      isLeader: async () => false,
    },
    {
      recordCertificateSyncFailure() {},
      recordCertificateSyncSuccess() {},
    },
    null,
  );
}

function createResponseCapture() {
  return {
    statusCode: null,
    contentTypeValue: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    contentType(value) {
      this.contentTypeValue = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = 'session18@example.test';
  resetModules();
});

afterEach(() => {
  resetModules();
  if (originalAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL;
  } else {
    process.env.ADMIN_EMAIL = originalAdminEmail;
  }
});

describe('Session 18 ACME strategy hardening', () => {
  it('builds the built-in HTTP-01 certbot plan with database-backed challenge publication', () => {
    const { buildAcmeCertbotPlan } = require(acmeStrategyPath);

    const plan = buildAcmeCertbotPlan({
      domains: ['example.com', 'www.example.com'],
      adminEmail: 'admin@example.com',
      orderId: 'order-http',
      instanceId: 'node-http',
      env: {
        DATABASE_URL:
          'postgresql://demo-user:demo-pass@db.internal:5433/lyttlenginx?schema=public',
        ACME_CHALLENGE_STRATEGY: 'http-01',
        ACME_HTTP01_PROPAGATION_SECONDS: '7',
      },
    });

    assert.equal(plan.challengeType, 'http-01');
    assert.equal(plan.provider, 'database-http-01');
    assert.match(
      plan.args.join(' '),
      /--preferred-challenges=http .*--manual-auth-hook=\/certbot-auth-hook\.sh .*--manual-cleanup-hook=\/certbot-cleanup-hook\.sh/,
    );
    assert.equal(plan.env.DB_USER, 'demo-user');
    assert.equal(plan.env.DB_PASSWORD, 'demo-pass');
    assert.equal(plan.env.DB_HOST, 'db.internal');
    assert.equal(plan.env.DB_PORT, '5433');
    assert.equal(plan.env.DB_NAME, 'lyttlenginx');
    assert.equal(plan.env.LYTTLE_ACME_ORDER_ID, 'order-http');
    assert.equal(plan.env.ACME_HTTP01_PROPAGATION_SECONDS, '7');
    assert.deepEqual(plan.metadata, {
      requestedStrategy: 'http-01',
      challengeType: 'http-01',
      provider: 'database-http-01',
      wildcard: false,
      sharedChallengeStore: true,
      challengeStore: 'database-http',
      visibleInChallengeApi: true,
      propagationSeconds: 7,
    });
  });

  it('auto-selects DNS-01 for wildcard domains and requires external DNS hooks', () => {
    const { buildAcmeCertbotPlan } = require(acmeStrategyPath);

    const plan = buildAcmeCertbotPlan({
      domains: ['*.example.com', 'example.com'],
      adminEmail: 'admin@example.com',
      orderId: 'order-dns',
      instanceId: 'node-dns',
      env: {
        ACME_CHALLENGE_STRATEGY: 'auto',
        ACME_DNS_PROVIDER: 'route53-manual',
        ACME_DNS_AUTH_HOOK: '/opt/acme/dns-auth.sh',
        ACME_DNS_CLEANUP_HOOK: '/opt/acme/dns-cleanup.sh',
        ACME_DNS_PROPAGATION_SECONDS: '45',
        LETSENCRYPT_STAGING: 'true',
      },
    });

    assert.equal(plan.challengeType, 'dns-01');
    assert.equal(plan.provider, 'route53-manual');
    assert.match(
      plan.args.join(' '),
      /--preferred-challenges=dns .*--test-cert .*--manual-auth-hook=\/opt\/acme\/dns-auth\.sh .*--manual-cleanup-hook=\/opt\/acme\/dns-cleanup\.sh/,
    );
    assert.equal(plan.env.DB_USER, undefined);
    assert.equal(plan.env.LYTTLE_ACME_ORDER_ID, 'order-dns');
    assert.equal(plan.env.ACME_DNS_PROPAGATION_SECONDS, '45');
    assert.deepEqual(plan.metadata, {
      requestedStrategy: 'auto',
      challengeType: 'dns-01',
      provider: 'route53-manual',
      wildcard: true,
      sharedChallengeStore: false,
      challengeStore: 'external-dns',
      visibleInChallengeApi: false,
      propagationSeconds: 45,
    });
  });

  it('lists recent ACME challenges through the certificate service with status filtering', async () => {
    const challenges = [
      {
        id: 'challenge-1',
        orderId: 'order-1',
        token: 'token-1',
        domain: 'example.com',
        challengeType: 'http-01',
        provider: 'database-http-01',
        status: 'presented',
        metadata: { providerState: 'published' },
        createdAt: new Date('2026-05-24T15:30:00.000Z'),
        presentedAt: new Date('2026-05-24T15:30:00.000Z'),
        cleanedUpAt: null,
        finalizedAt: null,
        lastServedAt: new Date('2026-05-24T15:31:00.000Z'),
        expiresAt: new Date('2026-05-24T16:30:00.000Z'),
      },
    ];

    let receivedQuery = null;
    const service = createCertificateService({
      acmeChallenge: {
        findMany: async (query) => {
          receivedQuery = query;
          return challenges;
        },
      },
      certificate: {
        findMany: async () => [],
        findUnique: async () => null,
      },
      certificateOrder: {
        findMany: async () => [],
        findUnique: async () => null,
      },
      certificateArtifactVersion: {
        update: async () => undefined,
        updateMany: async () => ({ count: 0 }),
      },
      proxyEntry: {
        findMany: async () => [],
      },
    });

    const result = await service.listAcmeChallenges({
      status: 'presented',
      limit: 10,
    });

    assert.deepEqual(receivedQuery.where, { status: 'presented' });
    assert.equal(receivedQuery.take, 10);
    assert.deepEqual(receivedQuery.orderBy, [
      { presentedAt: 'desc' },
      { createdAt: 'desc' },
    ]);
    assert.equal(result.count, 1);
    assert.equal(result.challenges[0].id, 'challenge-1');
    assert.equal(result.challenges[0].token, 'token-1');
    assert.equal(result.challenges[0].status, 'presented');
    assert.deepEqual(result.challenges[0].metadata, {
      providerState: 'published',
    });
  });

  it('serves only active presented ACME challenges and marks expired ones', async () => {
    resetModules();
    const { AcmeController } = require(acmeControllerPath);

    const updates = [];
    const activeChallenge = {
      id: 'challenge-active',
      token: 'token-active',
      keyAuth: 'key-auth-active',
      domain: 'example.com',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const expiredChallenge = {
      id: 'challenge-expired',
      token: 'token-expired',
      keyAuth: 'key-auth-expired',
      domain: 'expired.example.com',
      expiresAt: new Date(Date.now() - 60_000),
    };

    const controller = new AcmeController({
      acmeChallenge: {
        findFirst: async ({ where }) => {
          if (where.token === 'token-active' && where.status === 'presented') {
            return activeChallenge;
          }
          if (where.token === 'token-expired' && where.status === 'presented') {
            return expiredChallenge;
          }
          return null;
        },
        update: async (payload) => {
          updates.push(payload);
          return undefined;
        },
      },
    });

    const okResponse = createResponseCapture();
    await controller.getChallenge('token-active', okResponse);
    assert.equal(okResponse.statusCode, 200);
    assert.equal(okResponse.contentTypeValue, 'text/plain');
    assert.equal(okResponse.body, 'key-auth-active');

    const expiredResponse = createResponseCapture();
    await controller.getChallenge('token-expired', expiredResponse);
    assert.equal(expiredResponse.statusCode, 404);
    assert.equal(expiredResponse.body, 'Challenge expired');

    assert.deepEqual(updates[0], {
      where: { id: 'challenge-active' },
      data: { lastServedAt: updates[0].data.lastServedAt },
    });
    assert.equal(updates[0].data.lastServedAt instanceof Date, true);
    assert.deepEqual(updates[1], {
      where: { id: 'challenge-expired' },
      data: {
        status: 'expired',
        finalizedAt: updates[1].data.finalizedAt,
      },
    });
    assert.equal(updates[1].data.finalizedAt instanceof Date, true);
  });
});

